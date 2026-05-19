import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AllowedPathsController } from './allowed-paths.controller';

describe('AllowedPathsController', () => {
  let controller: AllowedPathsController;
  let service: {
    findAll: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    remove: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    service = {
      findAll: vi.fn().mockResolvedValue([{ id: 'root', path: '/allowed', createdAt: 1 }]),
      create: vi.fn().mockResolvedValue({ id: 'root', path: '/allowed', createdAt: 1 }),
      remove: vi.fn().mockResolvedValue(undefined),
    };
    controller = new AllowedPathsController(service as never);
  });

  it('delegates findAll and create to the service', async () => {
    await expect(controller.findAll()).resolves.toEqual([{ id: 'root', path: '/allowed', createdAt: 1 }]);
    await expect(controller.create({ path: '/allowed' })).resolves.toEqual({ id: 'root', path: '/allowed', createdAt: 1 });
    expect(service.findAll).toHaveBeenCalledTimes(1);
    expect(service.create).toHaveBeenCalledWith({ path: '/allowed' });
  });

  it('exposes a no-content delete route that delegates remove', async () => {
    await expect(controller.remove('root')).resolves.toBeUndefined();
    expect(service.remove).toHaveBeenCalledWith('root');
  });
});
