import { describe, expect, it, vi } from 'vitest';
import type { DrizzleService } from '../../database/drizzle.service';
import { ProjectsService, normalizeProjectPath } from './projects.service';

function makeDrizzle(rows: unknown[] = []) {
  return {
    db: {
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockResolvedValue(rows),
      }),
      insert: vi.fn().mockReturnValue({
        values: vi.fn().mockResolvedValue(undefined),
      }),
      update: vi.fn().mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue(undefined),
        }),
      }),
    },
  } as unknown as DrizzleService;
}

describe('ProjectsService', () => {
  it('normalizes equivalent Windows paths to one duplicate key', () => {
    expect(normalizeProjectPath(' C:\\Projects\\Kalio\\ ')).toBe('c:/projects/kalio');
    expect(normalizeProjectPath('c:/projects/kalio/')).toBe('c:/projects/kalio');
  });

  it('rejects creating a second project for the same normalized path', async () => {
    const drizzle = makeDrizzle([{
      id: 'project-1',
      name: 'Kalio',
      path: 'C:/Projects/Kalio',
      normalizedPath: 'c:/projects/kalio',
      kind: 'workspace',
      isSystem: false,
      createdAt: new Date(1),
      updatedAt: new Date(1),
    }]);
    const allowedPaths = { ensurePath: vi.fn() };
    const service = new ProjectsService(drizzle, allowedPaths as never);

    await expect(service.create({ name: 'Duplicate', path: 'c:\\projects\\kalio\\' }))
      .rejects.toMatchObject({ response: { projectId: 'project-1' } });
    expect(allowedPaths.ensurePath).not.toHaveBeenCalled();
  });

  it('creates a workspace project after validating its directory', async () => {
    const drizzle = makeDrizzle();
    const allowedPaths = { ensurePath: vi.fn().mockResolvedValue(undefined) };
    const service = new ProjectsService(drizzle, allowedPaths as never);

    const project = await service.create({ name: 'Kalio', path: 'C:\\Projects\\Kalio' });

    expect(project).toMatchObject({ name: 'Kalio', path: 'C:/Projects/Kalio', kind: 'workspace', isSystem: false });
    expect(allowedPaths.ensurePath).toHaveBeenCalledWith('C:/Projects/Kalio');
    expect(drizzle.db.insert).toHaveBeenCalled();
  });

  it('does not allow system project categories to be renamed', async () => {
    const drizzle = makeDrizzle([{
      id: 'system:none',
      name: 'Bez projektu',
      path: null,
      normalizedPath: null,
      kind: 'none',
      isSystem: true,
      createdAt: new Date(1),
      updatedAt: new Date(1),
    }]);
    const service = new ProjectsService(drizzle, { ensurePath: vi.fn() } as never);

    await expect(service.rename('system:none', { name: 'Renamed' }))
      .rejects.toThrow('System projects cannot be renamed.');
    expect(drizzle.db.update).not.toHaveBeenCalled();
  });
});
