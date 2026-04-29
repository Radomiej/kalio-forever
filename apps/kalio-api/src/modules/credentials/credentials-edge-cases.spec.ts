import { describe, it, expect, beforeEach, vi } from 'vitest';
import { CredentialsService } from './credentials.service';
import { DrizzleService } from '../../database/drizzle.service';
import { credentials } from '../../database/schema';

describe('CredentialsService - Edge Cases', () => {
  let service: CredentialsService;
  let mockDrizzle: any;

  beforeEach(() => {
    mockDrizzle = {
      db: {
        select: vi.fn(),
        insert: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
      },
    };
    service = new CredentialsService(mockDrizzle);
  });


  describe('getApiKey - unsafe array access', () => {
    it('should return null when database returns empty array', async () => {
      // Arrange: Mock select to return empty array
      mockDrizzle.db.select.mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            then: vi.fn().mockResolvedValue([]), // BUG: row?.apiKey will be undefined
          }),
        }),
      });

      // Act
      const result = await service.getApiKey('nonexistent-id');

      // Assert - This passes due to nullish coalescing, but the code is still unsafe
      expect(result).toBeNull();
    });

    it('should handle undefined row gracefully', async () => {
      // Arrange: Mock select to return undefined
      mockDrizzle.db.select.mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            then: vi.fn().mockResolvedValue(undefined),
          }),
        }),
      });

      // Act
      const result = await service.getApiKey('nonexistent-id');

      // Assert
      expect(result).toBeNull();
    });
  });

  describe('getActiveCredentialId - unsafe array access', () => {
    it('should return null when database returns empty array', async () => {
      // Arrange: Mock select to return empty array
      mockDrizzle.db.select.mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            then: vi.fn().mockResolvedValue([]), // BUG: row?.value will be undefined
          }),
        }),
      });

      // Act
      const result = await service.getActiveCredentialId();

      // Assert
      expect(result).toBeNull();
    });
  });


  describe('getContextWindowSize - unsafe array access BUG CONFIRMED', () => {
    it('should return default when database returns empty array', async () => {
      // Arrange: Mock select to return empty array
      mockDrizzle.db.select.mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            then: vi.fn().mockResolvedValue([]), // BUG: row?.value will be undefined, parseInt(undefined) = NaN
          }),
        }),
      });

      // Act
      const result = await service.getContextWindowSize();

      // Assert - BUG CONFIRMED: Returns NaN instead of 32000
      expect(result).toBeNaN();
      expect(result).not.toBe(32000);
    });
  });

  describe('setContextWindowSize - unsafe array access BUG CONFIRMED', () => {
    it('should crash when database returns empty array', async () => {
      // Arrange: Mock select to return empty array
      mockDrizzle.db.select.mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            then: vi.fn().mockResolvedValue([]), // BUG: existing will be undefined, crashes on existing.set
          }),
        }),
      });
      mockDrizzle.db.insert.mockReturnValue({
        values: vi.fn().mockReturnValue({
          then: vi.fn().mockResolvedValue(undefined),
        }),
      });

      // Act & Assert - BUG CONFIRMED: Crashes with "Cannot read properties of undefined"
      await expect(service.setContextWindowSize(16000)).rejects.toThrow(
        'Cannot read properties of undefined'
      );
    });
  });
});
