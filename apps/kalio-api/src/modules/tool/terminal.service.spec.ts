/**
 * terminal.service.spec.ts
 *
 * Behavioural tests for TerminalService.
 * child_process.spawn is mocked — no real OS processes are created.
 * This makes the suite deterministic and cross-platform.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { ForbiddenException } from '@nestjs/common';

// Must be hoisted before vi.mock factory runs
const mockSpawnFn = vi.hoisted(() => vi.fn());

vi.mock('node:child_process', () => ({ spawn: mockSpawnFn }));

// Import AFTER vi.mock so the module receives the mocked spawn
import { TerminalService } from './terminal.service';
import { TerminalOutputTool } from './tools/terminal.tools';
import type { AllowedPathsService } from '../allowed-paths/allowed-paths.service';

// ── Types ─────────────────────────────────────────────────────────────────────

type MockStdio = EventEmitter & { end: ReturnType<typeof vi.fn> };
type MockProc = EventEmitter & {
  pid: number;
  stdout: EventEmitter;
  stderr: EventEmitter;
  stdin: MockStdio;
  kill: ReturnType<typeof vi.fn>;
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeProc(pid = 12345): MockProc {
  const proc = new EventEmitter() as MockProc;
  proc.pid    = pid;
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  proc.stdin  = Object.assign(new EventEmitter(), { end: vi.fn() }) as MockStdio;
  proc.kill   = vi.fn();
  return proc;
}

function makeAllowed(allowed = true): AllowedPathsService {
  return { isAllowed: vi.fn().mockResolvedValue(allowed) } as unknown as AllowedPathsService;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('TerminalService', () => {
  let service: TerminalService;
  let proc: MockProc;
  let cmdAudit: { recordInvocation: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    proc = makeProc();
    mockSpawnFn.mockReturnValue(proc);
    cmdAudit = { recordInvocation: vi.fn().mockResolvedValue(undefined) };
    service = Reflect.construct(TerminalService, [makeAllowed(), cmdAudit]) as TerminalService;
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  // ── spawn() ──────────────────────────────────────────────────────────────

  describe('observeUntilExit()', () => {
    it('cancels the real terminal_output tool and releases its observer', async () => {
      vi.useFakeTimers();
      const session = await service.spawn('npm', ['run', 'preview'], '/project');
      const controller = new AbortController();
      const removeListener = vi.spyOn(controller.signal, 'removeEventListener');
      const tool = new TerminalOutputTool(service);
      const result = tool.execute({
        sessionId: 'terminal-stop', callId: 'output-stop', toolName: 'terminal_output',
        args: { id: session.id, waitMs: 30000 }, abortSignal: controller.signal,
      });
      const rejected = expect(result).rejects.toMatchObject({ name: 'AbortError' });
      controller.abort();
      await rejected;
      expect(removeListener).toHaveBeenCalledWith('abort', expect.any(Function));
      expect(vi.getTimerCount()).toBe(0);
      expect(proc.listenerCount('close')).toBe(1);
      expect(service.get(session.id)?.status).toBe('running');
      expect(proc.kill).not.toHaveBeenCalled();
    });

    it('removes its abort listener after normal completion', async () => {
      vi.useFakeTimers();
      const session = await service.spawn('npm', ['run', 'build'], '/project');
      const controller = new AbortController();
      const removeListener = vi.spyOn(controller.signal, 'removeEventListener');
      const result = service.observeUntilExit(session.id, 30000, controller.signal);
      proc.emit('close', 0);
      expect(await result).toMatchObject({ status: 'exited', exitCode: 0 });
      expect(removeListener).toHaveBeenCalledWith('abort', expect.any(Function));
      controller.abort();
      expect(vi.getTimerCount()).toBe(0);
    });

    it.each([false, true])('cancels observation without killing the process (already aborted: %s)', async (alreadyAborted) => {
      vi.useFakeTimers();
      const session = await service.spawn('npm', ['run', 'preview'], '/project');
      const controller = new AbortController();
      if (alreadyAborted) controller.abort();
      let outcome: string | undefined;
      const result = service.observeUntilExit(session.id, 30000, controller.signal);
      const observed = result.then(
        () => { outcome = 'resolved'; },
        (error: unknown) => { outcome = error instanceof Error ? error.name : 'unknown'; },
      );
      controller.abort();
      await vi.advanceTimersByTimeAsync(0);
      expect(outcome).toBe('AbortError');
      await observed;
      expect(vi.getTimerCount()).toBe(0);
      expect(proc.listenerCount('close')).toBe(1);
      expect(proc.listenerCount('error')).toBe(1);
      expect(service.get(session.id)?.status).toBe('running');
      expect(proc.kill).not.toHaveBeenCalled();
      expect(mockSpawnFn).toHaveBeenCalledOnce();
    });

    it('observes close and cleans listeners without spawning another process', async () => {
      vi.useFakeTimers();
      const session = await service.spawn('npm', ['run', 'build'], '/project');
      const result = service.observeUntilExit(session.id, 30000);
      proc.stdout.emit('data', Buffer.from('built\n'));
      proc.emit('close', 0);
      expect(await result).toMatchObject({ status: 'exited', exitCode: 0, output: 'built\n' });
      expect(proc.listenerCount('close')).toBe(1);
      expect(proc.listenerCount('error')).toBe(1);
      expect(vi.getTimerCount()).toBe(0);
      expect(proc.kill).not.toHaveBeenCalled();
      expect(mockSpawnFn).toHaveBeenCalledOnce();
    });

    it('returns a running snapshot on timeout without killing the terminal', async () => {
      vi.useFakeTimers();
      const session = await service.spawn('npm', ['run', 'preview'], '/project');
      const result = service.observeUntilExit(session.id, 1000);
      await vi.advanceTimersByTimeAsync(1000);
      expect(await result).toMatchObject({ status: 'running', exitCode: null });
      expect(proc.kill).not.toHaveBeenCalled();
      expect(proc.listenerCount('close')).toBe(1);
      expect(proc.listenerCount('error')).toBe(1);
    });

    it('returns the error snapshot and removes its timer', async () => {
      vi.useFakeTimers();
      const session = await service.spawn('missing', [], '/project');
      const result = service.observeUntilExit(session.id, 30000);
      proc.emit('error', new Error('ENOENT'));
      expect(await result).toMatchObject({ status: 'exited', exitCode: -1 });
      expect(vi.getTimerCount()).toBe(0);
      expect(proc.kill).not.toHaveBeenCalled();
    });
  });

  describe('spawn()', () => {
    it('requests a hidden Windows console for exactly one terminal launch', async () => {
      await service.spawn('npm', ['run', 'build'], '/project');
      expect(mockSpawnFn).toHaveBeenCalledExactlyOnceWith('npm', ['run', 'build'], expect.objectContaining({
        cwd: '/project', shell: process.platform === 'win32', windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'],
      }));
    });
    it('audits the shell-backed terminal invocation with the originating tool IDs', async () => {
      const auditContext = { sessionId: 'session-1', turnId: 'turn-1', callId: 'call-1' };

      await service.spawn('npm', ['run', 'dev'], '/project', false, auditContext);

      expect(cmdAudit.recordInvocation).toHaveBeenCalledExactlyOnceWith({
        command: 'npm',
        shell: process.platform === 'win32',
        source: 'terminal.spawn',
        launcher: 'spawn',
        ...auditContext,
      });
    });

    it('returns a running session with the correct pid and id', async () => {
      const session = await service.spawn('node', ['app.js'], '/project');
      expect(session.status).toBe('running');
      expect(session.pid).toBe(12345);
      expect(typeof session.id).toBe('string');
    });

    it('throws ForbiddenException when cwd is not in allowed roots', async () => {
      const svc = new TerminalService(makeAllowed(false));
      await expect(svc.spawn('node', [], '/forbidden')).rejects.toThrow(ForbiddenException);
    });

    it('appends stdout data to session output', async () => {
      const session = await service.spawn('node', [], '/project');
      proc.stdout.emit('data', Buffer.from('hello stdout'));
      expect(service.get(session.id)!.output).toContain('hello stdout');
    });

    it('appends stderr data to session output', async () => {
      const session = await service.spawn('node', [], '/project');
      proc.stderr.emit('data', Buffer.from('error line'));
      expect(service.get(session.id)!.output).toContain('error line');
    });

    it('marks session as exited with the correct code when process closes', async () => {
      const session = await service.spawn('node', [], '/project');
      proc.emit('close', 0);
      const s = service.get(session.id)!;
      expect(s.status).toBe('exited');
      expect(s.exitCode).toBe(0);
    });

    it('preserves "killed" status when process closes after kill()', async () => {
      const session = await service.spawn('node', [], '/project');
      service.kill(session.id);           // sets status = 'killed'
      proc.emit('close', null);
      expect(service.get(session.id)!.status).toBe('killed');
    });

    it('marks session as exited with code -1 on spawn error', async () => {
      const session = await service.spawn('node', [], '/project');
      proc.emit('error', new Error('ENOENT: no such file'));
      const s = service.get(session.id)!;
      expect(s.status).toBe('exited');
      expect(s.exitCode).toBe(-1);
    });
  });

  // ── list() and get() ──────────────────────────────────────────────────────

  describe('list() and get()', () => {
    it('list() returns an empty array before any spawns', () => {
      expect(service.list()).toEqual([]);
    });

    it('list() includes the newly-spawned session', async () => {
      await service.spawn('node', [], '/project');
      expect(service.list()).toHaveLength(1);
    });

    it('get() returns null for an unknown id', () => {
      expect(service.get('does-not-exist')).toBeNull();
    });
  });

  // ── kill() ────────────────────────────────────────────────────────────────

  describe('kill()', () => {
    it('returns false for an unknown session id', () => {
      expect(service.kill('nope')).toBe(false);
    });

    it('returns false for an already-exited session', async () => {
      const session = await service.spawn('node', [], '/project');
      proc.emit('close', 0);
      expect(service.kill(session.id)).toBe(false);
    });

    it('sends SIGTERM to the child process and returns true', async () => {
      const session = await service.spawn('node', [], '/project');
      expect(service.kill(session.id)).toBe(true);
      expect(proc.kill).toHaveBeenCalledWith('SIGTERM');
    });

    it('second kill on the same session returns false', async () => {
      const session = await service.spawn('node', [], '/project');
      service.kill(session.id);
      expect(service.kill(session.id)).toBe(false);
    });
  });

  // ── waitForExit() ─────────────────────────────────────────────────────────

  describe('waitForExit()', () => {
    it.each(['already exited', 'close listener', 'registration recheck'])('never converts unknown exit into success: %s', async (path) => {
      const session = await service.spawn('node', [], '/project');
      if (path === 'already exited') proc.emit('close', null, 'SIGTERM');
      if (path === 'registration recheck') {
        const originalOn = proc.on.bind(proc);
        vi.spyOn(proc, 'on').mockImplementation((event, listener) => {
          if (event === 'close') proc.emit('close', null, 'SIGTERM');
          return originalOn(event, listener);
        });
      }
      const waiting = service.waitForExit(session.id, 1000);
      if (path === 'close listener') proc.emit('close', null, 'SIGTERM');
      expect(await waiting).toEqual({ output: '', exitCode: -1 });
    });

    it.each([0, 7])('preserves known natural exit %s', async (code) => {
      const session = await service.spawn('node', [], '/project');
      const waiting = service.waitForExit(session.id, 1000);
      proc.emit('close', code);
      expect((await waiting).exitCode).toBe(code);
    });

    it('does not report a killed process as successful even when close supplies zero', async () => {
      const session = await service.spawn('node', [], '/project');
      const waiting = service.waitForExit(session.id, 1000);
      service.kill(session.id);
      proc.emit('close', 0);
      expect((await waiting).exitCode).toBe(-1);
    });

    it('rejects immediately for an unknown session id', async () => {
      await expect(service.waitForExit('nope', 1000)).rejects.toThrow('Terminal session not found');
    });

    it('resolves immediately when the session has already exited', async () => {
      const session = await service.spawn('node', [], '/project');
      proc.emit('close', 5);                                   // session is now 'exited'
      const result = await service.waitForExit(session.id, 1000);
      expect(result.exitCode).toBe(5);
    });

    it('resolves with the exit code when the process closes normally', async () => {
      const session = await service.spawn('node', [], '/project');
      const waitPromise = service.waitForExit(session.id, 5000);
      proc.emit('close', 42);                                  // simulate natural exit
      const result = await waitPromise;
      expect(result.exitCode).toBe(42);
    });

    it('rejects with a timeout error and calls proc.kill after timeout', async () => {
      vi.useFakeTimers();
      const session = await service.spawn('node', [], '/project');
      const waitPromise = service.waitForExit(session.id, 1000);
      vi.advanceTimersByTime(1100);
      await expect(waitPromise).rejects.toThrow('timed out');
      expect(proc.kill).toHaveBeenCalledWith('SIGTERM');
    });
  });

  // ── onModuleDestroy() ─────────────────────────────────────────────────────

  describe('onModuleDestroy()', () => {
    it('kills all running sessions and clears the session map', async () => {
      const proc2 = makeProc(22222);
      mockSpawnFn.mockReturnValueOnce(proc).mockReturnValueOnce(proc2);
      await service.spawn('node', [], '/project');
      await service.spawn('node', [], '/project');

      service.onModuleDestroy();

      expect(proc.kill).toHaveBeenCalledWith('SIGTERM');
      expect(proc2.kill).toHaveBeenCalledWith('SIGTERM');
      expect(service.list()).toHaveLength(0);
    });

    it('does not call kill on already-exited sessions', async () => {
      const session = await service.spawn('node', [], '/project');
      proc.emit('close', 0);              // now 'exited'
      proc.kill.mockClear();

      service.onModuleDestroy();

      expect(proc.kill).not.toHaveBeenCalled();
      expect(service.list()).toHaveLength(0);
    });
  });
});
