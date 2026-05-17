/**
 * Unit tests for CLIAgentService.
 * TDD: enabled-check and listener-cleanup tests are written BEFORE the fix is applied.
 */
import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from 'vitest';
import { EventEmitter } from 'node:events';
import type { ChildProcess } from 'node:child_process';
import type { CLIAgentConfig } from '@kalio/types';
import type { CLIAgentConfigService } from './cli-agent-config.service';
import type { CopilotAdapter } from './adapters/copilot.adapter';
import type { GeminiAdapter } from './adapters/gemini.adapter';
import type { ClaudeCodeAdapter } from './adapters/claude-code.adapter';
import type { CodexAdapter } from './adapters/codex.adapter';

vi.mock('node:child_process', () => ({ spawn: vi.fn(), execFile: vi.fn() }));
import * as childProcess from 'node:child_process';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeConfig(overrides: Partial<CLIAgentConfig> = {}): CLIAgentConfig {
  return { enabled: true, cliPath: '', timeoutMs: 600_000, maxOutputChars: 16_000, extraArgs: [], ...overrides };
}

function makeFakeProc() {
  const base = new EventEmitter();
  const stdout = new EventEmitter() as EventEmitter & { on: MockInstance; off: MockInstance };
  const stderr = new EventEmitter() as EventEmitter & { on: MockInstance; off: MockInstance };
  vi.spyOn(stdout, 'on');
  vi.spyOn(stdout, 'off');
  vi.spyOn(stderr, 'on');
  vi.spyOn(stderr, 'off');
  Object.assign(base, { stdout, stderr, stdin: { end: vi.fn() }, exitCode: null, kill: vi.fn() });
  return base as unknown as ChildProcess & { stdout: typeof stdout; stderr: typeof stderr };
}

function makeAdapter(id: string) {
  return {
    id, displayName: id, installUrl: 'https://example.com',
    executable: () => id,
    wrapperArgs: () => [],
    buildArgs: (prompt: string, _w: string, extra: string[]) => ['-p', prompt, ...extra],
    probeArgs: () => ['--version'],
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('CLIAgentService', () => {
  let CLIAgentServiceClass: typeof import('./cli-agent.service').CLIAgentService;
  let service: import('./cli-agent.service').CLIAgentService;
  let configService: CLIAgentConfigService;

  beforeEach(async () => {
    ({ CLIAgentService: CLIAgentServiceClass } = await import('./cli-agent.service'));
    configService = { getConfig: vi.fn().mockResolvedValue(makeConfig()) } as unknown as CLIAgentConfigService;
    service = new CLIAgentServiceClass(
      configService,
      makeAdapter('copilot') as unknown as CopilotAdapter,
      makeAdapter('gemini') as unknown as GeminiAdapter,
      makeAdapter('claude') as unknown as ClaudeCodeAdapter,
      makeAdapter('codex') as unknown as CodexAdapter,
    );
  });

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

  it('calls emitFn with cli_agent:progress from stdout', async () => {
    const fakeProc = makeFakeProc();
    vi.mocked(childProcess.spawn).mockReturnValue(fakeProc as unknown as ReturnType<typeof childProcess.spawn>);
    const emitFn = vi.fn();
    const p = service.run({ agentId: 'copilot', prompt: 'task', workdir: '/w', callId: 'callId', sessionId: 'sess-1', emitFn });
    await new Promise((r) => setTimeout(r, 0));
    fakeProc.stdout.emit('data', Buffer.from('hello'));
    fakeProc.emit('close', 0);
    await p;
    expect(emitFn).toHaveBeenCalledWith('cli_agent:progress',
      expect.objectContaining({ callId: 'callId', sessionId: 'sess-1', agentId: 'copilot', chunk: 'hello' }));
  });
});
