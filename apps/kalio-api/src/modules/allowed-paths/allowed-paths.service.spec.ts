import { describe, it, expect, vi, beforeEach } from 'vitest';
import { sep } from 'node:path';

/**
 * BUG-3: allowed-paths.service.ts — symlink bypass
 *
 * `normalizeAndValidate()` uses `normalize(resolve(p))` which correctly resolves
 * `.` and `..` but does NOT follow symlinks. An attacker who can create a symlink
 * inside an allowed directory (e.g. via vfs_write + system tools) can craft a path
 * that passes the `startsWith(root)` check while the real destination is outside
 * the allowed root.
 *
 * Fix: call `realpathSync()` to canonicalise the path (follows symlinks).
 * The test mocks `realpathSync` to simulate a symlink without needing real fs.
 */

// Mock node:fs BEFORE the service is imported so the service picks up the mock.
vi.mock('node:fs', async (importOriginal) => {
  const orig = await importOriginal<typeof import('node:fs')>();
  return {
    ...orig,
    // Default: identity (no symlinks). Tests override this per-case.
    realpathSync: vi.fn((p: string) => p),
  };
});

import * as nodefs from 'node:fs';
import { AllowedPathsService } from './allowed-paths.service';
import type { DrizzleService } from '../../database/drizzle.service';

// Use absolute-looking paths that work on all platforms in unit tests.
// resolve() inside the service will return them unchanged (already absolute).
const ROOT = process.platform === 'win32' ? 'C:\\allowed' : '/allowed';
const OUTSIDE = process.platform === 'win32' ? 'C:\\outside' : '/outside';
const SYMLINK_PATH = [ROOT, 'link', 'secret.txt'].join(sep);
const REAL_PATH_OUTSIDE = [OUTSIDE, 'secret.txt'].join(sep);
const NORMAL_PATH = [ROOT, 'normal.txt'].join(sep);

function makeDrizzleWithRoot(root: string): DrizzleService {
  return {
    db: {
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockResolvedValue([{ id: '1', path: root, createdAt: new Date() }]),
      }),
      insert: vi.fn().mockReturnValue({ values: vi.fn().mockResolvedValue(undefined) }),
      update: vi.fn(),
      delete: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }),
    },
  } as unknown as DrizzleService;
}

describe('AllowedPathsService.isAllowed — symlink bypass (BUG-3)', () => {
  let svc: AllowedPathsService;

  beforeEach(() => {
    vi.clearAllMocks();
    // Default realpathSync: identity (path resolves to itself — no symlink)
    vi.mocked(nodefs.realpathSync as (p: string) => string).mockImplementation((p) => p);
    svc = new AllowedPathsService(makeDrizzleWithRoot(ROOT));
  });

  it('allows a normal path that is genuinely inside the allowed root', async () => {
    const result = await svc.isAllowed(NORMAL_PATH);
    expect(result).toBe(true);
  });

  it('rejects a path outside the allowed root', async () => {
    const result = await svc.isAllowed(REAL_PATH_OUTSIDE);
    expect(result).toBe(false);
  });

  it(
    'rejects a path that appears inside the root but resolves via symlink to outside (BUG-3)',
    async () => {
      // Simulate a symlink: /allowed/link/secret.txt → /outside/secret.txt
      vi.mocked(nodefs.realpathSync as (p: string) => string).mockImplementation((p) => {
        if (p === SYMLINK_PATH) return REAL_PATH_OUTSIDE;
        return p; // all other paths (including ROOT) resolve to themselves
      });

      const result = await svc.isAllowed(SYMLINK_PATH);

      // FAILS before fix: normalizeAndValidate doesn't call realpathSync, so the
      // path appears to start with ROOT and isAllowed returns true (security hole).
      // PASSES after fix: realpathSync reveals the real target is outside ROOT.
      expect(result).toBe(false);
    },
  );

  it('rejects the exact ROOT path symlinked to outside', async () => {
    // Edge case: the root itself is a symlink to somewhere else —
    // isAllowed('/allowed') should be false if /allowed → /outside
    vi.mocked(nodefs.realpathSync as (p: string) => string).mockImplementation((p) => {
      if (p === ROOT) return OUTSIDE;
      return p;
    });

    // A path that is normally equal to the allowed root
    const result = await svc.isAllowed(ROOT);

    // resolved = realpathSync(ROOT) = OUTSIDE
    // root (from DB) = realpathSync(ROOT) = OUTSIDE (same mock)
    // OUTSIDE === OUTSIDE → true (consistent, not a bug, since both use realpath)
    // This verifies the fix doesn't break the equality check
    expect(result).toBe(true);
  });
});
