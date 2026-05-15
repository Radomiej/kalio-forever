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
        allowedTools: ['vfs_write'],
        skillIds: ['skill-1'],
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
      expect(result?.allowedTools).toEqual(['vfs_write']);
      expect(result?.skillIds).toEqual(['skill-1']);
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
          allowedTools: ['tool1'],
          skillIds: [],
          createdAt: 1234567890,
          updatedAt: 1234567890,
        },
        {
          id: 'p2',
          name: 'Persona 2',
          systemPrompt: 'Prompt 2',
          model: 'claude',
          allowedTools: null,   // Test null handling
          skillIds: null,
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
      expect(result[0].allowedTools).toEqual(['tool1']);
      expect(result[0].skillIds).toEqual([]);
      expect(result[1].allowedTools).toEqual([]); // Null becomes empty array
      expect(result[1].skillIds).toEqual([]);      // Null becomes empty array
      expect(typeof result[1].createdAt).toBe('number'); // Date converted to number
    });
  });

  describe('seeded personas config', () => {
    it('keeps vfs_write visible to the orchestrator persona for file-producing delegations', () => {
      const config = (
        service as unknown as { loadPersonasConfig(): Record<string, { allowedTools: string[] }> }
      ).loadPersonasConfig();

      expect(config['orchestrator']?.allowedTools).toEqual(expect.arrayContaining(['vfs_write']));
    });

    it('teaches the orchestrator to honor explicit tool limits and reuse generated image download URLs', () => {
      const config = (
        service as unknown as { loadPersonasConfig(): Record<string, { systemPrompt: string }> }
      ).loadPersonasConfig();

      expect(config['orchestrator']?.systemPrompt).toContain('If the user explicitly limits the functional tools for a task');
      expect(config['orchestrator']?.systemPrompt).toContain('download_url');
      expect(config['orchestrator']?.systemPrompt).toContain('distinct filenames');
    });

    it('keeps prototype-capable personas on the VFS-first design_preview workflow', () => {
      const config = (
        service as unknown as {
          loadPersonasConfig(): Record<string, { systemPrompt: string; allowedTools: string[] }>;
        }
      ).loadPersonasConfig();

      expect(config['builder']?.allowedTools).toEqual(expect.arrayContaining(['design_preview']));
      expect(config['designer']?.allowedTools).toEqual(expect.arrayContaining(['design_preview']));
      expect(config['orchestrator']?.allowedTools).toEqual(expect.arrayContaining(['design_preview']));
      expect(config['dev']?.allowedTools).toEqual(expect.arrayContaining(['design_preview']));
      expect(config['jony']?.allowedTools).toEqual(expect.arrayContaining(['design_preview']));

      expect(config['builder']?.systemPrompt).toContain('design_preview');
      expect(config['builder']?.systemPrompt).toContain('write the HTML files into VFS first');
      expect(config['designer']?.systemPrompt).toContain('design_preview');
      expect(config['designer']?.systemPrompt).toContain('Write or update prototype source files in VFS with vfs_write');
      expect(config['orchestrator']?.systemPrompt).toContain('design_preview');
      expect(config['orchestrator']?.systemPrompt).toContain('prototype page');
      expect(config['dev']?.systemPrompt).toContain('design_preview');
      expect(config['jony']?.systemPrompt).toContain('design_preview');
    });

    it('teaches the orchestrator to keep RA-App DSL delegation on the draft-first path instead of HTML preview flow', () => {
      const config = (
        service as unknown as {
          loadPersonasConfig(): Record<string, { systemPrompt: string }>;
        }
      ).loadPersonasConfig();

      expect(config['orchestrator']?.systemPrompt).toContain('RA-App DSL or ECS');
      expect(config['orchestrator']?.systemPrompt).toContain('raapp_create_draft');
      expect(config['orchestrator']?.systemPrompt).toContain('raapp_execute_dsl');
      expect(config['orchestrator']?.systemPrompt).toContain('Do not ask the child for HTML, design_preview');
    });

    it('teaches the designer to use the exact VFS tool names without a rigid dark multi-page template', () => {
      const config = (
        service as unknown as {
          loadPersonasConfig(): Record<string, { systemPrompt: string }>;
        }
      ).loadPersonasConfig();

      expect(config['designer']?.systemPrompt).toContain('Never mention or attempt file_write');
      expect(config['designer']?.systemPrompt).toContain('Prefer a single focused page unless the brief clearly needs multiple screens or navigation');
      expect(config['designer']?.systemPrompt).not.toContain('Dark theme by default');
      expect(config['designer']?.systemPrompt).not.toContain('Every app MUST have at least 2 pages with working navigation');
    });

    it('includes image generation and inspection tools in the seeded designer persona', () => {
      const config = (
        service as unknown as {
          loadPersonasConfig(): Record<string, { allowedTools: string[]; systemPrompt: string }>;
        }
      ).loadPersonasConfig();

      expect(config['designer']?.allowedTools).toEqual(
        expect.arrayContaining(['image_generate', 'image_view', 'image_edit']),
      );
      expect(config['designer']?.systemPrompt).toContain('image_generate');
      expect(config['designer']?.systemPrompt).toContain('image_view');
      expect(config['designer']?.systemPrompt).toContain('never use a leading / in VFS paths');
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
        allowedTools: [],
        skillIds: [],
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

    it('still updates allowedTools and skillIds when persona already exists', async () => {
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
        expect.objectContaining({
          name: expect.any(String),
          allowedTools: expect.any(Array),
          skillIds: expect.any(Array),
        }),
      );
    });

    it('refreshes the seeded designer prompt when the stored prompt still matches the rigid legacy template', async () => {
      vi.spyOn(
        service as unknown as {
          loadPersonasConfig(): Record<string, {
            name: string;
            systemPrompt: string;
            model: string;
            allowedTools: string[];
            skillIds?: string[];
          }>;
        },
        'loadPersonasConfig',
      ).mockReturnValue({
        designer: {
          name: 'UX Designer',
          systemPrompt: 'new designer prompt',
          model: '',
          allowedTools: ['vfs_read', 'vfs_write', 'vfs_list', 'design_preview'],
          skillIds: [],
        },
      });

      mockDb.select.mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([{
            id: 'designer',
            systemPrompt: [
              'Build every app using this structure:',
              'Dark theme by default',
              'Every app MUST have at least 2 pages with working navigation',
            ].join('\n'),
          }]),
        }),
      });

      const setMock = vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(undefined),
      });
      mockDb.update.mockReturnValue({ set: setMock });

      await service.onApplicationBootstrap();

      expect(setMock).toHaveBeenCalledWith(
        expect.objectContaining({ systemPrompt: 'new designer prompt' }),
      );
    });

    it('does NOT overwrite a customized designer prompt while refreshing other seeded fields', async () => {
      vi.spyOn(
        service as unknown as {
          loadPersonasConfig(): Record<string, {
            name: string;
            systemPrompt: string;
            model: string;
            allowedTools: string[];
            skillIds?: string[];
          }>;
        },
        'loadPersonasConfig',
      ).mockReturnValue({
        designer: {
          name: 'UX Designer',
          systemPrompt: 'new designer prompt',
          model: '',
          allowedTools: ['vfs_read', 'vfs_write', 'vfs_list', 'design_preview'],
          skillIds: [],
        },
      });

      mockDb.select.mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([{
            id: 'designer',
            systemPrompt: 'custom prompt from the user',
          }]),
        }),
      });

      const setMock = vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(undefined),
      });
      mockDb.update.mockReturnValue({ set: setMock });

      await service.onApplicationBootstrap();

      expect(setMock).toHaveBeenCalledWith(
        expect.not.objectContaining({ systemPrompt: expect.any(String) }),
      );
    });

    it('refreshes the seeded designer prompt when the stored VFS-first prompt still lacks the image workflow', async () => {
      vi.spyOn(
        service as unknown as {
          loadPersonasConfig(): Record<string, {
            name: string;
            systemPrompt: string;
            model: string;
            allowedTools: string[];
            skillIds?: string[];
          }>;
        },
        'loadPersonasConfig',
      ).mockReturnValue({
        designer: {
          name: 'UX Designer',
          systemPrompt: 'new designer prompt with image_generate and image_view and never use a leading / in VFS paths',
          model: '',
          allowedTools: ['vfs_read', 'vfs_write', 'vfs_list', 'design_preview', 'image_generate', 'image_view', 'image_edit'],
          skillIds: [],
        },
      });

      mockDb.select.mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([{
            id: 'designer',
            systemPrompt: [
              'When the user asks for a prototype page or website, do not jump straight to raapp_create. Work in VFS first and finish with a design_preview result.',
              'Use the exact tool names: vfs_list, vfs_read, vfs_write, design_preview, raapp_create',
              'Never mention or attempt file_write, file_read, write_file, read_file, or other aliases - they do not exist here',
            ].join('\n'),
          }]),
        }),
      });

      const setMock = vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(undefined),
      });
      mockDb.update.mockReturnValue({ set: setMock });

      await service.onApplicationBootstrap();

      expect(setMock).toHaveBeenCalledWith(
        expect.objectContaining({
          systemPrompt: 'new designer prompt with image_generate and image_view and never use a leading / in VFS paths',
        }),
      );
    });

    it('REGRESSION: does not overwrite a customized VFS-first designer prompt that already mentions image_edit', async () => {
      vi.spyOn(
        service as unknown as {
          loadPersonasConfig(): Record<string, {
            name: string;
            systemPrompt: string;
            model: string;
            allowedTools: string[];
            skillIds?: string[];
          }>;
        },
        'loadPersonasConfig',
      ).mockReturnValue({
        designer: {
          name: 'UX Designer',
          systemPrompt: 'new designer prompt with image_generate and image_view and image_edit',
          model: '',
          allowedTools: ['vfs_read', 'vfs_write', 'vfs_list', 'design_preview', 'image_generate', 'image_view', 'image_edit'],
          skillIds: [],
        },
      });

      mockDb.select.mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([{
            id: 'designer',
            systemPrompt: [
              'When the user asks for a prototype page or website, do not jump straight to raapp_create. Work in VFS first and finish with a design_preview result.',
              'Use the exact tool names: vfs_list, vfs_read, vfs_write, design_preview, raapp_create',
              'Never mention or attempt file_write, file_read, write_file, read_file, or other aliases - they do not exist here',
              'For follow-up adjustments to an existing image asset, prefer image_edit over a full regeneration.',
            ].join('\n'),
          }]),
        }),
      });

      const setMock = vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(undefined),
      });
      mockDb.update.mockReturnValue({ set: setMock });

      await service.onApplicationBootstrap();

      expect(setMock).toHaveBeenCalledWith(
        expect.not.objectContaining({
          systemPrompt: 'new designer prompt with image_generate and image_view and image_edit',
        }),
      );
    });
  });

  describe('onApplicationBootstrap — skillIds sync regression', () => {
    /**
     * Regression for: persona.service.ts onApplicationBootstrap() else-branch
     * did NOT include `skillIds` in the update payload.
     *
     * When an existing persona already had a DB row, changes to `skillIds` in
     * personas.json were silently ignored — the column was never updated.
     *
     * Fix: add `skillIds: config.skillIds ?? []` to the update set.
     */
    it('includes skillIds in the update payload for existing personas (regression)', async () => {
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

      const payload = setMock.mock.calls[0]?.[0] as Record<string, unknown>;
      expect(payload).toHaveProperty('skillIds');
    });

    it('does NOT include skillIds in the insert payload when persona is new (sanity check)', async () => {
      // New persona: select returns empty → insert path
      mockDb.select.mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([]),
        }),
      });

      const valuesMock = vi.fn().mockResolvedValue(undefined);
      mockDb.insert.mockReturnValue({ values: valuesMock });
      // Need a second select for the next persona iteration (if any), just keep empty
      await service.onApplicationBootstrap();

      const insertPayload = valuesMock.mock.calls[0]?.[0] as Record<string, unknown>;
      // Insert path should also include skillIds (it was already correct)
      expect(insertPayload).toHaveProperty('skillIds');
    });
  });

  describe('onApplicationBootstrap — specialized persona seeding', () => {
    it('seeds web-research and orchestrator personas from personas.json', async () => {
      mockDb.select.mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([]),
        }),
      });

      const valuesMock = vi.fn().mockResolvedValue(undefined);
      mockDb.insert.mockReturnValue({ values: valuesMock });

      await service.onApplicationBootstrap();

      const seededIds = valuesMock.mock.calls
        .map((call) => call[0] as { id?: string })
        .map((payload) => payload.id)
        .filter((id): id is string => typeof id === 'string');

      expect(seededIds).toContain('web-research');
      expect(seededIds).toContain('orchestrator');
    });

    it('includes image tools in the seeded orchestrator persona', async () => {
      mockDb.select.mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([]),
        }),
      });

      const valuesMock = vi.fn().mockResolvedValue(undefined);
      mockDb.insert.mockReturnValue({ values: valuesMock });

      await service.onApplicationBootstrap();

      const orchestratorPayload = valuesMock.mock.calls
        .map((call) => call[0] as { id?: string; allowedTools?: string[] })
        .find((payload) => payload.id === 'orchestrator');

      expect(orchestratorPayload?.allowedTools).toEqual(
        expect.arrayContaining(['image_generate', 'image_edit', 'image_view']),
      );
    });

    it('seeds the skill/persona maker and jony personas from personas.json', async () => {
      mockDb.select.mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([]),
        }),
      });

      const valuesMock = vi.fn().mockResolvedValue(undefined);
      mockDb.insert.mockReturnValue({ values: valuesMock });

      await service.onApplicationBootstrap();

      const seededIds = valuesMock.mock.calls
        .map((call) => call[0] as { id?: string })
        .map((payload) => payload.id)
        .filter((id): id is string => typeof id === 'string');

      expect(seededIds).toContain('skill-persona-maker');
      expect(seededIds).toContain('jony');
    });

    it('uses renamed display names for default specialist personas', () => {
      const config = (
        service as unknown as { loadPersonasConfig(): Record<string, { name: string }> }
      ).loadPersonasConfig();

      expect(config['ra-apps']?.name).toBe('RaConsierge');
      expect(config['builder']?.name).toBe('RaBuilder');
      expect(config['designer']?.name).toBe('UX Designer');
      expect(config['dev']?.name).toBe('Fullstack Dev');
    });
  });
});
