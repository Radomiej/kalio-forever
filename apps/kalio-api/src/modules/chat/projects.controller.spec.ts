import { describe, expect, it, vi } from 'vitest';
import { ProjectsController } from './projects.controller';

describe('ProjectsController', () => {
  it('delegates project listing and creation to the service', async () => {
    const service = {
      list: vi.fn().mockResolvedValue([]),
      create: vi.fn().mockResolvedValue({ id: 'project-1' }),
      rename: vi.fn().mockResolvedValue({ id: 'project-1' }),
    };
    const controller = new ProjectsController(service as never);

    expect(await controller.list()).toEqual([]);
    expect(await controller.create({ name: 'Kalio', path: 'C:/Kalio' })).toEqual({ id: 'project-1' });
    expect(await controller.rename('project-1', { name: 'Renamed' })).toEqual({ id: 'project-1' });
    expect(service.create).toHaveBeenCalledWith({ name: 'Kalio', path: 'C:/Kalio' });
    expect(service.rename).toHaveBeenCalledWith('project-1', { name: 'Renamed' });
  });
});
