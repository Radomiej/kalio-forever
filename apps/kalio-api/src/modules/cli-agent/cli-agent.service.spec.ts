/**
 * Unit tests for CLIAgentService.
 * TDD: enabled-check and listener-cleanup tests are written BEFORE the fix is applied.
 */
import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from 'vitest';
import { EventEmitter } from 'node:events';
import { existsSync } from 'node:fs';
import type { ChildProcess } from 'node:child_process';
import type { CLIAgentConfig } from '@kalio/types';
import type { CLIAgentConfigService } from './cli-agent-config.service';
import type { CopilotAdapter } from './adapters/copilot.adapter';
import type { GeminiAdapter } from './adapters/gemini.adapter';
import type { ClaudeCodeAdapter } from './adapters/claude-code.adapter';
import { defaultCodexCommand, type CodexAdapter } from './adapters/codex.adapter';

vi.mock('node:child_process', () => ({ spawn: vi.fn(), execFile: vi.fn() }));
import * as childProcess from 'node:child_process';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeConfig(overrides: Partial<CLIAgentConfig> = {}): CLIAgentConfig {
  return {
    enabled: true,
    cliPath: '',
    timeoutMs: 600_000,
    maxOutputChars: 16_000,
    model: '',
    architecturePreference: '',
    extraArgs: [],
    ...overrides,
  };
}

function makeFakeProc() {
  const base = new EventEmitter();
  const stdout = new EventEmitter() as EventEmitter & { on: MockInstance; off: MockInstance };
  const stderr = new EventEmitter() as EventEmitter & { on: MockInstance; off: MockInstance };
  vi.spyOn(stdout, 'on');
  vi.spyOn(stdout, 'off');
  vi.spyOn(stderr, 'on');
  vi.spyOn(stderr, 'off');
  Object.assign(base, { stdout, stderr, stdin: { end: vi.fn() }, exitCode: null, kill: vi.fn(), pid: 4242 });
  return base as unknown as ChildProcess & { stdout: typeof stdout; stderr: typeof stderr };
}

function makeAdapter(id: string) {
  return {
    id, displayName: id, installUrl: 'https://example.com',
    supportsModelSelection: true,
    executable: () => id,
    wrapperArgs: () => [],
    buildArgs: vi.fn((prompt: string, _w: string, extra: string[]) => ['-p', prompt, ...extra]),
    probeArgs: () => ['--version'],
  };
}

