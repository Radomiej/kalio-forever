import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PersonaController } from './persona.controller';
import type { CreatePersonaDto, UpdatePersonaDto } from '@kalio/types';

const mockPersona = {
  id: 'persona-1',
  name: 'Test Persona',
  description: 'desc',
  systemPrompt: 'You are helpful.',
  isDefault: false,
  avatarUrl: null,
  createdAt: Date.now(),
  updatedAt: Date.now(),
};

function makeService() {
  return {
    findAll: vi.fn().mockResolvedValue([mockPersona]),
    findOne: vi.fn().mockResolvedValue(mockPersona),
    create: vi.fn().mockResolvedValue(mockPersona),
    update: vi.fn().mockResolvedValue(mockPersona),
    validateGraphConfig: vi.fn().mockResolvedValue({ ok: true, errors: [] }),
    remove: vi.fn().mockResolvedValue(undefined),
  };
}

describe('PersonaController', () => {
  let controller: PersonaController;
  let svc: ReturnType<typeof makeService>;

  beforeEach(() => {
    svc = makeService();
    controller = new PersonaController(svc as never);
  });

  describe('findAll()', () => {
    it('returns all personas', async () => {
      const result = await controller.findAll();
      expect(svc.findAll).toHaveBeenCalled();
      expect(result).toEqual([mockPersona]);
    });
  });

  describe('findOne()', () => {
    it('returns a persona by id', async () => {
      const result = await controller.findOne('persona-1');
      expect(svc.findOne).toHaveBeenCalledWith('persona-1');
      expect(result).toEqual(mockPersona);
    });
  });

  describe('create()', () => {
    it('creates a persona', async () => {
      const dto: CreatePersonaDto = {
        name: 'New Persona',
        systemPrompt: 'Be helpful',
        model: 'gpt-4o',
        allowedTools: [],
      };
      const result = await controller.create(dto);
      expect(svc.create).toHaveBeenCalledWith(dto);
      expect(result).toEqual(mockPersona);
    });
  });

  describe('update()', () => {
    it('updates a persona by id', async () => {
      const dto: UpdatePersonaDto = { name: 'Updated' };
      const result = await controller.update('persona-1', dto);
      expect(svc.update).toHaveBeenCalledWith('persona-1', dto);
      expect(result).toEqual(mockPersona);
    });
  });

  describe('validateGraph()', () => {
    it('delegates graph validation to the persona service', async () => {
      const graphConfig = {
        version: 1,
        entryNodeId: 'router-1',
        maxSteps: 6,
        nodes: [
          { id: 'router-1', type: 'router', label: 'Router' },
          { id: 'final-1', type: 'final', label: 'Done' },
        ],
        edges: [{ id: 'edge-1', sourceNodeId: 'router-1', targetNodeId: 'final-1' }],
      };

      const result = await controller.validateGraph('persona-1', graphConfig);

      expect(svc.validateGraphConfig).toHaveBeenCalledWith('persona-1', graphConfig);
      expect(result).toEqual({ ok: true, errors: [] });
    });
  });

  describe('remove()', () => {
    it('removes a persona', async () => {
      await controller.remove('persona-1');
      expect(svc.remove).toHaveBeenCalledWith('persona-1');
    });
  });
});
