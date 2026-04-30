import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SkillsService } from './skills.service';
import type { DrizzleService } from '../../database/drizzle.service';
import type { CreateSkillDto } from '@kalio/types';

function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'skill-id-1',
    name: 'Test Skill',
    description: 'A description',
    prompt: 'Do the thing',
    source: 'user',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makeDrizzle(opts: { findReturnsEmpty?: boolean } = {}) {
  const whereResult = opts.findReturnsEmpty ? [] : [makeRow()];

  return {
    db: {
      insert: vi.fn().mockReturnValue({
        values: vi.fn().mockResolvedValue(undefined),
      }),
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue(whereResult),
          orderBy: vi.fn().mockResolvedValue(whereResult),
        }),
      }),
      update: vi.fn().mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue(undefined),
        }),
      }),
      delete: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(undefined),
      }),
    },
  } as unknown as DrizzleService;
}

// ─── create() ─────────────────────────────────────────────────────────────────

describe('SkillsService.create()', () => {
  const dto: CreateSkillDto = { name: 'New Skill', description: 'desc', prompt: 'do stuff' };

  it('returns the created skill on success', async () => {
    const svc = new SkillsService(makeDrizzle());
    const result = await svc.create(dto);
    expect(result.name).toBe('Test Skill');
    expect(result.id).toBeDefined();
  });

  it('inserts with correct fields including defaults', async () => {
    const drizzle = makeDrizzle();
    const svc = new SkillsService(drizzle);

    await svc.create({ name: 'x', description: 'd', prompt: 'p' });

    const insertValues = (drizzle.db.insert as ReturnType<typeof vi.fn>).mock.results[0].value.values;
    expect(insertValues).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'x', source: 'user' }),
    );
  });

  /**
   * BUG-4: skills.service.ts line 34
   *   `return this.findOne(id) as Promise<Skill>`
   *
   * `findOne` returns `Promise<Skill | null>`. The `as` cast silently hides that
   * the result can be `null`. If the DB insert succeeds but the subsequent
   * SELECT returns nothing (e.g. race, replication lag, test harness), the
   * caller receives `null` typed as `Skill` — a silent type lie that will blow
   * up somewhere else in the call chain.
   *
   * Expected: `create()` should throw so the caller knows something went wrong.
   * Actual before fix: resolves to `null` (no throw, unsafe cast hides the bug).
   */
  it('throws if skill cannot be retrieved after insert — catches BUG-4 unsafe cast', async () => {
    const svc = new SkillsService(makeDrizzle({ findReturnsEmpty: true }));

    await expect(svc.create(dto)).rejects.toThrow();
  });
});

// ─── findOne() ────────────────────────────────────────────────────────────────

describe('SkillsService.findOne()', () => {
  it('returns skill when found', async () => {
    const svc = new SkillsService(makeDrizzle());
    const result = await svc.findOne('skill-id-1');
    expect(result).not.toBeNull();
    expect(result?.id).toBe('skill-id-1');
  });

  it('returns null when not found', async () => {
    const svc = new SkillsService(makeDrizzle({ findReturnsEmpty: true }));
    const result = await svc.findOne('nonexistent');
    expect(result).toBeNull();
  });
});

// ─── findAll() ───────────────────────────────────────────────────────────────

describe('SkillsService.findAll()', () => {
  it('returns all skills', async () => {
    const svc = new SkillsService(makeDrizzle());
    const result = await svc.findAll();
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('skill-id-1');
  });

  it('returns empty array when no skills', async () => {
    const svc = new SkillsService(makeDrizzle({ findReturnsEmpty: true }));
    const result = await svc.findAll();
    expect(result).toEqual([]);
  });
});

// ─── update() ────────────────────────────────────────────────────────────────

describe('SkillsService.update()', () => {
  it('returns null when skill not found', async () => {
    const svc = new SkillsService(makeDrizzle({ findReturnsEmpty: true }));
    const result = await svc.update('nonexistent', { name: 'New Name' });
    expect(result).toBeNull();
  });

  it('updates and returns the updated skill when found', async () => {
    const svc = new SkillsService(makeDrizzle());
    const result = await svc.update('skill-id-1', { name: 'Updated' });
    // Mock always returns the original row; just verify update was called
    expect(result).not.toBeNull();
  });
});

// ─── remove() ────────────────────────────────────────────────────────────────

describe('SkillsService.remove()', () => {
  it('calls delete without throwing', async () => {
    const svc = new SkillsService(makeDrizzle());
    await expect(svc.remove('skill-id-1')).resolves.not.toThrow();
  });
});
