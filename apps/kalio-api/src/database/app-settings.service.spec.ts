import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema';
import { DrizzleService } from './drizzle.service';
import { AppSettingsService } from './app-settings.service';

function makeTestDrizzle(): DrizzleService {
  const sqlite = new Database(':memory:');
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY NOT NULL,
      value TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `);
  const db = drizzle(sqlite, { schema });
  const svc = new DrizzleService(null as never);
  (svc as unknown as { db: unknown }).db = db;
  return svc;
}

describe('AppSettingsService', () => {
  let service: AppSettingsService;

  beforeEach(() => {
    service = new AppSettingsService(makeTestDrizzle());
  });

  describe('get()', () => {
    it('returns null for missing key', async () => {
      expect(await service.get('missing')).toBeNull();
    });

    it('returns value after set', async () => {
      await service.set('mykey', 'myvalue');
      expect(await service.get('mykey')).toBe('myvalue');
    });
  });

  describe('set()', () => {
    it('inserts new key-value pair', async () => {
      await service.set('foo', 'bar');
      expect(await service.get('foo')).toBe('bar');
    });

    it('overwrites existing value on upsert', async () => {
      await service.set('key', 'old');
      await service.set('key', 'new');
      expect(await service.get('key')).toBe('new');
    });
  });

  describe('delete()', () => {
    it('removes the key', async () => {
      await service.set('del-key', 'val');
      await service.delete('del-key');
      expect(await service.get('del-key')).toBeNull();
    });

    it('no-ops when key does not exist', async () => {
      await expect(service.delete('nonexistent')).resolves.not.toThrow();
    });
  });

  describe('getAll()', () => {
    it('returns empty object when no keys match prefix', async () => {
      await service.set('other.key', 'val');
      const result = await service.getAll('search.');
      expect(result).toEqual({});
    });

    it('returns all keys matching prefix', async () => {
      await service.set('search.provider', 'perplexity');
      await service.set('search.api_key', 'key-123');
      await service.set('llm.model', 'gpt-4');
      const result = await service.getAll('search.');
      expect(Object.keys(result)).toHaveLength(2);
      expect(result['search.provider']).toBe('perplexity');
      expect(result['search.api_key']).toBe('key-123');
      expect('llm.model' in result).toBe(false);
    });

    it('returns all keys when prefix is empty string', async () => {
      await service.set('a', '1');
      await service.set('b', '2');
      const result = await service.getAll('');
      expect(Object.keys(result).length).toBeGreaterThanOrEqual(2);
    });
  });
});
