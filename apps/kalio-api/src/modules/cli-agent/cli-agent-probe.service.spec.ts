import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('node:child_process', () => ({ execFile: vi.fn() }));
vi.mock('./cli-agent-probe-command', () => ({ installedWindowsProbeCommand: vi.fn() }));
import * as childProcess from 'node:child_process';
import { installedWindowsProbeCommand } from './cli-agent-probe-command';
import { CLIAgentProbeService } from './cli-agent-probe.service';

function makeAdapter(id: string) {
  return {
    id,
    displayName: id,
    installUrl: 'https://example.com',
    supportsModelSelection: true,
    executable: () => id,
    wrapperArgs: () => [],
    probeArgs: () => ['--version'],
  };
}

describe('CLIAgentProbeService', () => {
  beforeEach(() => vi.clearAllMocks());

  it('uses a resolved native default instead of cmd while keeping the probe audited', async () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('win32');
    vi.mocked(installedWindowsProbeCommand).mockReturnValueOnce({ executable: 'C:/npm/copilot.exe', args: [] });
    vi.mocked(childProcess.execFile).mockImplementation((
      ((_file: string, _args: readonly string[], _options: Record<string, unknown>,
        callback: (error: Error | null, stdout: string, stderr: string) => void) => {
        callback(null, 'native-version', '');
        return {} as never;
      }) as unknown as typeof childProcess.execFile
    ));
    const copilot = { ...makeAdapter('copilot'), executable: () => 'cmd', wrapperArgs: () => ['/c', 'copilot'] };
    const audit = { recordInvocation: vi.fn().mockResolvedValue(undefined) };
    try {
      const service = new CLIAgentProbeService({ getConfig: vi.fn().mockResolvedValue({ cliPath: '' }) } as never,
        copilot as never, makeAdapter('gemini') as never, makeAdapter('claude') as never,
        makeAdapter('codex') as never, audit as never);
      expect(await service.probe('copilot')).toEqual({ available: true, version: 'native-version' });
      expect(childProcess.execFile).toHaveBeenCalledWith('C:/npm/copilot.exe', ['--version'],
        expect.objectContaining({ windowsHide: true }), expect.any(Function));
      expect(audit.recordInvocation).toHaveBeenCalledWith(expect.objectContaining({ command: 'C:/npm/copilot.exe' }));
    } finally { vi.restoreAllMocks(); }
  });

  it('probes an explicitly configured native executable without adding a cmd wrapper', async () => {
    vi.mocked(childProcess.execFile).mockImplementation((
      ((_file: string, _args: readonly string[], _options: Record<string, unknown>,
        callback: (error: Error | null, stdout: string, stderr: string) => void) => {
        callback(null, 'native-version', '');
        return {} as never;
      }) as unknown as typeof childProcess.execFile
    ));
    const nativePath = 'C:\\Program Files\\Agent CLI\\agent.exe';
    const config = { getConfig: vi.fn().mockResolvedValue({ cliPath: nativePath }) };
    const claude = { ...makeAdapter('claude'), executable: () => 'cmd', wrapperArgs: () => ['/c', 'claude'] };
    const audit = { recordInvocation: vi.fn().mockResolvedValue(undefined) };
    const service = new CLIAgentProbeService(config as never,
      makeAdapter('copilot') as never, makeAdapter('gemini') as never,
      claude as never, makeAdapter('codex') as never, audit as never);

    expect(await service.probe('claude')).toEqual({ available: true, version: 'native-version' });
    expect(childProcess.execFile).toHaveBeenCalledWith(nativePath, ['--version'],
      expect.objectContaining({ windowsHide: true, timeout: 5000 }), expect.any(Function));
    expect(audit.recordInvocation).toHaveBeenCalledWith(expect.objectContaining({
      command: nativePath, source: 'cli-agent.probe', agentId: 'claude',
    }));
  });

  it('serves repeated status reads from the server cache without starting more processes', async () => {
    vi.mocked(childProcess.execFile).mockImplementation((
      ((
        _file: string,
        _args: readonly string[],
        _options: Record<string, unknown>,
        callback: (error: Error | null, stdout: string, stderr: string) => void,
      ) => {
        callback(null, '1.0.0', '');
        return {} as never;
      }) as unknown as typeof childProcess.execFile
    ));
    const config = { getConfig: vi.fn().mockResolvedValue({ cliPath: '' }) };
    const audit = { recordInvocation: vi.fn().mockResolvedValue(undefined) };
    const service = new CLIAgentProbeService(
      config as never,
      makeAdapter('copilot') as never,
      makeAdapter('gemini') as never,
      makeAdapter('claude') as never,
      makeAdapter('codex') as never,
      audit as never,
    );

    const first = await service.listAll();
    const second = await service.listAll();

    expect(first).toHaveLength(4);
    expect(second).toEqual(first);
    expect(childProcess.execFile).toHaveBeenCalledTimes(4);
    for (const invocation of vi.mocked(childProcess.execFile).mock.calls) {
      expect(invocation[2]).toMatchObject({ windowsHide: true });
    }
  });

  it('serializes different adapter status probes to one active process', async () => {
    const callbacks: Array<(error: Error | null, stdout: string, stderr: string) => void> = [];
    vi.mocked(childProcess.execFile).mockImplementation((
      ((
        _file: string,
        _args: readonly string[],
        _options: Record<string, unknown>,
        callback: (error: Error | null, stdout: string, stderr: string) => void,
      ) => {
        callbacks.push(callback);
        return {} as never;
      }) as unknown as typeof childProcess.execFile
    ));

    const config = { getConfig: vi.fn().mockResolvedValue({ cliPath: '' }) };
    const audit = { recordInvocation: vi.fn().mockResolvedValue(undefined) };
    const service = new CLIAgentProbeService(
      config as never,
      makeAdapter('copilot') as never,
      makeAdapter('gemini') as never,
      makeAdapter('claude') as never,
      makeAdapter('codex') as never,
      audit as never,
    );

    const refresh = service.refreshAllProbes();
    await vi.waitFor(() => expect(childProcess.execFile).toHaveBeenCalledTimes(1));

    for (let completed = 0; completed < 4; completed += 1) {
      expect(callbacks).toHaveLength(completed + 1);
      callbacks[completed]?.(null, '1.0.0', '');
      if (completed < 3) {
        await vi.waitFor(() => expect(childProcess.execFile).toHaveBeenCalledTimes(completed + 2));
      }
    }

    await refresh;
    expect(childProcess.execFile).toHaveBeenCalledTimes(4);
  });
});
