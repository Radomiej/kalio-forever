import { execFile } from 'node:child_process';

export interface KillableProcess {
  kill(signal?: string | number): unknown;
  exitCode?: number | null;
  pid?: number;
}

interface TerminateCliAgentProcessParams {
  proc: KillableProcess;
  platform: NodeJS.Platform;
  agentId: string;
  onWarn?: (message: string) => void;
}

export async function terminateCliAgentProcess(params: TerminateCliAgentProcessParams): Promise<void> {
  const { proc, platform, agentId, onWarn } = params;

  if (proc.exitCode !== undefined && proc.exitCode !== null) {
    return;
  }

  if (platform === 'win32' && typeof proc.pid === 'number') {
    try {
      await killWindowsProcessTree(proc.pid);
      return;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      onWarn?.(`[${agentId}] taskkill failed for pid=${proc.pid}: ${message}`);
    }
  }

  try {
    proc.kill('SIGTERM');
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    onWarn?.(`[${agentId}] SIGTERM failed: ${message}`);
  }
}

function killWindowsProcessTree(pid: number): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(
      'taskkill',
      ['/F', '/T', '/PID', String(pid)],
      { windowsHide: true, timeout: 5000 },
      (err) => {
        if (!err) {
          resolve();
          return;
        }

        if (isProcessMissing(pid)) {
          resolve();
          return;
        }

        reject(err);
      },
    );
  });
}

function isProcessMissing(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return false;
  } catch (err) {
    return isNodeErrnoException(err) && err.code === 'ESRCH';
  }
}

function isNodeErrnoException(value: unknown): value is NodeJS.ErrnoException {
  return value instanceof Error && typeof (value as NodeJS.ErrnoException).code === 'string';
}
