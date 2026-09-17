import { randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { chmod, mkdir, readFile, rename, rm, stat } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { createGunzip } from 'node:zlib';

const requireFromRuntime = createRequire(__filename);
const defaultCacheRoot = join(tmpdir(), 'kalio-claude-agent-sdk-linux-x64');
let executablePromise: Promise<string | undefined> | undefined;

export function resolveClaudeAgentSdkExecutable(): Promise<string | undefined> {
  if (process.platform !== 'linux' || process.arch !== 'x64') {
    return Promise.resolve(undefined);
  }

  executablePromise ??= resolveLinuxClaudeAgentSdkExecutable();
  return executablePromise;
}

export async function extractClaudeAgentSdkExecutable(
  packageDirectory: string,
  version: string,
  cacheRoot = defaultCacheRoot,
): Promise<string> {
  const normalizedVersion = version.trim();
  if (!normalizedVersion) {
    throw new Error('Claude Agent SDK package version is required for executable extraction.');
  }

  const targetDirectory = join(cacheRoot, encodeURIComponent(normalizedVersion));
  const executablePath = join(targetDirectory, 'claude');
  if (await isUsableFile(executablePath)) {
    return executablePath;
  }

  const compressedPath = join(packageDirectory, 'claude.gz');
  if (!await isUsableFile(compressedPath)) {
    throw new Error(`Compressed Claude Agent SDK executable is missing: ${compressedPath}`);
  }

  await mkdir(targetDirectory, { recursive: true, mode: 0o700 });
  const temporaryPath = join(targetDirectory, `.claude-${process.pid}-${randomUUID()}.tmp`);

  try {
    await pipeline(
      createReadStream(compressedPath),
      createGunzip(),
      createWriteStream(temporaryPath, { flags: 'wx', mode: 0o700 }),
    );
    await chmod(temporaryPath, 0o700);
    await rename(temporaryPath, executablePath);
    return executablePath;
  } catch (error) {
    await rm(temporaryPath, { force: true });
    throw error;
  }
}

async function resolveLinuxClaudeAgentSdkExecutable(): Promise<string> {
  const packageJsonPath = requireFromRuntime.resolve('@anthropic-ai/claude-agent-sdk-linux-x64/package.json');
  const packageDirectory = dirname(packageJsonPath);
  const executablePath = join(packageDirectory, 'claude');
  if (await isUsableFile(executablePath)) {
    return executablePath;
  }

  const packageJson = JSON.parse(await readFile(packageJsonPath, 'utf8')) as unknown;
  return extractClaudeAgentSdkExecutable(packageDirectory, readPackageVersion(packageJson));
}

async function isUsableFile(path: string): Promise<boolean> {
  try {
    const details = await stat(path);
    return details.isFile() && details.size > 0;
  } catch (error) {
    if (errorCode(error) === 'ENOENT') {
      return false;
    }
    throw error;
  }
}

function readPackageVersion(value: unknown): string {
  if (!isRecord(value) || typeof value['version'] !== 'string' || !value['version'].trim()) {
    throw new Error('Claude Agent SDK package version is missing.');
  }
  return value['version'].trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function errorCode(error: unknown): string | undefined {
  if (!isRecord(error) || typeof error['code'] !== 'string') {
    return undefined;
  }
  return error['code'];
}
