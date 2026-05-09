import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { ToolController } from './tool.controller';
import type { ToolMeta } from '@kalio/types';

const mockTool: ToolMeta = {
  name: 'vfs_write',
  description: 'Write a file',
  parameters: {},
  requiresConfirmation: false,
};

function makeDrizzle() {
  return {
    db: {
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockResolvedValue([]),
      }),
      insert: vi.fn().mockReturnValue({
        values: vi.fn().mockReturnValue({
          onConflictDoUpdate: vi.fn().mockResolvedValue(undefined),
        }),
      }),
    },
  };
}

function makeRegistry(tools: ToolMeta[] = [mockTool]) {
  const entries = tools.map((meta) => ({ meta, execute: vi.fn() }));
  return {
    getEntries: vi.fn().mockReturnValue(entries),
    setOverride: vi.fn().mockReturnValue(true),
  };
}

describe('ToolController', () => {
  let controller: ToolController;
  let registry: ReturnType<typeof makeRegistry>;
  let drizzle: ReturnType<typeof makeDrizzle>;

  beforeEach(() => {
    registry = makeRegistry();
    drizzle = makeDrizzle();
    controller = new ToolController(registry as never, drizzle as never, null);
  });

  describe('onModuleInit()', () => {
    it('loads persisted overrides from DB', async () => {
      drizzle.db.select = vi.fn().mockReturnValue({
        from: vi.fn().mockResolvedValue([
          { toolName: 'vfs_write', requiresConfirmation: true },
        ]),
      });
      await controller.onModuleInit();
      expect(registry.setOverride).toHaveBeenCalledWith('vfs_write', true);
    });

    it('no-ops when DB is empty', async () => {
      await controller.onModuleInit();
      expect(registry.setOverride).not.toHaveBeenCalled();
    });
  });

  describe('findAll()', () => {
    it('returns tool meta list', () => {
      const result = controller.findAll();
      expect(result).toEqual([mockTool]);
    });
  });

  describe('updateOverride()', () => {
    it('sets override and returns updated meta', async () => {
      registry.setOverride.mockReturnValue(true);
      const result = await controller.updateOverride('vfs_write', { requiresConfirmation: true });
      expect(registry.setOverride).toHaveBeenCalledWith('vfs_write', true);
      expect(result).toEqual(mockTool);
    });

    it('throws NotFoundException when tool not found', async () => {
      registry.setOverride.mockReturnValue(false);
      await expect(
        controller.updateOverride('unknown_tool', { requiresConfirmation: false }),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
