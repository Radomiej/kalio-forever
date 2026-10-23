import { execFile, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/** Terminate only the currently owned process; never target an exited PID. */
export function stopDevinChild(child: ChildProcessWithoutNullStreams): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise((resolve, reject) => {
    let closed = false;
    let terminationComplete = false;
    const finish = (error?: Error): void => {
      clearTimeout(timeout);
      child.off('close', onClose);
      child.off('error', onError);
      if (error) reject(error);
      else resolve();
    };
    const onClose = (): void => {
      closed = true;
      if (terminationComplete) finish();
    };
    const onError = (error: Error): void => finish(error);
    const timeout = setTimeout(() => finish(Object.assign(
      new Error('Devin ACP process tree did not close within 10 seconds.'),
      { shutdownState: {
        terminationComplete,
        exitCode: child.exitCode,
        signalCode: child.signalCode,
        stdoutClosed: child.stdout.closed,
        stderrClosed: child.stderr.closed,
      } },
    )), 10_000);
    child.once('close', onClose);
    child.once('error', onError);
    const terminate = async (): Promise<void> => {
      if (process.platform === 'win32' && child.pid !== undefined) {
        await execFileAsync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], {
          windowsHide: true, timeout: 10_000,
        });
      } else if (!child.kill()) {
        throw new Error('Devin ACP process could not be stopped.');
      }
      terminationComplete = true;
      if (closed) finish();
    };
    void terminate().catch((error: unknown) => finish(error instanceof Error ? error : new Error('Devin ACP process shutdown failed.')));
  });
}
