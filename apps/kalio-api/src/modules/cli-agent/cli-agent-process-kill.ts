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
      (err, _stdout, stderr) => {
        if (!err) {
          resolve();
          return;
        }

        const lowerStderr = (stderr ?? '').toLowerCase();
        const notFound = lowerStderr.includes('not found')
          || lowerStderr.includes('no running instance')
          || lowerStderr.includes('does not exist');
        if (notFound) {
          resolve();
          return;
        }

        reject(err);
      },
    );
  });
}
