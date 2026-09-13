import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  existsSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { nanoid } from 'nanoid';
import { CodeIntelligenceError } from './code-intelligence.errors';

const execFileAsync = promisify(execFile);
const PROCESS_MATCH_TOLERANCE_MS = 15_000;
const LOCK_WAIT_MS = 30_000;

export interface ManagedVscodeLease {
  runtimeNonce: string;
  pid: number;
  startedAt: number;
  rootHash: string;
  port: number;
  userDataDir: string;
  codeExecutable: string;
  expectedCommandLine: string;
}

export interface ManagedProcessIdentity {
  pid: number;
  creationDateUtc: string;
  executablePath: string;
  commandLine: string;
}

export type ManagedProcessState =
  | { state: 'absent' }
  | { state: 'stale'; lease: ManagedVscodeLease }
  | { state: 'unverified'; lease: ManagedVscodeLease; reason: string }
  | { state: 'owned'; lease: ManagedVscodeLease; identity: ManagedProcessIdentity };

export function readLease(leaseFile: string): ManagedVscodeLease | undefined {
  if (!existsSync(leaseFile)) return undefined;
  try {
    const parsed = JSON.parse(readFileSync(leaseFile, 'utf8')) as Partial<ManagedVscodeLease>;
    if (typeof parsed.runtimeNonce !== 'string' || typeof parsed.pid !== 'number' || typeof parsed.startedAt !== 'number' || typeof parsed.rootHash !== 'string' || typeof parsed.port !== 'number' || typeof parsed.userDataDir !== 'string' || typeof parsed.codeExecutable !== 'string' || typeof parsed.expectedCommandLine !== 'string') return undefined;
    return parsed as ManagedVscodeLease;
  } catch { return undefined; }
}

export function writeLease(leaseFile: string, lease: ManagedVscodeLease): void {
  writeFileSync(leaseFile, JSON.stringify(lease, null, 2));
}

export async function refreshLeaseStartTime(lease: ManagedVscodeLease, rootPath: string): Promise<ManagedVscodeLease> {
  const identity = await inspectProcess(lease.pid);
  if (!identity || !samePath(identity.executablePath, lease.codeExecutable)) return lease;
  const commandLine = identity.commandLine.toLowerCase().replaceAll('\\', '/');
  if (!commandLine.includes(lease.userDataDir.toLowerCase().replaceAll('\\', '/')) || !commandLine.includes(rootPath.toLowerCase().replaceAll('\\', '/'))) return lease;
  const creationTime = Date.parse(identity.creationDateUtc);
  return Number.isFinite(creationTime) ? { ...lease, startedAt: creationTime } : lease;
}

export function clearManagedFiles(connectionFile: string, leaseFile: string): void {
  for (const file of [connectionFile, leaseFile]) if (existsSync(file)) unlinkSync(file);
}

