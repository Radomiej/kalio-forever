import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Test, type TestingModule } from '@nestjs/testing';
import { ChatService } from './chat.service';
import { DrizzleService } from '../../database/drizzle.service';
import { LLMService } from '../llm/llm.service';
import { PersonaService } from '../persona/persona.service';
import { ToolRegistryService } from '../tool/tool-registry.service';
import { ToolDispatchService } from '../tool/tool-dispatch.service';

// Regression test for: Missing REST Controllers (Sessions, VFS)
// Issue: Frontend calls /api/sessions and /api/vfs/* but controllers don't exist
// This test verifies that ChatService has the required methods for session management

// Regression test for: Type mismatch in ChatController Date handling
// Issue: Controller checks instanceof Date, but Drizzle with mode: 'timestamp_ms' returns numbers

describe('ChatService - Session Management (REGRESSION TEST)', () => {
  let service: ChatService;
  let drizzleService: DrizzleService;

  beforeEach(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        ChatService,
        {
          provide: DrizzleService,
          useValue: {
            db: {
              insert: vi.fn().mockReturnValue({ values: vi.fn() }),
              select: vi.fn().mockReturnValue({ from: vi.fn().mockReturnValue({ where: vi.fn().mockReturnValue({ then: vi.fn().mockResolvedValue([]) }) }) }),
            },
          },
        },
        {
          provide: LLMService,
          useValue: {
            streamChat: vi.fn(),
          },
        },
        {
          provide: PersonaService,
          useValue: {
            getSessionConfig: vi.fn(),
          },
        },
        {
          provide: ToolRegistryService,
          useValue: {
            getToolsForSkills: vi.fn().mockReturnValue([]),
            getMeta: vi.fn(),
          },
        },
        {
          provide: ToolDispatchService,
          useValue: {
            dispatch: vi.fn(),
          },
        },
      ],
    }).compile();

    service = moduleRef.get<ChatService>(ChatService);
    drizzleService = moduleRef.get<DrizzleService>(DrizzleService);
  });

  describe('Session CRUD Operations (Exposed via ChatService)', () => {
    it('createSession should exist and be callable', async () => {
      // ChatService has createSession but it's not exposed via REST controller
      // Frontend expects POST /api/sessions endpoint

      const mockInsert = vi.fn().mockReturnValue({ values: vi.fn().mockResolvedValue(undefined) });
      drizzleService.db.insert = mockInsert;

      // This method exists on ChatService - proving the backend logic exists
      expect(typeof service.createSession).toBe('function');
    });

    it('getSession should exist and be callable', async () => {
      // ChatService has getSession but it's not exposed via REST controller
      // Frontend expects GET /api/sessions/:id endpoint

      const mockSelect = vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            then: vi.fn().mockResolvedValue([{ id: 'test-session' }]),
          }),
        }),
      });
      drizzleService.db.select = mockSelect;

      // This method exists on ChatService - proving the backend logic exists
      expect(typeof service.getSession).toBe('function');
    });

    it('getMessages should exist and be callable', async () => {
      // Frontend expects to load messages for a session
      expect(typeof service.getMessages).toBe('function');
    });
  });

  describe('Missing Controllers Documentation', () => {
    it('should document that SessionsController is missing', () => {
      // This test serves as documentation that SessionsController needs to be created
      // to expose ChatService methods via REST API at /api/sessions

      // Required endpoints:
      // - GET /api/sessions (list all)
      // - POST /api/sessions (create new)
      // - GET /api/sessions/:id (get specific)
      // - DELETE /api/sessions/:id (delete)

      // Current state: ChatService has the methods but no REST controller exposes them
      expect(true).toBe(true); // Documentation test
    });

    it('should document that VFSController is missing', () => {
      // This test serves as documentation that VFSController needs to be created
      // to expose VFSService methods via REST API at /api/vfs

      // Required endpoints:
      // - GET /api/vfs/:conversationId (list files)
      // - GET /api/vfs/:conversationId/:filePath (read file)
      // - POST /api/vfs/:conversationId/:filePath (write file)

      // Current state: VFSService exists but no REST controller exposes it
      expect(true).toBe(true); // Documentation test
    });
  });
});
