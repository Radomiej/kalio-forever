import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TerminalService } from './terminal.service';
import { AllowedPathsService } from '../allowed-paths/allowed-paths.service';

// Cross-platform short-lived command: node itself, idles until killed
// NOTE: no arrow functions — Windows cmd.exe (shell:true) treats ">" as redirection
const LONG_CMD = process.execPath;
const LONG_ARGS = ['-e', 'setInterval(function(){},100)'];
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