export async function acquireRuntimeLock(lockFile: string): Promise<() => void> {
  const owner = nanoid();
  const deadline = Date.now() + LOCK_WAIT_MS;
  while (Date.now() < deadline) {
    try {
      writeFileSync(lockFile, JSON.stringify({ owner, pid: process.pid, createdAt: Date.now() }), { flag: 'wx' });
      return () => {
        try {
          const current = JSON.parse(readFileSync(lockFile, 'utf8')) as { owner?: string };
          if (current.owner === owner) unlinkSync(lockFile);
        } catch (error) {
          if (error instanceof Error && !/ENOENT/iu.test(error.message)) throw error;
        }
      };
    } catch (error) {
      if (!(error instanceof Error) || !/EEXIST/iu.test(error.message)) throw error;
      const current = readLock(lockFile);
      if (current && !isProcessAlive(current.pid) && Date.now() - current.createdAt > 2_000) {
        try { unlinkSync(lockFile); } catch (unlinkError) { if (unlinkError instanceof Error && !/ENOENT/iu.test(unlinkError.message)) throw unlinkError; }
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  throw new CodeIntelligenceError('IDE_PROCESS_OWNERSHIP_UNVERIFIED', 'Another Kalio runtime operation owns this VS Code profile.');
}

export async function inspectManagedProcess(lease: ManagedVscodeLease, rootHash: string, rootPath: string): Promise<ManagedProcessState> {
  if (lease.rootHash !== rootHash) return { state: 'unverified', lease, reason: 'The lease root hash does not match the requested workspace.' };
  const identity = await inspectProcess(lease.pid);
  if (!identity) return { state: 'stale', lease };
  if (!samePath(identity.executablePath, lease.codeExecutable)) return { state: 'unverified', lease, reason: 'The lease executable does not match the running process.' };
  const creationTime = Date.parse(identity.creationDateUtc);
  if (!Number.isFinite(creationTime) || Math.abs(creationTime - lease.startedAt) > PROCESS_MATCH_TOLERANCE_MS) return { state: 'unverified', lease, reason: 'The lease start time does not match the running process.' };
  const commandLine = identity.commandLine.toLowerCase().replaceAll('\\', '/');
  if (!commandLine.includes(lease.userDataDir.toLowerCase().replaceAll('\\', '/')) || !commandLine.includes(rootPath.toLowerCase().replaceAll('\\', '/'))) return { state: 'unverified', lease, reason: 'The running process command line does not match the managed lease.' };
  return { state: 'owned', lease, identity };
}

export async function terminateManagedProcess(lease: ManagedVscodeLease, rootHash: string, rootPath: string): Promise<boolean> {
  const state = await inspectManagedProcess(lease, rootHash, rootPath);
  if (state.state !== 'owned') return false;
  try {
    await execFileAsync('taskkill.exe', ['/PID', String(lease.pid), '/T', '/F'], { timeout: 10_000, windowsHide: true });
    return true;
  } catch (error) {
    throw new CodeIntelligenceError('IDE_PROCESS_OWNERSHIP_UNVERIFIED', `Managed VS Code process could not be stopped safely: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function inspectProcess(pid: number): Promise<ManagedProcessIdentity | undefined> {
  if (process.platform !== 'win32' || !Number.isInteger(pid) || pid <= 0) return undefined;
  const script = `$p=Get-CimInstance Win32_Process -Filter \"ProcessId = ${pid}\"; if ($null -eq $p) { exit 1 }; $p | Select-Object ProcessId,ExecutablePath,CommandLine,@{Name='CreationDateUtc';Expression={$_.CreationDate.ToUniversalTime().ToString('o')}} | ConvertTo-Json -Compress`;
  try {
    const result = await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { timeout: 5_000, windowsHide: true });
    const parsed = JSON.parse(String(result.stdout)) as { ProcessId?: number; ExecutablePath?: string; CommandLine?: string; CreationDateUtc?: string };
    if (typeof parsed.ProcessId !== 'number' || typeof parsed.ExecutablePath !== 'string' || typeof parsed.CommandLine !== 'string' || typeof parsed.CreationDateUtc !== 'string') return undefined;
    return { pid: parsed.ProcessId, executablePath: parsed.ExecutablePath, commandLine: parsed.CommandLine, creationDateUtc: parsed.CreationDateUtc };
  } catch { return undefined; }
}

function samePath(left: string, right: string): boolean {
  return left.toLowerCase().replaceAll('\\', '/').replace(/\/$/, '') === right.toLowerCase().replaceAll('\\', '/').replace(/\/$/, '');
}

function readLock(lockFile: string): { pid: number; createdAt: number } | undefined {
  try {
    const parsed = JSON.parse(readFileSync(lockFile, 'utf8')) as { pid?: number; createdAt?: number };
    return typeof parsed.pid === 'number' && typeof parsed.createdAt === 'number' ? parsed as { pid: number; createdAt: number } : undefined;
  } catch { return undefined; }
}

function isProcessAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch { return false; }
}
