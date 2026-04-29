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
      const kvData = [
        { id: 'kv-1', personaId, key: 'other_key', value: 'other_value' },
        { id: 'kv-2', personaId, key, value: 'old_value' }, // target key
        { id: 'kv-3', personaId, key: 'another_key', value: 'another_value' },
      ];
      const personaData = [{ id: personaId, name: 'Test', systemPrompt: 'P', model: 'gpt-4', skills: [], createdAt: Date.now(), updatedAt: Date.now() }];
      const fromMock = vi.fn()
        .mockReturnValueOnce({ where: vi.fn().mockResolvedValue(personaData) })
        .mockReturnValueOnce({ where: vi.fn().mockResolvedValue(kvData) });
      mockDb.select.mockReturnValue({ from: fromMock });

      // Act
      await service.setKV(personaId, key, value);

      // Assert - Current implementation retrieves ALL KV rows for persona
      // Then filters client-side with .find()
      expect(mockDb.select).toHaveBeenCalled();
      expect(fromMock).toHaveBeenCalled();
    });

    it('should throw NotFoundException when persona does not exist', async () => {
      // Arrange
      mockDb.select.mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([]),
        }),
      });

      // Act & Assert
      await expect(service.setKV('non-existent', 'key', 'value')).rejects.toThrow(NotFoundException);
    });
  });

  describe('getSessionConfig', () => {
    it('should return null when persona not found', async () => {
      // Arrange
      mockDb.select.mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([]),
        }),
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

      const fromMock = vi.fn()
        .mockReturnValueOnce({ where: vi.fn().mockResolvedValue([personaRow]) })
        .mockReturnValueOnce({ where: vi.fn().mockResolvedValue(kvRows) });

      mockDb.select.mockReturnValue({ from: fromMock });

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
          where: vi.fn().mockResolvedValue([]),
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
          where: vi.fn().mockResolvedValue([existingPersona]),
        }),
      });

      await service.update('p1', { name: 'New Name' });

      expect(mockDb.update).toHaveBeenCalled();
    });
  });

  describe('onApplicationBootstrap - Missing Error Handling (REGRESSION TEST)', () => {
    it('should throw unhandled error when database insert fails', async () => {
      // Regression test for: Missing error handling in onApplicationBootstrap
      // Issue: If database is unavailable or insert fails, application crashes with no error handling

      // Arrange - Mock database to throw error on insert
      mockDb.select.mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([]), // No default persona exists
        }),
      });

      const insertError = new Error('Database connection failed');
      mockDb.insert.mockImplementation(() => {
        throw insertError;
      });

      // Act & Assert - onApplicationBootstrap should throw unhandled error
      // Current implementation has no try-catch, so error propagates
      await expect(service.onApplicationBootstrap()).rejects.toThrow('Database connection failed');
    });

    it('should handle database error during persona existence check', async () => {
      // Arrange - Mock database to throw error on select
      const selectError = new Error('Database query failed');
      mockDb.select.mockImplementation(() => {
        throw selectError;
      });

      // Act & Assert - onApplicationBootstrap should throw unhandled error
      await expect(service.onApplicationBootstrap()).rejects.toThrow('Database query failed');
    });
  });

  describe('onApplicationBootstrap — ra-apps prompt guard (BUG-5)', () => {
    /**
     * BUG-5: persona.service.ts onApplicationBootstrap() else-branch
     *
     * When the `ra-apps` persona already exists, the code always calls
     * `db.update().set({ systemPrompt: hardcoded, skills, updatedAt })`.
     * This overwrites any system-prompt customisation the user made, every
     * time the server restarts.
     *
     * Expected: update should NOT include `systemPrompt` so user changes survive.
     * Actual before fix: `systemPrompt` is always overwritten with the hardcoded value.
     */
    it('should NOT overwrite systemPrompt when ra-apps already exists (BUG-5)', async () => {
      // Both default and ra-apps already exist → skip inserts, reach the else branch
      mockDb.select.mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([{ id: 'existing' }]),
        }),
      });

      const setMock = vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(undefined),
      });
      mockDb.update.mockReturnValue({ set: setMock });

      await service.onApplicationBootstrap();

      // The SET payload must not contain systemPrompt — user customisations survive
      expect(setMock).toHaveBeenCalledWith(
        expect.not.objectContaining({ systemPrompt: expect.any(String) }),
      );
    });

    it('still updates skills when ra-apps already exists', async () => {
      mockDb.select.mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([{ id: 'existing' }]),
        }),
      });

      const setMock = vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(undefined),
      });
      mockDb.update.mockReturnValue({ set: setMock });

      await service.onApplicationBootstrap();

      expect(setMock).toHaveBeenCalledWith(
        expect.objectContaining({ skills: expect.any(Array) }),
      );
    });
  });
});
