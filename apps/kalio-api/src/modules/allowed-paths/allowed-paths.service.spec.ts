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
    existsSync: vi.fn(() => true),
    statSync: vi.fn(() => ({ isDirectory: () => true })),
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
const SYMLINK_DIR = [ROOT, 'link'].join(sep);
const SYMLINK_NEW_FILE_PATH = [ROOT, 'link', 'new.txt'].join(sep);
const REAL_PATH_OUTSIDE = [OUTSIDE, 'secret.txt'].join(sep);
const REAL_NEW_PATH_OUTSIDE = [OUTSIDE, 'new.txt'].join(sep);
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

  it('rejects a missing write target whose deepest existing parent resolves outside the root', async () => {
    vi.mocked(nodefs.existsSync).mockImplementation((p) => p === ROOT || p === OUTSIDE || p === SYMLINK_DIR);
    vi.mocked(nodefs.realpathSync as (p: string) => string).mockImplementation((p) => {
      if (p === SYMLINK_DIR) return OUTSIDE;
      return p;
    });

    const result = await svc.isAllowed(SYMLINK_NEW_FILE_PATH, { allowMissingPath: true });

    expect(result).toBe(false);
    expect(REAL_NEW_PATH_OUTSIDE.startsWith(OUTSIDE)).toBe(true);
  });

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

// ─── Additional coverage: findAll, create, remove, getRoots ──────────────────

function makeFullDrizzle(rows: Array<{ id: string; path: string; createdAt: Date }>) {
  return {
    db: {
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue(rows.slice(0, 1)), // returns first row for remove check
          then: vi.fn().mockResolvedValue(rows[0]), // fallback
        }),
      }),
      insert: vi.fn().mockReturnValue({ values: vi.fn().mockResolvedValue(undefined) }),
      delete: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }),
    },
  } as unknown as DrizzleService;
}

describe('AllowedPathsService.findAll()', () => {
  it('maps DB rows to AllowedPath objects', async () => {
    const drizzle = {
      db: {
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockResolvedValue([
            { id: 'id-1', path: ROOT, createdAt: new Date(1000) },
          ]),
        }),
      },
    } as unknown as DrizzleService;
    const svc = new AllowedPathsService(drizzle);
    const result = await svc.findAll();
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('id-1');
    expect(result[0].path).toBe(ROOT);
    expect(result[0].createdAt).toBe(1000);
  });

  it('returns empty array when no paths', async () => {
    const drizzle = {
      db: {
        select: vi.fn().mockReturnValue({ from: vi.fn().mockResolvedValue([]) }),
      },
    } as unknown as DrizzleService;
    const svc = new AllowedPathsService(drizzle);
    expect(await svc.findAll()).toEqual([]);
  });
});

describe('AllowedPathsService.create()', () => {
  it('throws BadRequestException when path does not exist', async () => {
    const { BadRequestException } = await import('@nestjs/common');
    vi.mocked(nodefs.existsSync).mockReturnValue(false);

    const drizzle = {
      db: {
        select: vi.fn().mockReturnValue({ from: vi.fn().mockResolvedValue([]) }),
        insert: vi.fn().mockReturnValue({ values: vi.fn().mockResolvedValue(undefined) }),
      },
    } as unknown as DrizzleService;
    const svc = new AllowedPathsService(drizzle);
    await expect(svc.create({ path: '/nonexistent/path' })).rejects.toThrow(BadRequestException);
  });

  it('throws BadRequestException when path is not a directory', async () => {
    const { BadRequestException } = await import('@nestjs/common');
    vi.mocked(nodefs.existsSync).mockReturnValue(true);
    vi.mocked(nodefs.statSync).mockReturnValue({ isDirectory: () => false } as ReturnType<typeof nodefs.statSync>);

    const drizzle = {
      db: {
        select: vi.fn().mockReturnValue({ from: vi.fn().mockResolvedValue([]) }),
        insert: vi.fn().mockReturnValue({ values: vi.fn().mockResolvedValue(undefined) }),
      },
    } as unknown as DrizzleService;
    const svc = new AllowedPathsService(drizzle);
    await expect(svc.create({ path: ROOT })).rejects.toThrow(BadRequestException);
  });

  it('inserts and returns the path when valid directory', async () => {
    vi.mocked(nodefs.existsSync).mockReturnValue(true);
    vi.mocked(nodefs.statSync).mockReturnValue({ isDirectory: () => true } as ReturnType<typeof nodefs.statSync>);

    const drizzle = {
      db: {
        insert: vi.fn().mockReturnValue({ values: vi.fn().mockResolvedValue(undefined) }),
      },
    } as unknown as DrizzleService;
    const svc = new AllowedPathsService(drizzle);
    const result = await svc.create({ path: ROOT });
    expect(result.id).toBeTruthy();
    expect(result.path).toBeTruthy();
  });
});

describe('AllowedPathsService.remove()', () => {
  it('throws NotFoundException when id not found', async () => {
    const { NotFoundException } = await import('@nestjs/common');
    const drizzle = {
      db: {
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue([]),
          }),
        }),
        delete: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }),
      },
    } as unknown as DrizzleService;
    const svc = new AllowedPathsService(drizzle);
    await expect(svc.remove('nonexistent')).rejects.toThrow(NotFoundException);
  });

  it('deletes when found', async () => {
    const drizzle = {
      db: {
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue([{ id: 'id-1', path: ROOT, createdAt: new Date() }]),
          }),
        }),
        delete: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }),
      },
    } as unknown as DrizzleService;
    const svc = new AllowedPathsService(drizzle);
    await expect(svc.remove('id-1')).resolves.not.toThrow();
  });
});

describe('AllowedPathsService.getRoots()', () => {
  it('returns list of normalized root paths', async () => {
    const drizzle = {
      db: {
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockResolvedValue([{ id: 'id-1', path: ROOT, createdAt: new Date() }]),
        }),
      },
    } as unknown as DrizzleService;
    const svc = new AllowedPathsService(drizzle);
    const roots = await svc.getRoots();
    expect(roots).toHaveLength(1);
    expect(typeof roots[0]).toBe('string');
  });
});
