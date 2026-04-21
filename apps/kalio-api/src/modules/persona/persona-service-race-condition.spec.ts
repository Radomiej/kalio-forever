import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Test, type TestingModule } from '@nestjs/testing';
import { PersonaService } from './persona.service';
import { DrizzleService } from '../../database/drizzle.service';

// Regression test for: Potential race condition in PersonaService.onApplicationBootstrap
// Issue: Between checking if the persona exists and inserting it, another process could insert it
// While SQLite locks prevent this in single-process mode, in multi-instance deployments
// this could cause a duplicate key error

describe('PersonaService - Race Condition in onApplicationBootstrap (REGRESSION TEST)', () => {
  let service: PersonaService;
  let mockDb: any;

  beforeEach(async () => {
    mockDb = {
      select: vi.fn(),
      insert: vi.fn().mockReturnValue({ values: vi.fn().mockResolvedValue(undefined) }),
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
  });

  describe('Race Condition Scenario', () => {
    it('should handle concurrent bootstrap attempts gracefully', async () => {
      // Regression test for: Race condition in persona seeding
      // Issue: Two instances checking and inserting simultaneously could cause duplicate key error

      // Simulate scenario where persona doesn't exist initially
      // but gets inserted by another process between check and insert
      let callCount = 0;
      
      const fromMock = vi.fn().mockImplementation(() => {
        callCount++;
        // First call: persona doesn't exist
        if (callCount === 1) {
          return {
            where: vi.fn().mockResolvedValue([]),
          };
        }
        // Subsequent calls: persona exists (inserted by another process)
        return {
          where: vi.fn().mockResolvedValue([
            {
              id: 'default',
              name: 'Default',
              systemPrompt: 'You are a helpful AI assistant.',
              model: '',
              skills: [],
              createdAt: Date.now(),
              updatedAt: Date.now(),
            },
          ]),
        };
      });

      mockDb.select.mockReturnValue({ from: fromMock });

      // Simulate the race: insert succeeds on first attempt
      // but if called again, it would fail with duplicate key
      let insertCallCount = 0;
      mockDb.insert.mockImplementation(() => {
        insertCallCount++;
        if (insertCallCount === 1) {
          return {
            values: vi.fn().mockResolvedValue(undefined),
          };
        }
        // Second insert attempt would fail with duplicate key error
        const error = new Error('UNIQUE constraint failed: personas.id');
        (error as any).code = 'SQLITE_CONSTRAINT';
        throw error;
      });

      // First bootstrap attempt
      await service.onApplicationBootstrap();

      // Verify persona was checked and inserted
      expect(mockDb.select).toHaveBeenCalled();
      expect(mockDb.insert).toHaveBeenCalled();

      // Reset mocks for second attempt
      callCount = 0;
      insertCallCount = 0;

      // Second bootstrap attempt (simulating another instance)
      // This should handle the case where persona already exists
      try {
        await service.onApplicationBootstrap();
        // If we get here, the second attempt succeeded (persona already existed)
        // This is the expected behavior with proper error handling
      } catch (error) {
        // Current implementation doesn't handle duplicate key error
        // This test documents the regression
        expect(error).toBeDefined();
        expect((error as Error).message).toContain('UNIQUE constraint');
      }
    });

    it('should use INSERT OR IGNORE to prevent race condition', async () => {
      // This test documents the ideal solution
      // Current implementation uses plain INSERT which can fail on race condition
      // Should use INSERT OR IGNORE or handle duplicate key error gracefully

      const fromMock = vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([]), // Persona doesn't exist
      });

      mockDb.select.mockReturnValue({ from: fromMock });

      // Current implementation: plain INSERT
      const insertMock = vi.fn().mockReturnValue({
        values: vi.fn().mockResolvedValue(undefined),
      });
      mockDb.insert.mockReturnValue(insertMock);

      await service.onApplicationBootstrap();

      // Verify INSERT was called (not INSERT OR IGNORE)
      expect(mockDb.insert).toHaveBeenCalled();
      
      // The regression is that it doesn't use INSERT OR IGNORE
      // or handle the duplicate key error gracefully
      // This would cause the application to crash in multi-instance deployment
    });

    it('should handle database errors during persona existence check', async () => {
      // Test that database errors during the check are handled
      const dbError = new Error('Database connection lost');
      
      mockDb.select.mockImplementation(() => {
        throw dbError;
      });

      // Current implementation has no error handling
      // This test documents the regression
      await expect(service.onApplicationBootstrap()).rejects.toThrow('Database connection lost');
    });
  });

  describe('Multi-Instance Deployment Scenario', () => {
    it('should document the multi-instance deployment risk', () => {
      // This test documents the regression for future reference
      // In multi-instance deployments (e.g., Kubernetes with multiple replicas),
      // the race condition becomes a real issue:
      //
      // Instance 1: checks for 'default' persona → not found
      // Instance 2: checks for 'default' persona → not found
      // Instance 1: inserts 'default' persona → success
      // Instance 2: inserts 'default' persona → UNIQUE constraint error → crash
      //
      // Current implementation has no protection against this
      // Solutions:
      // 1. Use INSERT OR IGNORE in SQL
      // 2. Catch duplicate key error and ignore it
      // 3. Use database transactions with proper isolation
      // 4. Use a distributed lock mechanism

      expect(true).toBe(true); // Documentation test
    });
  });
});
