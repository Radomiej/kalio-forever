import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Test, type TestingModule } from '@nestjs/testing';
import { PersonaService } from './persona.service';
import { DrizzleService } from '../../database/drizzle.service';
import { NotFoundException } from '@nestjs/common';

// Regression test for: Persona KV Lookup Inefficiency
// Issue: setKV queries all KV rows for persona then filters client-side
// Should add key to SQL WHERE clause for database-level filtering

describe('PersonaService', () => {
  let service: PersonaService;
  let drizzleService: DrizzleService;
  let mockDb: any;

  beforeEach(async () => {
    mockDb = {
      select: vi.fn(),
      insert: vi.fn().mockReturnValue({ values: vi.fn().mockResolvedValue(undefined) }),
      update: vi.fn().mockReturnValue({ set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }) }),
      delete: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }),
    };

    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        PersonaService,
        {
          provide: DrizzleService,
          useValue: {
            db: mockDb,
          },
        },
      ],
    }).compile();

    service = moduleRef.get<PersonaService>(PersonaService);
    drizzleService = moduleRef.get<DrizzleService>(DrizzleService);
  });

  describe('setKV - Inefficient Query Pattern (REGRESSION TEST)', () => {
    it('should demonstrate current inefficient query pattern', async () => {
      // Arrange
      const personaId = 'persona-123';
      const key = 'api_key';
      const value = 'secret-value';

      // Setup mocks to simulate DB responses
      const mockWhereChain = {
        where: vi.fn().mockReturnValue({
          then: vi.fn().mockResolvedValue([
            { id: 'kv-1', personaId, key: 'other_key', value: 'other_value' },
            { id: 'kv-2', personaId, key, value: 'old_value' }, // target key
            { id: 'kv-3', personaId, key: 'another_key', value: 'another_value' },
          ]),
        }),
      };

      mockDb.select.mockReturnValue({
        from: vi.fn().mockReturnValue(mockWhereChain),
      });

      // Act
      await service.setKV(personaId, key, value);

      // Assert - Current implementation retrieves ALL KV rows for persona
      // Then filters client-side with .find()
      // Inefficient: should filter by key in SQL WHERE clause

      expect(mockDb.select).toHaveBeenCalled();
      expect(mockWhereChain.where).toHaveBeenCalled();

      // The regression: currently fetches all KV rows for personaId
      // then does: rows.find((r) => r.key === key) on client side
      // Should be: WHERE persona_id = X AND key = Y
    });

    it('should throw NotFoundException when persona does not exist', async () => {
      // Arrange
      const mockWhereChain = {
        where: vi.fn().mockReturnValue({
          then: vi.fn().mockResolvedValue([]), // No persona found
        }),
      };

      mockDb.select.mockReturnValue({
        from: vi.fn().mockReturnValue(mockWhereChain),
      });

      // Act & Assert
      await expect(service.setKV('non-existent', 'key', 'value')).rejects.toThrow(NotFoundException);
    });
  });

  describe('getSessionConfig', () => {
    it('should return null when persona not found', async () => {
      // Arrange
      const mockWhereChain = {
        where: vi.fn().mockReturnValue({
          then: vi.fn().mockResolvedValue([]),
        }),
      };

      mockDb.select.mockReturnValue({
        from: vi.fn().mockReturnValue(mockWhereChain),
      });

      // Act
      const result = await service.getSessionConfig('non-existent');

      // Assert
      expect(result).toBeNull();
    });

    it('should return session config with all KV entries', async () => {
      // Arrange
      const personaId = 'persona-123';
      const personaRow = {
        id: personaId,
        name: 'Test Persona',
        systemPrompt: 'You are helpful',
        model: 'gpt-4',
        skills: ['vfs_write'],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      const kvRows = [
        { id: 'kv-1', personaId, key: 'api_key', value: 'secret123', updatedAt: Date.now() },
        { id: 'kv-2', personaId, key: 'endpoint', value: 'https://api.example.com', updatedAt: Date.now() },
      ];

      let callCount = 0;
      mockDb.select.mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            then: vi.fn().mockImplementation(() => {
              callCount++;
              if (callCount === 1) return Promise.resolve([personaRow]);
              return Promise.resolve(kvRows);
            }),
          }),
        }),
      });

      // Act
      const result = await service.getSessionConfig(personaId);

      // Assert
      expect(result).not.toBeNull();
      expect(result?.systemPrompt).toBe(personaRow.systemPrompt);
      expect(result?.model).toBe(personaRow.model);
      expect(result?.availableSkills).toEqual(['vfs_write']);
      expect(result?.kv).toEqual({
        api_key: 'secret123',
        endpoint: 'https://api.example.com',
      });
    });
  });

  describe('findAll', () => {
    it('should return all personas mapped correctly', async () => {
      // Arrange
      const mockRows = [
        {
          id: 'p1',
          name: 'Persona 1',
          systemPrompt: 'Prompt 1',
          model: 'gpt-4',
          skills: ['tool1'],
          createdAt: 1234567890,
          updatedAt: 1234567890,
        },
        {
          id: 'p2',
          name: 'Persona 2',
          systemPrompt: 'Prompt 2',
          model: 'claude',
          skills: null, // Test null handling
          createdAt: new Date(1234567890), // Test Date handling
          updatedAt: new Date(1234567890),
        },
      ];

      mockDb.select.mockReturnValue({
        from: vi.fn().mockResolvedValue(mockRows),
      });

      // Act
      const result = await service.findAll();

      // Assert
      expect(result).toHaveLength(2);
      expect(result[0].skills).toEqual(['tool1']);
      expect(result[1].skills).toEqual([]); // Null becomes empty array
      expect(typeof result[1].createdAt).toBe('number'); // Date converted to number
    });
  });

  describe('CRUD Operations', () => {
    it('findOne should throw NotFoundException for non-existent persona', async () => {
      mockDb.select.mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            then: vi.fn().mockResolvedValue([]),
          }),
        }),
      });

      await expect(service.findOne('non-existent')).rejects.toThrow(NotFoundException);
    });

    it('update should call findOne first to verify existence', async () => {
      // This tests the pattern: findOne (throws if not exists) -> update
      const existingPersona = {
        id: 'p1',
        name: 'Old Name',
        systemPrompt: 'Old Prompt',
        model: 'gpt-4',
        skills: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      mockDb.select.mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            then: vi.fn().mockResolvedValue([existingPersona]),
          }),
        }),
      });

      await service.update('p1', { name: 'New Name' });

      expect(mockDb.update).toHaveBeenCalled();
    });
  });
});
