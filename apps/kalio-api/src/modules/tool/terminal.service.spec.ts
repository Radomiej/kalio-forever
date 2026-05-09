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

  beforeEach(() => {
    proc = makeProc();
    mockSpawnFn.mockReturnValue(proc);
    service = new TerminalService(makeAllowed());
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  // ── spawn() ──────────────────────────────────────────────────────────────

  describe('spawn()', () => {
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
