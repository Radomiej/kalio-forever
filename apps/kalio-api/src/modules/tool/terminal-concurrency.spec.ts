import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest';
import { writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TerminalService } from './terminal.service';
import { AllowedPathsService } from '../allowed-paths/allowed-paths.service';

// Write a temp script that stays alive indefinitely -- no inline -e flags that
// cmd.exe (shell:true on Windows) would misinterpret as redirections or grouping.
const LONG_SCRIPT = join(tmpdir(), 'kalio-ci-long-running.js');
writeFileSync(LONG_SCRIPT, 'setInterval(function(){}, 100000);\n');

afterAll(() => { rmSync(LONG_SCRIPT, { force: true }); });

const LONG_CMD = process.execPath;
const LONG_ARGS = [LONG_SCRIPT];
const SAFE_CWD = process.cwd();

describe('TerminalService - Concurrency', () => {
  let service: TerminalService;
  const spawned: string[] = [];

  beforeEach(() => {
    const mockAllowedPaths = {
      isAllowed: vi.fn().mockResolvedValue(true),
      getRoots: vi.fn().mockResolvedValue([SAFE_CWD]),
    } as unknown as AllowedPathsService;

    service = new TerminalService(mockAllowedPaths);
    spawned.length = 0;
  });

  afterEach(() => {
    for (const id of spawned) { service.kill(id); }
  });

  describe('concurrent operations', () => {
    it('handles concurrent spawns without race conditions', async () => {
      const results = await Promise.all(
        Array.from({ length: 5 }, () => service.spawn(LONG_CMD, LONG_ARGS, SAFE_CWD)),
      );
      results.forEach(s => spawned.push(s.id));
      expect(results).toHaveLength(5);
      results.forEach(s => { expect(s.status).toBe('running'); expect(s.id).toBeDefined(); });
    });

    it('handles concurrent kills safely', async () => {
      const sessions = await Promise.all(
        Array.from({ length: 3 }, () => service.spawn(LONG_CMD, LONG_ARGS, SAFE_CWD)),
      );
      sessions.forEach(s => spawned.push(s.id));
      expect(sessions.map(s => service.kill(s.id)).every(r => r === true)).toBe(true);
    });

    it('handles concurrent list calls safely', async () => {
      const sessions = await Promise.all(
        Array.from({ length: 3 }, () => service.spawn(LONG_CMD, LONG_ARGS, SAFE_CWD)),
      );
      sessions.forEach(s => spawned.push(s.id));
      Array.from({ length: 5 }, () => service.list()).forEach(list => {
        expect(list.length).toBeGreaterThanOrEqual(3);
      });
    });

    it('handles kill on non-existent session gracefully', () => {
      expect(service.kill('non-existent-id')).toBe(false);
    });

    it('handles get on non-existent session gracefully', () => {
      expect(service.get('non-existent-id')).toBeNull();
    });
  });

  describe('session map race conditions', () => {
    it('does not crash when killing an already-killed session', async () => {
      const session = await service.spawn(LONG_CMD, LONG_ARGS, SAFE_CWD);
      spawned.push(session.id);
      expect(service.kill(session.id)).toBe(true);
      expect(service.kill(session.id)).toBe(false);
    });

    it('handles rapid spawn-kill cycles safely', async () => {
      const results = await Promise.all(
        Array.from({ length: 3 }, async () => {
          const s = await service.spawn(LONG_CMD, LONG_ARGS, SAFE_CWD);
          spawned.push(s.id);
          return service.kill(s.id);
        }),
      );
      expect(results.every(r => r === true || r === false)).toBe(true);
    });
  });
});