const WINDOWS_POWERSHELL_EXE = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe';
const WINDOWS_CODEX_COMMAND = defaultCodexCommand('win32');

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('CLIAgentService', () => {
  let CLIAgentServiceClass: typeof import('./cli-agent.service').CLIAgentService;
  let stoppedErrorCode: string;
  let service: import('./cli-agent.service').CLIAgentService;
  let configService: CLIAgentConfigService;
  let ptyService: { run: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    ({ CLIAgentService: CLIAgentServiceClass, CLI_AGENT_STOPPED_ERROR: stoppedErrorCode } = await import('./cli-agent.service'));
    configService = { getConfig: vi.fn().mockResolvedValue(makeConfig()) } as unknown as CLIAgentConfigService;
    ptyService = { run: vi.fn() };
    service = new CLIAgentServiceClass(
      configService,
      makeAdapter('copilot') as unknown as CopilotAdapter,
      makeAdapter('gemini') as unknown as GeminiAdapter,
      makeAdapter('claude') as unknown as ClaudeCodeAdapter,
      makeAdapter('codex') as unknown as CodexAdapter,
      ptyService as unknown as import('./cli-agent-pty.service').CLIAgentPtyService,
    );
  }, 30_000);

  afterEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers(); // safety: always restore real timers
  });

  it('throws for unknown agentId — no spawn', async () => {
    await expect(service.run({ agentId: 'unknown', prompt: 'task', workdir: '/w', callId: 'c', sessionId: 's' })).rejects.toThrow('Unknown CLI agent');
    expect(childProcess.spawn).not.toHaveBeenCalled();
  });

  it('throws when adapter is disabled — no spawn', async () => {
    vi.mocked(configService.getConfig).mockResolvedValue(makeConfig({ enabled: false }));
    await expect(service.run({ agentId: 'copilot', prompt: 'task', workdir: '/w', callId: 'c', sessionId: 's' })).rejects.toThrow('disabled');
    expect(childProcess.spawn).not.toHaveBeenCalled();
  });

  it('resolves with exitCode=0 on successful run', async () => {
    const fakeProc = makeFakeProc();
    vi.mocked(childProcess.spawn).mockReturnValue(fakeProc as unknown as ReturnType<typeof childProcess.spawn>);
    const p = service.run({ agentId: 'copilot', prompt: 'task', workdir: '/w', callId: 'c', sessionId: 's' });
    await new Promise((r) => setTimeout(r, 0));
    fakeProc.emit('close', 0);
    const result = await p;
    expect(result.exitCode).toBe(0);
    expect(result.agentId).toBe('copilot');
  });

  it('does not treat zero-exit auth-looking CLI output as failed without typed failure code', async () => {
    const fakeProc = makeFakeProc();
    vi.mocked(childProcess.spawn).mockReturnValue(fakeProc as unknown as ReturnType<typeof childProcess.spawn>);

    const runPromise = service.run({
      agentId: 'claude',
      prompt: 'task',
      workdir: '/w',
      callId: 'c',
      sessionId: 's',
    });

    await new Promise((resolve) => setTimeout(resolve, 0));
    fakeProc.stdout.emit('data', Buffer.from('Authentication required. Please run /login to authenticate Claude Code.\n'));
    fakeProc.emit('close', 0);

    await expect(runPromise).resolves.toMatchObject({
      agentId: 'claude',
      exitCode: 0,
      rawExitCode: 0,
      outcome: 'completed',
      output: expect.stringContaining('Authentication required'),
    });
  });

  it('classifies non-zero auth-required CLI output as an auth failure', async () => {
    const fakeProc = makeFakeProc();
    vi.mocked(childProcess.spawn).mockReturnValue(fakeProc as unknown as ReturnType<typeof childProcess.spawn>);

    const runPromise = service.run({
      agentId: 'claude',
      prompt: 'task',
      workdir: '/w',
      callId: 'c',
      sessionId: 's',
    });

    await new Promise((resolve) => setTimeout(resolve, 0));
    fakeProc.stderr.emit('data', Buffer.from('Authentication required. Please run /login to authenticate Claude Code.\n'));
    fakeProc.emit('close', 1);

    await expect(runPromise).resolves.toMatchObject({
      agentId: 'claude',
      exitCode: 1,
      rawExitCode: 1,
      outcome: 'failed',
      failureCode: 'auth_required',
      output: expect.stringContaining('Authentication required'),
    });
  });

  it('does not classify successful output as auth-required just because it mentions login in a summary', async () => {
    const fakeProc = makeFakeProc();
    vi.mocked(childProcess.spawn).mockReturnValue(fakeProc as unknown as ReturnType<typeof childProcess.spawn>);

    const runPromise = service.run({
      agentId: 'copilot',
      prompt: 'task',
      workdir: '/w',
      callId: 'c',
      sessionId: 's',
    });

    await new Promise((resolve) => setTimeout(resolve, 0));
    fakeProc.stdout.emit('data', Buffer.from([
      'Implemented the fix successfully.',
      'Added docs that mention `gh auth login` for local setup.',
      'All checks passed.',
    ].join('\n')));
    fakeProc.emit('close', 0);

    await expect(runPromise).resolves.toMatchObject({
      agentId: 'copilot',
      exitCode: 0,
      rawExitCode: 0,
      outcome: 'completed',
    });
  });

  it('removes stdout/stderr data listeners on timeout', async () => {
    vi.useFakeTimers();
    const fakeProc = makeFakeProc();
    vi.mocked(childProcess.spawn).mockReturnValue(fakeProc as unknown as ReturnType<typeof childProcess.spawn>);

    const p = service.run({ agentId: 'copilot', prompt: 'task', workdir: '/w', callId: 'c', sessionId: 's', timeoutMs: 200 });
    // Flush pending microtasks so getConfig resolves and spawn is called before we advance timers
    await Promise.resolve(); await Promise.resolve();
    vi.advanceTimersByTime(300);

    await expect(p).rejects.toThrow('timed out');

    expect(fakeProc.stdout.off).toHaveBeenCalledWith('data', expect.any(Function));
    expect(fakeProc.stderr.off).toHaveBeenCalledWith('data', expect.any(Function));
  });

  it('raises too-short Gemini timeout to the slow-agent minimum', async () => {
    vi.useFakeTimers();
    const fakeProc = makeFakeProc();
    vi.mocked(childProcess.spawn).mockReturnValue(fakeProc as unknown as ReturnType<typeof childProcess.spawn>);
    vi.spyOn(service as unknown as { getPlatform(): NodeJS.Platform }, 'getPlatform').mockReturnValue('linux');

    const p = service.run({ agentId: 'gemini', prompt: 'task', workdir: '/w', callId: 'c', sessionId: 's', timeoutMs: 60_000 });
    await Promise.resolve(); await Promise.resolve();

    vi.advanceTimersByTime(179_999);
    await Promise.resolve();
    expect(fakeProc.kill).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);

    await expect(p).rejects.toThrow('idle timed out after 180000ms');
    expect(fakeProc.kill).toHaveBeenCalledWith('SIGTERM');
  });

  it('runs Codex through the PTY executor so it has terminal semantics', async () => {
    vi.mocked(ptyService.run).mockResolvedValue({
      agentId: 'codex',
      output: 'KALIO_CODEX_OK',
      exitCode: 0,
      durationMs: 50,
    });

    const result = await service.run({ agentId: 'codex', prompt: 'task', workdir: '/w', callId: 'c', sessionId: 's', turnId: 'turn-codex', timeoutMs: 60_000 });

    expect(result.output).toBe('KALIO_CODEX_OK');
    expect(childProcess.spawn).not.toHaveBeenCalled();
    const expectedLaunch = process.platform === 'win32'
      ? {
          executable: WINDOWS_POWERSHELL_EXE,
          args: [
            '-NoProfile',
            '-ExecutionPolicy',
            'Bypass',
            '-Command',
            expect.stringContaining(`$prompt | & '${WINDOWS_CODEX_COMMAND}' '-p' '-'`),
          ],
        }
      : {
          executable: 'codex',
          args: ['-p', 'task'],
        };
    expect(ptyService.run).toHaveBeenCalledWith(expect.objectContaining({
      agentId: 'codex',
      ...expectedLaunch,
      workdir: '/w',
      callId: 'c',
      sessionId: 's',
      turnId: 'turn-codex',
      inactivityTimeoutMs: 180_000,
    }));
  });

  it('passes Codex prompt through a temp file on Windows instead of embedding it in PowerShell', async () => {
    if (process.platform !== 'win32') {
      return;
    }

    vi.mocked(ptyService.run).mockResolvedValue({
      agentId: 'codex',
      output: 'ok',
      exitCode: 0,
      durationMs: 50,
    });

    const prompt = "Build Piekna Strefa\nDon't split | this prompt";
    await service.run({ agentId: 'codex', prompt, workdir: '/w', callId: 'c', sessionId: 's', timeoutMs: 60_000 });

    const command = vi.mocked(ptyService.run).mock.calls[0]?.[0].args[4] ?? '';
    const promptPath = command.match(/-LiteralPath '([^']+)'/)?.[1];

    expect(ptyService.run).toHaveBeenCalledWith(expect.objectContaining({
      executable: WINDOWS_POWERSHELL_EXE,
      args: [
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-Command',
        expect.stringContaining(`$prompt | & '${WINDOWS_CODEX_COMMAND}' '-p' '-'`),
      ],
    }));
    expect(command).not.toContain(prompt);
    expect(promptPath).toBeTruthy();
    expect(existsSync(promptPath!)).toBe(false);
  });

  it('returns the final Codex JSON agent message when exec output is structured', async () => {
    vi.mocked(ptyService.run).mockResolvedValue({
      agentId: 'codex',
      output: [
        'startup warning that is not JSON',
        '{"type":"thread.started","thread_id":"t"}',
        '{"type":"item.completed","item":{"id":"item_0","type":"agent_message","text":"KALIO_CODEX_OK"}}',
        '{"type":"turn.completed"}',
      ].join('\n'),
      exitCode: 0,
      durationMs: 50,
    });

    const result = await service.run({ agentId: 'codex', prompt: 'task', workdir: '/w', callId: 'c', sessionId: 's' });

    expect(result.output).toBe('KALIO_CODEX_OK');
  });

  it('keeps non-Codex agents on the pipe executor', async () => {
    const fakeProc = makeFakeProc();
    vi.mocked(childProcess.spawn).mockReturnValue(fakeProc as unknown as ReturnType<typeof childProcess.spawn>);

    const p = service.run({ agentId: 'gemini', prompt: 'task', workdir: '/w', callId: 'c', sessionId: 's', timeoutMs: 180_000 });
    await Promise.resolve(); await Promise.resolve();
    fakeProc.emit('close', 0);
    await p;

    expect(ptyService.run).not.toHaveBeenCalled();
  });

  it('does not prepend adapter wrapper args when a CLI path override is configured', async () => {
    const fakeProc = makeFakeProc();
    const adapter = {
      ...makeAdapter('copilot'),
      executable: () => 'cmd',
      wrapperArgs: () => ['/c', 'copilot'],
    };
    vi.mocked(configService.getConfig).mockResolvedValue(makeConfig({ cliPath: 'C:\\Tools\\copilot.exe' }));
    vi.mocked(childProcess.spawn).mockReturnValue(fakeProc as unknown as ReturnType<typeof childProcess.spawn>);
    service = new CLIAgentServiceClass(
      configService,
      adapter as unknown as CopilotAdapter,
      makeAdapter('gemini') as unknown as GeminiAdapter,
      makeAdapter('claude') as unknown as ClaudeCodeAdapter,
      makeAdapter('codex') as unknown as CodexAdapter,
      ptyService as unknown as import('./cli-agent-pty.service').CLIAgentPtyService,
    );

    const p = service.run({ agentId: 'copilot', prompt: 'task', workdir: '/w', callId: 'c', sessionId: 's' });
    await Promise.resolve(); await Promise.resolve();
    fakeProc.emit('close', 0);
    await p;

    expect(childProcess.spawn).toHaveBeenCalledWith(
      'C:\\Tools\\copilot.exe',
      ['-p', 'task'],
      expect.any(Object),
    );
  });

  it('keeps short Copilot timeout unchanged at the service layer', async () => {
    vi.useFakeTimers();
    const fakeProc = makeFakeProc();
    vi.mocked(childProcess.spawn).mockReturnValue(fakeProc as unknown as ReturnType<typeof childProcess.spawn>);

    const p = service.run({ agentId: 'copilot', prompt: 'task', workdir: '/w', callId: 'c', sessionId: 's', timeoutMs: 60_000 });
    await Promise.resolve(); await Promise.resolve();

    vi.advanceTimersByTime(60_000);

    await expect(p).rejects.toThrow('idle timed out after 60000ms');
  });

  it('removes stdout/stderr data listeners on spawn error', async () => {
    const fakeProc = makeFakeProc();
    vi.mocked(childProcess.spawn).mockReturnValue(fakeProc as unknown as ReturnType<typeof childProcess.spawn>);
    const p = service.run({ agentId: 'copilot', prompt: 'task', workdir: '/w', callId: 'c', sessionId: 's' });
    await new Promise((r) => setTimeout(r, 0));
    fakeProc.emit('error', new Error('ENOENT'));
    await expect(p).rejects.toThrow('ENOENT');
    expect(fakeProc.stdout.off).toHaveBeenCalledWith('data', expect.any(Function));
    expect(fakeProc.stderr.off).toHaveBeenCalledWith('data', expect.any(Function));
  });

  it('resolves after process exit even when close never arrives', async () => {
    vi.useFakeTimers();
    const fakeProc = makeFakeProc();
    vi.mocked(childProcess.spawn).mockReturnValue(fakeProc as unknown as ReturnType<typeof childProcess.spawn>);

    const p = service.run({ agentId: 'gemini', prompt: 'task', workdir: '/w', callId: 'c', sessionId: 's', timeoutMs: 1_000 });
    await Promise.resolve(); await Promise.resolve();

    fakeProc.stdout.emit('data', Buffer.from('Error executing tool read_file: File not found.'));
    fakeProc.emit('exit', 1);

    vi.advanceTimersByTime(1_100);

    await expect(p).resolves.toMatchObject({
      exitCode: 1,
      agentId: 'gemini',
      output: expect.stringContaining('File not found.'),
    });
  });

  it('calls emitFn with cli_agent:progress from stdout', async () => {
    const fakeProc = makeFakeProc();
    vi.mocked(childProcess.spawn).mockReturnValue(fakeProc as unknown as ReturnType<typeof childProcess.spawn>);
    const emitFn = vi.fn();
    const p = service.run({
      agentId: 'copilot',
      prompt: 'task',
      workdir: '/w',
      callId: 'callId',
      sessionId: 'sess-1',
      turnId: 'turn-1',
      emitFn,
    });
    await new Promise((r) => setTimeout(r, 0));
    fakeProc.stdout.emit('data', Buffer.from('hello'));
    fakeProc.emit('close', 0);
    await p;
    expect(emitFn).toHaveBeenCalledWith('cli_agent:progress',
      expect.objectContaining({ callId: 'callId', sessionId: 'sess-1', turnId: 'turn-1', agentId: 'copilot', chunk: 'hello' }));
  });

  it('passes model override from config into the adapter args', async () => {
    const fakeProc = makeFakeProc();
    const adapter = makeAdapter('copilot');
    vi.mocked(configService.getConfig).mockResolvedValue(makeConfig({ model: 'configured-model' }));
    vi.mocked(childProcess.spawn).mockReturnValue(fakeProc as unknown as ReturnType<typeof childProcess.spawn>);
    service = new CLIAgentServiceClass(
      configService,
      adapter as unknown as CopilotAdapter,
      makeAdapter('gemini') as unknown as GeminiAdapter,
      makeAdapter('claude') as unknown as ClaudeCodeAdapter,
      makeAdapter('codex') as unknown as CodexAdapter,
      ptyService as unknown as import('./cli-agent-pty.service').CLIAgentPtyService,
    );

    const p = service.run({ agentId: 'copilot', prompt: 'task', workdir: '/w', callId: 'callId', sessionId: 'sess-1' });
    await new Promise((r) => setTimeout(r, 0));
    fakeProc.emit('close', 0);
    await p;

    expect(adapter.buildArgs).toHaveBeenCalledWith('task', '/w', [], 'configured-model');
  });

  it('passes long Gemini prompts through a temp file on Windows to avoid command length limits', async () => {
    const fakeProc = makeFakeProc();
    const adapter = makeAdapter('gemini');
    vi.mocked(childProcess.spawn).mockReturnValue(fakeProc as unknown as ReturnType<typeof childProcess.spawn>);
    service = new CLIAgentServiceClass(
      configService,
      makeAdapter('copilot') as unknown as CopilotAdapter,
      adapter as unknown as GeminiAdapter,
      makeAdapter('claude') as unknown as ClaudeCodeAdapter,
      makeAdapter('codex') as unknown as CodexAdapter,
      ptyService as unknown as import('./cli-agent-pty.service').CLIAgentPtyService,
    );
    vi.spyOn(service as unknown as { getPlatform(): NodeJS.Platform }, 'getPlatform').mockReturnValue('win32');

    const prompt = 'build salon site\n'.repeat(800);
    const p = service.run({ agentId: 'gemini', prompt, workdir: '/w', callId: 'callId', sessionId: 'sess-1' });
    for (let i = 0; i < 20 && vi.mocked(childProcess.spawn).mock.calls.length === 0; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    fakeProc.emit('close', 0);
    await p;

    const [effectivePrompt, , extraArgs] = adapter.buildArgs.mock.calls[0] ?? [];
    expect(effectivePrompt).toContain('Read and follow the complete implementation instructions from this file:');
    expect(effectivePrompt).not.toContain(prompt);
    expect(extraArgs).toContain('--include-directories');
    expect(childProcess.spawn).toHaveBeenCalledWith(
      'gemini',
      expect.arrayContaining(['-p', expect.stringContaining('kalio-gemini-prompt-')]),
      expect.any(Object),
    );
  });

  it('cancels run from abortSignal without waiting for timeout and clears active state', async () => {
    const fakeProc = makeFakeProc();
    const abortController = new AbortController();
    vi.mocked(childProcess.spawn).mockReturnValue(fakeProc as unknown as ReturnType<typeof childProcess.spawn>);

    const runPromise = service.run({
      agentId: 'copilot',
      prompt: 'task',
      workdir: '/w',
      callId: 'callId',
      sessionId: 'sess-abort',
      abortSignal: abortController.signal,
    });

    await Promise.resolve();
    await Promise.resolve();
    abortController.abort(new Error('cancelled'));

    await expect(runPromise).rejects.toThrow(stoppedErrorCode);
    expect((service as unknown as { activeRuns: Map<string, unknown> }).activeRuns.has('sess-abort')).toBe(false);
  });

  it('uses Windows taskkill tree-termination on explicit stop', async () => {
    const fakeProc = makeFakeProc();
    const execFileMock = vi.mocked(childProcess.execFile);
    execFileMock.mockImplementation(((
      _file: string,
      _args: readonly string[],
      _options: Record<string, unknown>,
      callback: (err: Error | null, stdout: string, stderr: string) => void,
    ) => {
      callback(null, '', '');
      return {} as never;
    }) as unknown as typeof childProcess.execFile);
    vi.mocked(childProcess.spawn).mockReturnValue(fakeProc as unknown as ReturnType<typeof childProcess.spawn>);
    vi.spyOn(service as unknown as { getPlatform(): NodeJS.Platform }, 'getPlatform').mockReturnValue('win32');

    const runPromise = service.run({ agentId: 'copilot', prompt: 'task', workdir: '/w', callId: 'c', sessionId: 'sess-stop' });
    await Promise.resolve();
    await Promise.resolve();

    expect(service.stop('sess-stop')).toBe(true);
    await expect(runPromise).rejects.toThrow(stoppedErrorCode);
    expect(execFileMock).toHaveBeenCalledWith(
      'taskkill',
      ['/F', '/T', '/PID', '4242'],
      expect.objectContaining({ windowsHide: true, timeout: 5000 }),
      expect.any(Function),
    );
  });

  it('settles inactivity timeout once and clears activeRuns deterministically', async () => {
    vi.useFakeTimers();
    const fakeProc = makeFakeProc();
    vi.mocked(childProcess.spawn).mockReturnValue(fakeProc as unknown as ReturnType<typeof childProcess.spawn>);

    const runPromise = service.run({
      agentId: 'copilot',
      prompt: 'task',
      workdir: '/w',
      callId: 'c',
      sessionId: 'sess-timeout',
      inactivityTimeoutMs: 100,
    });

    await Promise.resolve();
    await Promise.resolve();
    vi.advanceTimersByTime(150);

    await expect(runPromise).rejects.toThrow('idle timed out after 100ms');
    fakeProc.emit('close', 0);
    await Promise.resolve();

    expect((service as unknown as { activeRuns: Map<string, unknown> }).activeRuns.has('sess-timeout')).toBe(false);
  });

  it('rejects Codex PTY run immediately on stop without waiting for PTY timeout', async () => {
    const ptyProc = { kill: vi.fn(), pid: 9876 };
    vi.mocked(ptyService.run).mockImplementation(async (request) => {
      request.onStart?.(ptyProc as unknown as Parameters<NonNullable<typeof request.onStart>>[0]);
      return await new Promise(() => undefined);
    });

    const runPromise = service.run({
      agentId: 'codex',
      prompt: 'task',
      workdir: '/w',
      callId: 'callId',
      sessionId: 'sess-codex-stop',
    });

    for (let i = 0; i < 20 && !service.isRunning('sess-codex-stop'); i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    expect(service.stop('sess-codex-stop')).toBe(true);

    await expect(runPromise).rejects.toThrow(stoppedErrorCode);
  });
});
