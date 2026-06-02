import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { SkillsController } from './skills.controller';

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

  describe('findOne()', () => {
    it('throws NotFoundException when skill not found', async () => {
      svc.findOne.mockResolvedValue(null);
      await expect(controller.findOne('missing')).rejects.toThrow(NotFoundException);
    });
  });

  describe('update()', () => {
    it('throws NotFoundException when skill not found on update', async () => {
      svc.update.mockResolvedValue(null);
      await expect(controller.update('missing', {})).rejects.toThrow(NotFoundException);
    });
  });

  describe('remove()', () => {
    it('returns the API success envelope after deletion', async () => {
      const result = await controller.remove('skill-1');
      expect(result).toEqual({ success: true });
    });
  });
});
