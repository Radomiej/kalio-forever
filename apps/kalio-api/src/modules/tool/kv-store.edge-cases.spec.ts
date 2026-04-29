import { describe, it, expect, beforeEach, vi } from 'vitest';
import { KVStoreService } from './kv-store.service';
import { ConfigService } from '@nestjs/config';
import { writeFileSync, readFileSync, mkdirSync, existsSync } from 'node:fs';

describe('KVStoreService - Edge Cases', () => {
  let service: KVStoreService;
  let mockConfig: any;
  let testDir: string;

  beforeEach(() => {
    testDir = `C:\\Temp\\kv-test-${Date.now()}`;
    mockConfig = {
      get: vi.fn().mockReturnValue(testDir),
    };
    service = new KVStoreService(mockConfig);
  });

  describe('load - silent JSON parse failure BUG CONFIRMED', () => {
    it('should return empty object when JSON file is corrupted', () => {
      // Arrange: Write corrupted JSON file
      mkdirSync(testDir, { recursive: true });
      const kvPath = `${testDir}\\sessions\\test-session\\_kv.json`;
      mkdirSync(`${testDir}\\sessions\\test-session`, { recursive: true });
      writeFileSync(kvPath, '{ invalid json }', 'utf8');

      // Act
      const result = service.get('test-session', 'any-key');

      // Assert - BUG CONFIRMED: Silent failure, returns undefined instead of throwing
      expect(result).toBeUndefined();
    });

    it('should return empty object when JSON file contains syntax error', () => {
      // Arrange: Write malformed JSON
      mkdirSync(testDir, { recursive: true });
      const kvPath = `${testDir}\\sessions\\test-session\\_kv.json`;
      mkdirSync(`${testDir}\\sessions\\test-session`, { recursive: true });
      writeFileSync(kvPath, '{"key": "value"', 'utf8'); // Missing closing brace

      // Act
      const result = service.get('test-session', 'any-key');

      // Assert - BUG CONFIRMED: Silent failure
      expect(result).toBeUndefined();
    });

    it('should handle non-JSON content gracefully', () => {
      // Arrange: Write plain text instead of JSON
      mkdirSync(testDir, { recursive: true });
      const kvPath = `${testDir}\\sessions\\test-session\\_kv.json`;
      mkdirSync(`${testDir}\\sessions\\test-session`, { recursive: true });
      writeFileSync(kvPath, 'just plain text', 'utf8');

      // Act
      const result = service.get('test-session', 'any-key');

      // Assert - BUG CONFIRMED: Silent failure
      expect(result).toBeUndefined();
    });

    it('should lose existing data when saving after corrupted load', () => {
      // Arrange: Write corrupted JSON
      mkdirSync(testDir, { recursive: true });
      const kvPath = `${testDir}\\sessions\\test-session\\_kv.json`;
      mkdirSync(`${testDir}\\sessions\\test-session`, { recursive: true });
      writeFileSync(kvPath, '{ corrupted }', 'utf8');

      // Act: Try to set a new value (this will load corrupted data, lose it, and save new data)
      service.set('test-session', 'new-key', 'new-value');

      // Assert - BUG CONFIRMED: Existing data is lost, only new data remains
      const result = service.list('test-session');
      expect(result).toEqual({ 'new-key': 'new-value' });
    });
  });

  describe('set - data loss on corrupted file', () => {
    it('should overwrite corrupted file with only new data', () => {
      // Arrange: Write corrupted JSON
      mkdirSync(testDir, { recursive: true });
      const kvPath = `${testDir}\\sessions\\test-session\\_kv.json`;
      mkdirSync(`${testDir}\\sessions\\test-session`, { recursive: true });
      writeFileSync(kvPath, '{ corrupted }', 'utf8');

      // Act: Set new value
      service.set('test-session', 'new-key', 'new-value');

      // Assert - Old data is lost because load() silently failed
      const result = service.list('test-session');
      expect(result).toEqual({ 'new-key': 'new-value' });
    });
  });

  describe('delete - no-op on corrupted file', () => {
    it('should return false when trying to delete from corrupted file', () => {
      // Arrange: Write corrupted JSON
      mkdirSync(testDir, { recursive: true });
      const kvPath = `${testDir}\\sessions\\test-session\\_kv.json`;
      mkdirSync(`${testDir}\\sessions\\test-session`, { recursive: true });
      writeFileSync(kvPath, '{ corrupted }', 'utf8');

      // Act: Try to delete a key
      const result = service.delete('test-session', 'key');

      // Assert - BUG CONFIRMED: Returns false because load() silently failed
      expect(result).toBe(false);
    });
  });
});
