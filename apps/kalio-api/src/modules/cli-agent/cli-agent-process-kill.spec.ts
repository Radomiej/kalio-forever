import { beforeEach, describe, expect, it, vi } from 'vitest';
import { terminateCliAgentProcess } from './cli-agent-process-kill';

vi.mock('node:child_process', () => ({ execFile: vi.fn() }));
import * as childProcess from 'node:child_process';

type ExecFileCallback = (error: Error | null, stdout: string, stderr: string) => void;

describe('terminateCliAgentProcess', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns immediately when process already has exitCode', async () => {
    const kill = vi.fn();
    await terminateCliAgentProcess({
      proc: { exitCode: 0, kill },
      platform: 'linux',
      agentId: 'copilot',
    });

    expect(childProcess.execFile).not.toHaveBeenCalled();
    expect(kill).not.toHaveBeenCalled();
  });

  it('uses Windows taskkill when pid is available on win32', async () => {
    const kill = vi.fn();
    vi.mocked(childProcess.execFile).mockImplementation(((
      _file: string,
      _args: readonly string[],
      _options: Record<string, unknown>,
      callback: ExecFileCallback,
    ) => {
      callback?.(null, '', '');
      return {} as never;
    }) as unknown as typeof childProcess.execFile);

    await terminateCliAgentProcess({
      proc: { pid: 4242, kill },
      platform: 'win32',
      agentId: 'copilot',
    });

    expect(childProcess.execFile).toHaveBeenCalledWith(
      'taskkill',
      ['/F', '/T', '/PID', '4242'],
      expect.objectContaining({ windowsHide: true, timeout: 5000 }),
      expect.any(Function),
    );
    expect(kill).not.toHaveBeenCalled();
  });

  it('falls back to SIGTERM when taskkill fails with unexpected error', async () => {
    const kill = vi.fn();
    const onWarn = vi.fn();
    vi.mocked(childProcess.execFile).mockImplementation(((
      _file: string,
      _args: readonly string[],
      _options: Record<string, unknown>,
      callback: ExecFileCallback,
    ) => {
      callback?.(new Error('taskkill failed'), '', 'something wrong');
      return {} as never;
    }) as unknown as typeof childProcess.execFile);

    await terminateCliAgentProcess({
      proc: { pid: 4242, kill },
      platform: 'win32',
      agentId: 'copilot',
      onWarn,
    });

    expect(childProcess.execFile).toHaveBeenCalledTimes(1);
    expect(kill).toHaveBeenCalledWith('SIGTERM');
    expect(onWarn).toHaveBeenCalledWith(
      expect.stringContaining('[copilot] taskkill failed for pid=4242: taskkill failed'),
    );
  });

  it('does not SIGTERM when Windows taskkill reports process missing', async () => {
    const kill = vi.fn();
    vi.mocked(childProcess.execFile).mockImplementation(((
      _file: string,
      _args: readonly string[],
      _options: Record<string, unknown>,
      callback: ExecFileCallback,
    ) => {
      callback?.(new Error('not found'), '', 'The process with PID 9999 was not found.');
      return {} as never;
    }) as unknown as typeof childProcess.execFile);

    await terminateCliAgentProcess({
      proc: { pid: 9999, kill },
      platform: 'win32',
      agentId: 'copilot',
    });

    expect(kill).not.toHaveBeenCalled();
  });

  it('falls back to SIGTERM directly on non-Windows', async () => {
    const kill = vi.fn();
    await terminateCliAgentProcess({
      proc: { kill },
      platform: 'linux',
      agentId: 'copilot',
    });

    expect(childProcess.execFile).not.toHaveBeenCalled();
    expect(kill).toHaveBeenCalledWith('SIGTERM');
  });
});
