import { execFile } from 'node:child_process';
import { createServer } from 'node:net';
import { homedir } from 'node:os';
import { promisify } from 'node:util';
import {
  existsSync,
  readdirSync,
  readFileSync,
  realpathSync,
} from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';
import type { Dirent } from 'node:fs';
import type { ChildProcess } from 'node:child_process';
import type { IdeLanguageStatus } from '@kalio/types';
import { CodeIntelligenceError } from './code-intelligence.errors';

const execFileAsync = promisify(execFile);
const START_TIMEOUT_MS = 120 * 1000;
const SUPPORTED_BRIDGE_MIN = [0, 4, 7];
const SUPPORTED_BRIDGE_MAX = [0, 5, 0];

export interface ConnectionDescriptor {
  version?: number;
  host?: string;
  port?: number;
  token?: string;
  bearerToken?: string;
  workspaceFolders?: string[];
}

export interface InstallationStatus {
  platformSupported: boolean;
  codeExecutable?: string;
  vscodeVersion?: string;
  bridgeInstalled: boolean;
  bridgeVersion?: string;
  bridgeCompatible: boolean;
}

export function defaultSettings(): { version: 1; enabled: boolean; autoStart: boolean; projects: Record<string, { enabled: boolean; canonicalRoot?: string; trustAcknowledgedAt?: number }> } {
  return { version: 1, enabled: true, autoStart: true, projects: {} };
}

export function canonicalRoot(path: string | null): string {
  if (!path) throw new CodeIntelligenceError('IDE_PROJECT_REQUIRED', 'The selected project has no host path.');
  try { return resolve(realpathSync(path)); } catch { return resolve(path); }
}

export function prepareBridgeArgs(root: string, args: Record<string, unknown>): Record<string, unknown> {
  const result = { ...args };
  if (typeof result['file'] === 'string') result['file'] = relativeProjectFile(root, result['file']);
  return result;
}

function relativeProjectFile(root: string, value: string): string {
  if (value.includes(':') || value.startsWith('\\') || value.startsWith('/')) throw new CodeIntelligenceError('IDE_QUERY_INVALID', 'IDE tool paths must be project-relative.');
  const candidate = resolve(root, value);
  if (!isWithin(root, candidate)) throw new CodeIntelligenceError('IDE_QUERY_INVALID', 'IDE tool path is outside the project root.');
  return relative(root, candidate).replaceAll('\\', '/');
}

export function detectLanguages(rootPath?: string): IdeLanguageStatus[] {
  if (!rootPath || !existsSync(rootPath)) return [];
  const files = listFiles(rootPath, 4, 400);
  const has = (predicate: (file: string) => boolean) => files.some(predicate);
  const languages: IdeLanguageStatus[] = [];
  if (has((file) => /\.(?:ts|tsx|js|jsx|mjs|cjs)$/.test(file) || /(?:package|tsconfig)\.json$/.test(file))) languages.push({ id: 'typescript', displayName: 'TypeScript / JavaScript', lifecycle: 'ready', provider: 'VS Code built-in TypeScript server' });
  if (has((file) => file.endsWith('Cargo.toml') || file.endsWith('.rs'))) languages.push({ id: 'rust', displayName: 'Rust', lifecycle: hasExtension('rust-lang.rust-analyzer') ? 'indexing' : 'missing', provider: 'rust-analyzer', message: 'Rust providers may execute project build scripts and proc macros.' });
  return languages;
}

export async function detectInstallation(): Promise<InstallationStatus> {
  if (process.platform !== 'win32') return { platformSupported: false, bridgeInstalled: false, bridgeCompatible: false };
  const codeExecutable = findCodeExecutable();
  const bridge = findBridgeExtension();
  const vscodeVersion = codeExecutable ? await readVsCodeVersion(codeExecutable) : undefined;
  return { platformSupported: true, ...(codeExecutable ? { codeExecutable } : {}), ...(vscodeVersion ? { vscodeVersion } : {}), bridgeInstalled: Boolean(bridge), ...(bridge?.version ? { bridgeVersion: bridge.version } : {}), bridgeCompatible: Boolean(bridge && isSupportedVersion(bridge.version)) };
}

