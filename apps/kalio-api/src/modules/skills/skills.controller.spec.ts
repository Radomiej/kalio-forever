import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { SkillsController } from './skills.controller';
import type { CreateSkillDto, UpdateSkillDto } from '@kalio/types';

const mockSkill = {
  id: 'skill-1',
  name: 'Test Skill',
  content: 'Some content',
  description: 'desc',
  createdAt: Date.now(),
  updatedAt: Date.now(),
};

function makeService() {
  return {
    findAll: vi.fn().mockResolvedValue([mockSkill]),
    findOne: vi.fn().mockResolvedValue(mockSkill),
    create: vi.fn().mockResolvedValue(mockSkill),
    update: vi.fn().mockResolvedValue(mockSkill),
    remove: vi.fn().mockResolvedValue(undefined),
  };
}

describe('SkillsController', () => {
  let controller: SkillsController;
  let svc: ReturnType<typeof makeService>;

  beforeEach(() => {
    svc = makeService();
    controller = new SkillsController(svc as never);
  });

  describe('findAll()', () => {
    it('returns all skills', async () => {
      const result = await controller.findAll();
      expect(svc.findAll).toHaveBeenCalled();
      expect(result).toEqual([mockSkill]);
    });
  });

  describe('findOne()', () => {
    it('returns a skill by id', async () => {
      const result = await controller.findOne('skill-1');
      expect(svc.findOne).toHaveBeenCalledWith('skill-1');
      expect(result).toEqual(mockSkill);
    });

    it('throws NotFoundException when skill not found', async () => {
      svc.findOne.mockResolvedValue(null);
      await expect(controller.findOne('missing')).rejects.toThrow(NotFoundException);
    });
  });

  describe('create()', () => {
    it('creates a skill', async () => {
      const dto: CreateSkillDto = { name: 'New Skill', prompt: 'content', description: 'desc' };
      const result = await controller.create(dto);
      expect(svc.create).toHaveBeenCalledWith(dto);
      expect(result).toEqual(mockSkill);
    });
  });

  describe('update()', () => {
    it('updates a skill by id', async () => {
      const dto: UpdateSkillDto = { name: 'Updated' };
      const result = await controller.update('skill-1', dto);
      expect(svc.update).toHaveBeenCalledWith('skill-1', dto);
      expect(result).toEqual(mockSkill);
    });

    it('throws NotFoundException when skill not found on update', async () => {
      svc.update.mockResolvedValue(null);
      await expect(controller.update('missing', {})).rejects.toThrow(NotFoundException);
    });
  });

  describe('remove()', () => {
    it('removes a skill and returns success', async () => {
      const result = await controller.remove('skill-1');
      expect(svc.remove).toHaveBeenCalledWith('skill-1');
      expect(result).toEqual({ success: true });
    });
  });
});
