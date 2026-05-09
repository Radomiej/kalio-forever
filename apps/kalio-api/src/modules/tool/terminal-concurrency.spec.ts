import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TerminalService } from './terminal.service';
import { AllowedPathsService } from '../allowed-paths/allowed-paths.service';

// Cross-platform long-running command: node REPL reads from stdin pipe — stays alive
// --interactive has no shell metacharacters → safe for cmd.exe (shell:true on Windows)
const LONG_CMD = process.execPath;
const LONG_ARGS = ['--interactive'];
const SAFE_CWD = process.cwd();

describe('TerminalService - Concurrency', () => {
  let service: TerminalService;
  let mockAllowedPaths: AllowedPathsService;
  const spawned: string[] = [];

  beforeEach(() => {
    mockAllowedPaths = {
      isAllowed: vi.fn().mockResolvedValue(true),
      getRoots: vi.fn().mockResolvedValue([SAFE_CWD]),
    } as unknown as AllowedPathsService;

    service = new TerminalService(mockAllowedPaths);
    spawned.length = 0;
  });

  afterEach(() => {
    // Kill every process spawned during the test, ignoring already-dead ones
    for (const id of spawned) {
      service.kill(id);
    }
  });

  describe('concurrent operations', () => {
    it('should handle concurrent spawn operations without race conditions', async () => {
      const results = await Promise.all(
        Array.from({ length: 5 }, () => service.spawn(LONG_CMD, LONG_ARGS, SAFE_CWD)),
      );

      results.forEach(s => spawned.push(s.id));

      expect(results).toHaveLength(5);
      results.forEach(session => {
        expect(session.status).toBe('running');
        expect(session.id).toBeDefined();
      });
    });

    it('should handle concurrent kill operations safely', async () => {
      const sessions = await Promise.all(
        Array.from({ length: 3 }, () => service.spawn(LONG_CMD, LONG_ARGS, SAFE_CWD)),
      );
      sessions.forEach(s => spawned.push(s.id));

      const results = sessions.map(s => service.kill(s.id));

      expect(results).toHaveLength(3);
      expect(results.every(r => r === true)).toBe(true);
    });

    it('should handle concurrent list operations safely', async () => {
      const sessions = await Promise.all(
        Array.from({ length: 3 }, () => service.spawn(LONG_CMD, LONG_ARGS, SAFE_CWD)),
      );
      sessions.forEach(s => spawned.push(s.id));

      const listResults = Array.from({ length: 5 }, () => service.list());

      expect(listResults).toHaveLength(5);
      listResults.forEach(list => {
        // At least the 3 sessions we spawned should appear (may include already-killed ones)
        expect(list.length).toBeGreaterThanOrEqual(3);
      });
    });

    it('should handle kill on non-existent session gracefully', () => {
      expect(service.kill('non-existent-id')).toBe(false);
    });

    it('should handle get on non-existent session gracefully', () => {
      expect(service.get('non-existent-id')).toBeNull();
    });
  });

  describe('waitForExit and onModuleDestroy', () => {
    it('waitForExit rejects for a non-existent session id', async () => {
      await expect(service.waitForExit('no-such-id', 1000)).rejects.toThrow('Terminal session not found');
    });

    it('waitForExit resolves immediately for an already-killed session', async () => {
      const s = await service.spawn(LONG_CMD, LONG_ARGS, SAFE_CWD);
      spawned.push(s.id);
      service.kill(s.id);
      // Service returns exitCode ?? 0, so a SIGTERM'd session (null code) returns 0
      const result = await service.waitForExit(s.id, 1000);
      expect(result.exitCode).toBe(0);
    });

    it('waitForExit rejects after timeout and kills the process', async () => {
      const s = await service.spawn(LONG_CMD, LONG_ARGS, SAFE_CWD);
      spawned.push(s.id);
      await expect(service.waitForExit(s.id, 50)).rejects.toThrow('timed out');
    });

    it('waitForExit resolves with exit code when process exits naturally', async () => {
      // process.exitCode = N: assignment without parens — safe for cmd.exe shell:true on Windows
      const s = await service.spawn(process.execPath, ['-e', 'process.exitCode = 42'], SAFE_CWD);
      spawned.push(s.id);
      const result = await service.waitForExit(s.id, 5000);
      expect(result.exitCode).toBe(42);
    });

    it('onModuleDestroy kills all running sessions and clears the map', async () => {
      const s1 = await service.spawn(LONG_CMD, LONG_ARGS, SAFE_CWD);
      const s2 = await service.spawn(LONG_CMD, LONG_ARGS, SAFE_CWD);
      // Don't track in spawned — onModuleDestroy is the cleanup
      service.onModuleDestroy();
      expect(service.list()).toHaveLength(0);
      // Ensure afterEach kill calls are no-ops (already cleared)
      spawned.push(s1.id, s2.id);
    });
  });

  describe('session map race conditions', () => {
    it('should not crash when killing a session that is already being killed', async () => {
      const session = await service.spawn(LONG_CMD, LONG_ARGS, SAFE_CWD);
      spawned.push(session.id);

      const result1 = service.kill(session.id);
      const result2 = service.kill(session.id);

      // First kill succeeds, second fails (already killed)
      expect(result1).toBe(true);
      expect(result2).toBe(false);
    });

    it('should handle rapid spawn-kill cycles safely', async () => {
      const operations = await Promise.all(
        Array.from({ length: 3 }, async () => {
          const session = await service.spawn(LONG_CMD, LONG_ARGS, SAFE_CWD);
          spawned.push(session.id);
          return service.kill(session.id);
        }),
      );

      expect(operations).toHaveLength(3);
      expect(operations.every(r => r === true || r === false)).toBe(true);
    });
  });
});
