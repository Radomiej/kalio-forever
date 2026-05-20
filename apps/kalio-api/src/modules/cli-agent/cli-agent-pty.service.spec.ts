import { EventEmitter } from 'node:events';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockExecFile = vi.hoisted(() => vi.fn());
vi.mock('node:child_process', () => ({ execFile: mockExecFile }));

import * as childProcess from 'node:child_process';
import { CLIAgentPtyService } from './cli-agent-pty.service';

let currentSpawn: ReturnType<typeof vi.fn> | null = null;

function makePtyProcess() {
  const events = new EventEmitter();
  const dataDisposer = { dispose: vi.fn() };
  const exitDisposer = { dispose: vi.fn() };

  return {
    onData: vi.fn((callback: (data: string) => void) => {
      events.on('data', callback);
      return dataDisposer;
    }),
    onExit: vi.fn((callback: (event: { exitCode: number }) => void) => {
      events.on('exit', callback);
      return exitDisposer;
    }),
    kill: vi.fn(),
    pid: 5511,
    emitData: (data: string) => events.emit('data', data),
    emitExit: (exitCode: number) => events.emit('exit', { exitCode }),
    dataDisposer,
    exitDisposer,
  };
}

async function waitForSpawn(): Promise<void> {
  for (let i = 0; i < 10; i += 1) {
    if ((currentSpawn?.mock.calls.length ?? 0) > 0) {
      return;
    }
    await Promise.resolve();
  }
  expect(currentSpawn).toHaveBeenCalled();
}

describe('CLIAgentPtyService', () => {
  let service: CLIAgentPtyService;
  let spawn: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockExecFile.mockReset();
    spawn = vi.fn();
    currentSpawn = spawn;
    class TestPtyService extends CLIAgentPtyService {
      protected override async loadPty() {
        return { spawn };
      }
    }
    service = new TestPtyService();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('runs a CLI agent in a PTY and streams progress chunks', async () => {
    const proc = makePtyProcess();
    spawn.mockReturnValue(proc);
    const emitFn = vi.fn();
    const onStart = vi.fn();

    const run = service.run({
      agentId: 'codex',
      executable: 'cmd',
      args: ['/c', 'codex', 'exec', 'Reply OK'],
      workdir: 'C:/repo',
      callId: 'call-1',
      sessionId: 'session-1',
      timeoutMs: 60_000,
      maxOutputChars: 16_000,
      emitFn,
      onStart,
    });

    await waitForSpawn();
    proc.emitData('KALIO_CODEX_OK');
    proc.emitExit(0);

    await expect(run).resolves.toMatchObject({
      agentId: 'codex',
      exitCode: 0,
      output: 'KALIO_CODEX_OK',
    });
    expect(spawn).toHaveBeenCalledWith('cmd', ['/c', 'codex', 'exec', 'Reply OK'], expect.objectContaining({
      cwd: 'C:/repo',
      name: 'xterm-256color',
      cols: 120,
      rows: 30,
    }));
    expect(onStart).toHaveBeenCalledWith(proc);
    expect(emitFn).toHaveBeenCalledWith('cli_agent:progress', {
      callId: 'call-1',
      sessionId: 'session-1',
      agentId: 'codex',
      chunk: 'KALIO_CODEX_OK',
    });
    expect(proc.dataDisposer.dispose).toHaveBeenCalled();
    expect(proc.exitDisposer.dispose).toHaveBeenCalled();
  });

  it('strips terminal control sequences from PTY output and progress', async () => {
    const proc = makePtyProcess();
    spawn.mockReturnValue(proc);
    const emitFn = vi.fn();

    const run = service.run({
      agentId: 'codex',
      executable: 'powershell.exe',
      args: ['-Command', 'codex'],
      workdir: 'C:/repo',
      callId: 'call-1',
      sessionId: 'session-1',
      timeoutMs: 60_000,
      maxOutputChars: 16_000,
      emitFn,
    });

    await waitForSpawn();
    proc.emitData('\u001B[?25l\u001B[2JKALIO_CODEX_OK\u001B]0;title\u0007\r\n');
    proc.emitExit(0);

    await expect(run).resolves.toMatchObject({
      output: 'KALIO_CODEX_OK',
    });
    expect(emitFn).toHaveBeenCalledWith('cli_agent:progress', expect.objectContaining({
      chunk: 'KALIO_CODEX_OK\n',
    }));
  });

  it('kills the PTY process on timeout', async () => {
    vi.useFakeTimers();
    const proc = makePtyProcess();
    spawn.mockReturnValue(proc);
    vi.spyOn(service as unknown as { getPlatform(): NodeJS.Platform }, 'getPlatform').mockReturnValue('linux');

    const run = service.run({
      agentId: 'codex',
      executable: 'cmd',
      args: ['/c', 'codex'],
      workdir: 'C:/repo',
      callId: 'call-1',
      sessionId: 'session-1',
      timeoutMs: 100,
      maxOutputChars: 16_000,
    });

    await waitForSpawn();
    vi.advanceTimersByTime(100);

    await expect(run).rejects.toThrow('timed out after 100ms');
    expect(proc.kill).toHaveBeenCalledWith('SIGTERM');
    expect(proc.dataDisposer.dispose).toHaveBeenCalled();
    expect(proc.exitDisposer.dispose).toHaveBeenCalled();
  });

  it('uses Windows taskkill process-tree termination on timeout when running on win32', async () => {
    vi.useFakeTimers();
    const proc = makePtyProcess();
    spawn.mockReturnValue(proc);
    vi.spyOn(service as unknown as { getPlatform(): NodeJS.Platform }, 'getPlatform').mockReturnValue('win32');
    vi.mocked(childProcess.execFile).mockImplementation(((
      _file: string,
      _args: readonly string[],
      _options: Record<string, unknown>,
      callback: (err: Error | null, stdout: string, stderr: string) => void,
    ) => {
      callback(null, '', '');
      return {} as never;
    }) as unknown as typeof childProcess.execFile);

    const run = service.run({
      agentId: 'codex',
      executable: 'cmd',
      args: ['/c', 'codex'],
      workdir: 'C:/repo',
      callId: 'call-1',
      sessionId: 'session-1',
      timeoutMs: 100,
      maxOutputChars: 16_000,
    });

    await waitForSpawn();
    vi.advanceTimersByTime(100);
    await expect(run).rejects.toThrow('timed out after 100ms');

    expect(childProcess.execFile).toHaveBeenCalledWith(
      'taskkill',
      ['/F', '/T', '/PID', '5511'],
      expect.objectContaining({ windowsHide: true, timeout: 5000 }),
      expect.any(Function),
    );
  });
});
