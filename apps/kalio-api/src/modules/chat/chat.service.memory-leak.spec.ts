import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Test, type TestingModule } from '@nestjs/testing';
import { ChatService } from './chat.service';
import { LLMService } from '../llm/llm.service';
import { PersonaService } from '../persona/persona.service';
import { ToolRegistryService } from '../tool/tool-registry.service';
import { ToolDispatchService } from '../tool/tool-dispatch.service';
import { DrizzleService } from '../../database/drizzle.service';
import { CredentialsService } from '../credentials/credentials.service';
import { Logger } from '@nestjs/common';

// Regression test for: Memory Leak in waitForConfirmation
// Issue: setTimeout is never cleared when confirmation arrives, causing timer accumulation
// This is a simplified integration test that verifies the behavior without complex mocking

describe('ChatService - Memory Leak Integration (REGRESSION)', () => {
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
              insert: vi.fn(),
              select: vi.fn(),
              update: vi.fn(),
              delete: vi.fn(),
            },
          },
        },
        {
          provide: CredentialsService,
          useValue: {
            getContextWindowSize: vi.fn().mockResolvedValue(32000),
            getActiveProviderConfig: vi.fn().mockResolvedValue(null),
          },
        },
      ],
    }).compile();

    service = moduleRef.get<ChatService>(ChatService);
    logger = service['logger'];
  });

  describe('waitForConfirmation - Memory Leak (REGRESSION TEST)', () => {
    it('should resolve confirmation when called before timeout', async () => {
      // Arrange
      const requestId = 'test-request-1';

      // Act - Start waiting for confirmation
      const promise = (service as any).waitForConfirmation(requestId, 10000);
      
      // Immediately resolve confirmation (before timeout)
      await service.resolveConfirmation(requestId, 'confirmed');
      const result = await promise;

      // Assert
      // Should resolve with 'confirmed' when confirmation arrives
      expect(result).toBe('confirmed');
      
      // Verify the pending confirmation was cleaned up
      const pendingConfirmations = (service as any).pendingConfirmations;
      expect(pendingConfirmations.has(requestId)).toBe(false);
    });

    it('should handle rapid confirmations without accumulating state', async () => {
      // Arrange
      const requestCount = 50;

      // Act - Create multiple pending confirmations and resolve them immediately
      const promises: Promise<void>[] = [];
      for (let i = 0; i < requestCount; i++) {
        const requestId = `req-${i}`;
        const promise = (service as any).waitForConfirmation(requestId, 10000);
        promises.push(promise);
        // Immediately resolve
        await service.resolveConfirmation(requestId, 'confirmed');
      }

      await Promise.all(promises);

      // Assert
      // All pending confirmations should be cleaned up
      const pendingConfirmations = (service as any).pendingConfirmations;
      expect(pendingConfirmations.size).toBe(0);
    });

    it('should handle timeout correctly when confirmation never arrives', async () => {
      // Arrange
      const requestId = 'timeout-test-req';
      const shortTimeout = 100; // 100ms

      // Act
      const promise = (service as any).waitForConfirmation(requestId, shortTimeout);
      const result = await promise;

      // Assert
      // Should resolve with 'cancelled' after timeout
      expect(result).toBe('cancelled');
      
      // Verify the pending confirmation was cleaned up
      const pendingConfirmations = (service as any).pendingConfirmations;
      expect(pendingConfirmations.has(requestId)).toBe(false);
    });

    it('should handle race condition between timeout and confirmation', async () => {
      // Arrange
      const requestId = 'race-test-req';
      const shortTimeout = 50; // 50ms

      // Act - Start waiting
      const promise = (service as any).waitForConfirmation(requestId, shortTimeout);
      
      // Try to confirm at the exact timeout boundary
      setTimeout(() => {
        service.resolveConfirmation(requestId, 'confirmed');
      }, shortTimeout - 10);

      const result = await promise;

      // Assert
      // Should handle the race gracefully without throwing
      expect(result).toBeDefined();
      expect(['confirmed', 'cancelled']).toContain(result);
      
      // Verify cleanup
      const pendingConfirmations = (service as any).pendingConfirmations;
      expect(pendingConfirmations.has(requestId)).toBe(false);
    });

    it('should not accumulate state with many concurrent confirmations', async () => {
      // Arrange
      const concurrentCount = 100;

      // Act - Create many concurrent confirmations
      const promises: Promise<void>[] = [];
      const requestIds: string[] = [];
      
      for (let i = 0; i < concurrentCount; i++) {
        const requestId = `concurrent-${i}`;
        requestIds.push(requestId);
        const promise = (service as any).waitForConfirmation(requestId, 5000);
        promises.push(promise);
      }

      // Resolve all confirmations
      for (const requestId of requestIds) {
        await service.resolveConfirmation(requestId, 'confirmed');
      }

      await Promise.all(promises);

      // Assert
      // All pending confirmations should be cleaned up (no memory leak)
      const pendingConfirmations = (service as any).pendingConfirmations;
      expect(pendingConfirmations.size).toBe(0);
    });

    it('should log warning when resolving non-existent requestId', async () => {
      // Arrange
      const nonExistentRequestId = 'non-existent-request-id';
      const spyWarn = vi.spyOn(logger, 'warn');

      // Act
      await service.resolveConfirmation(nonExistentRequestId, 'confirmed');

      // Assert
      // BUG: Current implementation silently does nothing
      // Expected: Should log a warning about the missing requestId
      // This test will fail until the bug is fixed
      expect(spyWarn).toHaveBeenCalledWith(
        expect.stringContaining('requestId'),
        expect.stringContaining(nonExistentRequestId),
      );
    });
  });
});
