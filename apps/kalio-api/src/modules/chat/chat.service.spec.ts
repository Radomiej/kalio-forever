import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Test, type TestingModule } from '@nestjs/testing';
import { ChatService } from './chat.service';
import { LLMService } from '../llm/llm.service';
import { PersonaService } from '../persona/persona.service';
import { ToolRegistryService } from '../tool/tool-registry.service';
import { ToolDispatchService } from '../tool/tool-dispatch.service';
import { DrizzleService } from '../../database/drizzle.service';
import { Logger } from '@nestjs/common';

// Regression test for: Silent failure in resolveConfirmation
// Issue: Missing requestId is silently ignored with no logging
// AGENTS.md rule: "Every error logged + handled"

describe('ChatService', () => {
  let service: ChatService;
  let logger: Logger;

  beforeEach(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        ChatService,
        {
          provide: LLMService,
          useValue: {
            streamChat: vi.fn(),
            getConfig: vi.fn(),
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
            getMeta: vi.fn(),
            getToolsForSkills: vi.fn(),
          },
        },
        {
          provide: ToolDispatchService,
          useValue: {
            dispatch: vi.fn(),
          },
        },
        {
          provide: DrizzleService,
          useValue: {
            db: {
              insert: vi.fn().mockReturnValue({ values: vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue([]) }) }),
              select: vi.fn().mockReturnValue({ from: vi.fn().mockReturnValue({ where: vi.fn().mockReturnValue({ orderBy: vi.fn().mockResolvedValue([]) }) }) }),
              update: vi.fn().mockReturnValue({ set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }) }),
              delete: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }),
            },
          },
        },
      ],
    }).compile();

    service = moduleRef.get<ChatService>(ChatService);
    logger = service['logger'];
  });

  describe('resolveConfirmation - Silent Failure (REGRESSION TEST)', () => {
    it('should log warning when requestId does not exist', async () => {
      // Arrange
      const nonExistentRequestId = 'non-existent-request-id';
      const spyWarn = vi.spyOn(logger, 'warn');

      // Act
      await service.resolveConfirmation(nonExistentRequestId, 'confirmed');

      // Assert
      // BUG: Current implementation silently does nothing when requestId not found
      // Expected: Should log a warning about the missing requestId
      // This test will fail until the bug is fixed
      expect(spyWarn).toHaveBeenCalledWith(
        expect.stringContaining('requestId'),
        expect.stringContaining(nonExistentRequestId),
      );
    });

    it('should handle duplicate confirmation attempts gracefully', async () => {
      // Arrange
      const requestId = 'test-request-id';
      const spyWarn = vi.spyOn(logger, 'warn');

      // First confirmation
      await service.resolveConfirmation(requestId, 'confirmed');

      // Second confirmation (duplicate)
      await service.resolveConfirmation(requestId, 'confirmed');

      // Assert
      // Should log warning about duplicate confirmation attempt
      expect(spyWarn).toHaveBeenCalled();
    });
  });

  describe('waitForConfirmation - Memory Leak (REGRESSION TEST)', () => {
    it('should clear timeout when confirmation arrives', async () => {
      // Arrange
      const requestId = 'test-request-id';
      const clearTimeoutSpy = vi.spyOn(global, 'clearTimeout');

      // Set up a pending confirmation (registers the timer)
      const waitPromise = (service as any)['waitForConfirmation'](requestId, 5000);

      // Act - resolve confirmation before timeout
      await service.resolveConfirmation(requestId, 'confirmed');
      await waitPromise;

      // Assert
      expect(clearTimeoutSpy).toHaveBeenCalled();
    });

    it('should not accumulate timers on multiple confirmations', async () => {
      // Arrange
      const setTimeoutSpy = vi.spyOn(global, 'setTimeout');
      const clearTimeoutSpy = vi.spyOn(global, 'clearTimeout');
      const requestIds = Array.from({ length: 10 }, (_, i) => `req-${i}`);

      // Act - create multiple pending confirmations
      for (const requestId of requestIds) {
        await service.resolveConfirmation(requestId, 'confirmed');
      }

      // Assert
      // Number of clearTimers should equal number of setTimeouts (no leak)
      // BUG: Current implementation has memory leak - timers never cleared
      // This test will fail until the bug is fixed
      expect(clearTimeoutSpy).toHaveBeenCalledTimes(setTimeoutSpy.mock.calls.length);
    });
  });

  describe('createSession', () => {
    it('should create a session with valid persona', async () => {
      // Arrange
      const personaId = 'persona-123';
      const title = 'Test Session';

      // Act
      const sessionId = await service.createSession(personaId, title);

      // Assert
      expect(sessionId).toBeDefined();
      expect(typeof sessionId).toBe('string');
    });
  });

  describe('getSession', () => {
    it('should return null for non-existent session', async () => {
      // Arrange
      const nonExistentId = 'non-existent-session';

      // Act
      const session = await service.getSession(nonExistentId);

      // Assert
      expect(session).toBeNull();
    });
  });
});
