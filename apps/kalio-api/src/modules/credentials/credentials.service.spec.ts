import { describe, it, expect, beforeEach } from 'vitest';
import { CredentialsService } from './credentials.service';
import { DrizzleService } from '../../database/drizzle.service';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import Database from 'better-sqlite3';
import * as schema from '../../database/schema';

/** Build an in-memory SQLite DB with the required tables for testing */
function makeTestDrizzle(): DrizzleService {
  const sqlite = new Database(':memory:');
  sqlite.pragma('foreign_keys = ON');
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS credentials (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      provider TEXT NOT NULL,
      api_key TEXT NOT NULL,
      base_url TEXT,
      model TEXT,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `);
  const db = drizzle(sqlite, { schema });

  const drizzleSvc = new DrizzleService(null as never);
  // Bypass onModuleInit — inject the in-memory db directly
  (drizzleSvc as unknown as { db: typeof db }).db = db;
  return drizzleSvc;
}

describe('CredentialsService', () => {
  let svc: CredentialsService;

  beforeEach(() => {
    const drizzleSvc = makeTestDrizzle();
    svc = new CredentialsService(drizzleSvc);
  });

  describe('CRUD', () => {
    it('creates and retrieves a credential without exposing apiKey', async () => {
      const created = await svc.create({
        name: 'Test OpenAI',
        provider: 'openai',
        apiKey: 'sk-secret',
        model: 'gpt-4o-mini',
      });

      expect(created.id).toBeTruthy();
      expect(created.name).toBe('Test OpenAI');
      expect(created.provider).toBe('openai');
      // apiKey must NOT be returned
      expect((created as unknown as Record<string, unknown>)['apiKey']).toBeUndefined();
    });

    it('returns all credentials without apiKey', async () => {
      await svc.create({ name: 'A', provider: 'openai', apiKey: 'key1' });
      await svc.create({ name: 'B', provider: 'cometapi', apiKey: 'key2' });
      const all = await svc.findAll();
      expect(all).toHaveLength(2);
      for (const c of all) {
        expect((c as unknown as Record<string, unknown>)['apiKey']).toBeUndefined();
      }
    });

    it('retrieves raw apiKey via getApiKey', async () => {
      const created = await svc.create({ name: 'A', provider: 'openai', apiKey: 'sk-abc' });
      const key = await svc.getApiKey(created.id);
      expect(key).toBe('sk-abc');
    });

    it('removes a credential', async () => {
      const c = await svc.create({ name: 'C', provider: 'openai', apiKey: 'key' });
      await svc.remove(c.id);
      const all = await svc.findAll();
      expect(all).toHaveLength(0);
    });
  });

  describe('active credential', () => {
    it('returns null when no active credential is set', async () => {
      expect(await svc.getActiveCredentialId()).toBeNull();
    });

    it('sets and retrieves active credential', async () => {
      const c = await svc.create({ name: 'A', provider: 'openai', apiKey: 'key', model: 'gpt-4o' });
      await svc.setActiveCredential(c.id);
      expect(await svc.getActiveCredentialId()).toBe(c.id);
    });

    it('throws NotFoundException when setting nonexistent credential as active', async () => {
      await expect(svc.setActiveCredential('nonexistent-id')).rejects.toThrow();
    });

    it('clears active credential', async () => {
      const c = await svc.create({ name: 'A', provider: 'openai', apiKey: 'key' });
      await svc.setActiveCredential(c.id);
      await svc.clearActiveCredential();
      expect(await svc.getActiveCredentialId()).toBeNull();
    });

    it('clears active when the active credential is deleted', async () => {
      const c = await svc.create({ name: 'A', provider: 'openai', apiKey: 'key' });
      await svc.setActiveCredential(c.id);
      await svc.remove(c.id);
      expect(await svc.getActiveCredentialId()).toBeNull();
    });

    it('getActiveProviderConfig returns null when no active credential', async () => {
      expect(await svc.getActiveProviderConfig()).toBeNull();
    });

    it('getActiveProviderConfig returns full config when active credential exists', async () => {
      const c = await svc.create({
        name: 'MiMo',
        provider: 'xiaomimimo',
        apiKey: 'sk-mimo',
        baseUrl: 'https://token-plan-ams.xiaomimimo.com/v1',
        model: 'mimo-v2-omni',
      });
      await svc.setActiveCredential(c.id);
      const config = await svc.getActiveProviderConfig();
      expect(config).not.toBeNull();
      expect(config?.provider).toBe('xiaomimimo');
      expect(config?.apiKey).toBe('sk-mimo');
      expect(config?.model).toBe('mimo-v2-omni');
      expect(config?.baseUrl).toBe('https://token-plan-ams.xiaomimimo.com/v1');
    });
  });

  describe('context window settings', () => {
    it('returns 32000 as default', async () => {
      expect(await svc.getContextWindowSize()).toBe(32000);
    });

    it('sets and retrieves context window size', async () => {
      await svc.setContextWindowSize(64000);
      expect(await svc.getContextWindowSize()).toBe(64000);
    });

    it('updates existing context window size', async () => {
      await svc.setContextWindowSize(16000);
      await svc.setContextWindowSize(128000);
      expect(await svc.getContextWindowSize()).toBe(128000);
    });
  });
});
