import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AllowedPathsController } from './allowed-paths.controller';

const mockPath = {
  id: 'path-1',
  path: '/home/user/projects',
  createdAt: Date.now(),
};

function makeService() {
  return {
    findAll: vi.fn().mockResolvedValue([mockPath]),
    create: vi.fn().mockResolvedValue(mockPath),
    remove: vi.fn().mockResolvedValue(undefined),
  };
}

describe('AllowedPathsController', () => {
  let controller: AllowedPathsController;
  let svc: ReturnType<typeof makeService>;

  beforeEach(() => {
    svc = makeService();
    controller = new AllowedPathsController(svc as never);
  });

  describe('findAll()', () => {
    it('returns all allowed paths', async () => {
      const result = await controller.findAll();
      expect(svc.findAll).toHaveBeenCalled();
      expect(result).toEqual([mockPath]);
    });
  });

  describe('create()', () => {
    it('creates an allowed path', async () => {
      const dto = { path: '/new/path' };
      const result = await controller.create(dto);
      expect(svc.create).toHaveBeenCalledWith(dto);
      expect(result).toEqual(mockPath);
    });
  });

  describe('remove()', () => {
    it('removes an allowed path', async () => {
      await controller.remove('path-1');
      expect(svc.remove).toHaveBeenCalledWith('path-1');
    });
  });
});