export function clamp(value: number | undefined, fallback: number, max: number): number {
  const normalized = typeof value === 'number' && Number.isInteger(value) ? value : fallback;
  return Math.min(max, Math.max(1, normalized));
}

export function safeId(value: string): string { return value.replace(/[^A-Za-z0-9_-]/g, '_'); }
export function extensionDir(): string { return join(process.env['USERPROFILE'] ?? homedir(), '.vscode', 'extensions'); }
export function hasExtension(prefix: string): boolean {
  const root = extensionDir();
  return existsSync(root) && readdirSync(root).some((name) => name.startsWith(`${prefix}-`));
}
export function isWithin(root: string, target: string): boolean {
  const a = root.toLowerCase().replaceAll('\\', '/').replace(/\/$/, '');
  const b = target.toLowerCase().replaceAll('\\', '/');
  return b === a || b.startsWith(`${a}/`);
}
export function listFiles(root: string, maxDepth: number, maxFiles: number, depth = 0): string[] {
  if (depth > maxDepth || !existsSync(root)) return [];
  const output: string[] = [];
  let entries: Dirent<string>[];
  try { entries = readdirSync(root, { withFileTypes: true, encoding: 'utf8' }); } catch { return output; }
  for (const entry of entries) {
    if (output.length >= maxFiles || ['.git', 'node_modules', 'target', 'dist', 'build', '.cache'].includes(entry.name)) continue;
    const file = join(root, entry.name);
    if (entry.isDirectory()) output.push(...listFiles(file, maxDepth, maxFiles - output.length, depth + 1));
    else output.push(file);
  }
  return output.slice(0, maxFiles);
}
export function findRepresentativeFile(root: string): string | null {
  return listFiles(root, 5, 500).find((file) => /\.(?:ts|tsx|js|jsx|rs|java|py|go|cs)$/.test(file)) ?? null;
}
export function findCodeExecutable(): string | undefined {
  const candidates = [
    process.env['KALIO_VSCODE_CODE_EXE'],
    join(process.env['ProgramFiles'] ?? '', 'Microsoft VS Code', 'Code.exe'),
    join(process.env['LOCALAPPDATA'] ?? '', 'Programs', 'Microsoft VS Code', 'Code.exe'),
  ].filter((value): value is string => Boolean(value));
  return candidates.find((value) => existsSync(value));
}
export function findBridgeExtension(): { version: string } | undefined {
  const root = extensionDir();
  if (!existsSync(root)) return undefined;
  const names = readdirSync(root).filter((name) => name.startsWith('georgiana-alba.vscode-lsp-mcp-bridge-'));
  const versions = names.map((name) => {
    try {
      const pkg = JSON.parse(readFileSync(join(root, name, 'package.json'), 'utf8')) as { version?: string };
      return pkg.version ? { version: pkg.version } : undefined;
    } catch { return undefined; }
  }).filter((value): value is { version: string } => Boolean(value));
  return versions.sort((a, b) => compareVersions(b.version, a.version))[0];
}
function compareVersions(a: string, b: string): number { return a.localeCompare(b, undefined, { numeric: true }); }
export function isSupportedVersion(version: string): boolean {
  const parts = version.split('.').map((value) => Number.parseInt(value, 10) || 0);
  return compareVersionParts(parts, SUPPORTED_BRIDGE_MIN) >= 0 && compareVersionParts(parts, SUPPORTED_BRIDGE_MAX) < 0;
}
function compareVersionParts(a: number[], b: number[]): number {
  for (let i = 0; i < 3; i += 1) if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) - (b[i] ?? 0);
  return 0;
}
export async function readVsCodeVersion(codeExecutable: string): Promise<string | undefined> {
  try {
    const result = await execFileAsync(codeExecutable, ['--version'], { timeout: 3_000, windowsHide: true });
    const firstLine = typeof result.stdout === 'string' ? result.stdout.split(/\r?\n/)[0]?.trim() : undefined;
    return firstLine && /^\d+\.\d+/.test(firstLine) ? firstLine : undefined;
  } catch { return undefined; }
}
export async function allocatePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolvePromise, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', () => resolvePromise()); });
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  await new Promise<void>((resolvePromise) => server.close(() => resolvePromise()));
  if (!port) throw new CodeIntelligenceError('IDE_START_TIMEOUT', 'Could not reserve a loopback port for VS Code Bridge.');
  return port;
}
export async function waitForConnection(file: string, root: string, expectedPort: number, child?: ChildProcess): Promise<ConnectionDescriptor> {
  const deadline = Date.now() + START_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (child && child.exitCode !== null) throw new CodeIntelligenceError('IDE_START_TIMEOUT', 'VS Code exited before Bridge startup.');
    if (existsSync(file)) {
      try {
        const descriptor = JSON.parse(readFileSync(file, 'utf8')) as ConnectionDescriptor;
        const folders = descriptor.workspaceFolders ?? [];
        const token = descriptor.token ?? descriptor.bearerToken;
        if (descriptor.version === 3 && descriptor.host === '127.0.0.1' && (descriptor.port ?? expectedPort) === expectedPort && typeof token === 'string' && /^[0-9a-f]{64}$/iu.test(token) && folders.some((folder) => samePath(root, isAbsolute(folder) ? resolve(folder) : resolve(root, folder)))) return descriptor;
      } catch { /* descriptor may still be written */ }
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 250));
  }
  throw new CodeIntelligenceError('IDE_START_TIMEOUT', 'VS Code Bridge did not publish the expected workspace before the deadline.');
}
export function samePath(left: string, right: string): boolean {
  return left.toLowerCase().replaceAll('\\', '/').replace(/\/$/, '') === right.toLowerCase().replaceAll('\\', '/').replace(/\/$/, '');
}
export function redactSecrets(value: string): string { return value.replace(/Bearer\s+[^\s]+/giu, 'Bearer [redacted]').replace(/[0-9a-f]{64}/giu, '[redacted]'); }
export function unwrapBridgeResult(value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const record = value as Record<string, unknown>;
  if (record['structuredContent'] && typeof record['structuredContent'] === 'object') return record['structuredContent'];
  const content = record['content'];
  if (!Array.isArray(content)) return value;
  const textBlocks = content.filter((item): item is { type: 'text'; text: string } => Boolean(item) && typeof item === 'object' && (item as Record<string, unknown>)['type'] === 'text' && typeof (item as Record<string, unknown>)['text'] === 'string');
  if (textBlocks.length !== 1) return value;
  try { return JSON.parse(textBlocks[0].text) as unknown; } catch { return textBlocks[0].text; }
}
export function sanitizeBridgeResult(value: unknown, root: string, depth = 0): unknown {
  if (depth > 6) return '[truncated]';
  if (typeof value === 'string') {
    const path = bridgePath(value);
    if (path) return isWithin(root, path) ? relative(root, path).replaceAll('\\', '/') : '[external-location]';
    if (value.length > 12_000) return `${value.slice(0, 12_000)}…`;
    return value;
  }
  if (Array.isArray(value)) return value.slice(0, 200).map((item) => sanitizeBridgeResult(item, root, depth + 1));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).slice(0, 200).map(([key, item]) => [key, sanitizeBridgeResult(item, root, depth + 1)]));
  return value;
}
function bridgePath(value: string): string | undefined {
  if (/^[A-Za-z]:[\\/]/.test(value) || value.startsWith('\\\\')) return resolve(value);
  if (!/^file:/iu.test(value)) return undefined;
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'file:') return undefined;
    let pathname = decodeURIComponent(parsed.pathname);
    if (parsed.hostname && parsed.hostname !== 'localhost') return `\\\\${parsed.hostname}${pathname.replaceAll('/', '\\')}`;
    if (/^\/[A-Za-z]:/.test(pathname)) pathname = pathname.slice(1);
    return resolve(pathname);
  } catch { return undefined; }
}
