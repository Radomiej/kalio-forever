import { describe, it, expect, beforeEach, vi } from 'vitest';
import { CredentialsService } from './credentials.service';
import { DrizzleService } from '../../database/drizzle.service';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import Database from 'better-sqlite3';
import * as schema from '../../database/schema';
import { eq } from 'drizzle-orm';

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
  let drizzleSvc: DrizzleService;
  const timeoutSettings = {
    getProviderTimeoutMs: vi.fn(async (isLocal: boolean) => (isLocal ? 3_000 : 15_000)),
  };
  const config = {
    get: (key: string, defaultValue = '') => {
      if (key === 'NODE_ENV') return 'test';
      if (key === 'CREDENTIALS_MASTER_KEY') return 'unit-test-credentials-master-key';
      return defaultValue;
    },
  };

  beforeEach(() => {
    drizzleSvc = makeTestDrizzle();
    timeoutSettings.getProviderTimeoutMs.mockImplementation(async (isLocal: boolean) => (isLocal ? 3_000 : 15_000));
    svc = new CredentialsService(drizzleSvc, timeoutSettings as never, config as never);
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

    it('creates a local provider credential when apiKey is omitted', async () => {
      const created = await svc.create({
        name: 'Local BitNet',
        provider: 'bitnet',
        baseUrl: 'http://localhost:8080/v1',
        model: 'bitnet-b1.58-2b-4t',
      });

      expect(created.name).toBe('Local BitNet');
      expect(created.provider).toBe('bitnet');
      expect(await svc.getApiKey(created.id)).toBe('');
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

    it('REGRESSION: encrypts apiKey at rest while preserving read access through the service', async () => {
      const created = await svc.create({ name: 'Encrypted', provider: 'openai', apiKey: 'sk-top-secret' });

      const stored = await drizzleSvc.db
        .select()
        .from(schema.credentials)
        .where(eq(schema.credentials.id, created.id))
        .then((rows) => rows[0]);

      expect(stored).toBeDefined();
      expect(stored?.apiKey).not.toBe('sk-top-secret');
      expect(await svc.getApiKey(created.id)).toBe('sk-top-secret');

      await svc.setActiveCredential(created.id);
      const config = await svc.getActiveProviderConfig();
      expect(config?.apiKey).toBe('sk-top-secret');
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

  describe('max tool attempts settings', () => {
    it('returns 8 as default', async () => {
      expect(await svc.getMaxToolAttempts()).toBe(8);
    });

    it('sets and retrieves max tool attempts', async () => {
      await svc.setMaxToolAttempts(25);
      expect(await svc.getMaxToolAttempts()).toBe(25);
    });

    it('clamps max tool attempts to [1, 100]', async () => {
      await svc.setMaxToolAttempts(0);
      expect(await svc.getMaxToolAttempts()).toBe(1);

      await svc.setMaxToolAttempts(999);
      expect(await svc.getMaxToolAttempts()).toBe(100);
    });
  });

  describe('updateModel()', () => {
    it('throws NotFoundException for nonexistent credential', async () => {
      await expect(svc.updateModel('nonexistent', 'gpt-4o')).rejects.toThrow();
    });

    it('updates model and returns credential without apiKey', async () => {
      const c = await svc.create({ name: 'A', provider: 'openai', apiKey: 'key', model: 'old-model' });
      const updated = await svc.updateModel(c.id, 'new-model');
      expect(updated.model).toBe('new-model');
      expect((updated as unknown as Record<string, unknown>)['apiKey']).toBeUndefined();
    });
  });

  describe('generation settings', () => {
    it('getGenerationSettings returns defaults when not set', async () => {
      const settings = await svc.getGenerationSettings();
      expect(settings.temperature).toBe(0.7);
      expect(settings.maxTokens).toBe(4096);
    });

    it('setGenerationSettings persists temperature', async () => {
      await svc.setGenerationSettings({ temperature: 0.9 });
      const settings = await svc.getGenerationSettings();
      expect(settings.temperature).toBe(0.9);
    });

    it('setGenerationSettings persists maxTokens', async () => {
      await svc.setGenerationSettings({ maxTokens: 8192 });
      const settings = await svc.getGenerationSettings();
      expect(settings.maxTokens).toBe(8192);
    });

    it('setGenerationSettings updates existing values (upsert)', async () => {
      await svc.setGenerationSettings({ temperature: 0.5, maxTokens: 2048 });
      await svc.setGenerationSettings({ temperature: 0.8, maxTokens: 4096 });
      const settings = await svc.getGenerationSettings();
      expect(settings.temperature).toBe(0.8);
      expect(settings.maxTokens).toBe(4096);
    });

    it('setGenerationSettings with only temperature does not change maxTokens', async () => {
      await svc.setGenerationSettings({ maxTokens: 1024 });
      await svc.setGenerationSettings({ temperature: 0.3 });
      const settings = await svc.getGenerationSettings();
      expect(settings.temperature).toBe(0.3);
      expect(settings.maxTokens).toBe(1024);
    });
  });

  describe('setActiveCredential() upsert branch', () => {
    it('updates existing active_llm_credential when already set (upsert update path)', async () => {
      const c1 = await svc.create({ name: 'C1', provider: 'openai', apiKey: 'key1' });
      const c2 = await svc.create({ name: 'C2', provider: 'openai', apiKey: 'key2' });
      // First call: inserts
      await svc.setActiveCredential(c1.id);
      expect(await svc.getActiveCredentialId()).toBe(c1.id);
      // Second call: updates existing row (tests the `if (existing)` branch)
      await svc.setActiveCredential(c2.id);
      expect(await svc.getActiveCredentialId()).toBe(c2.id);
    });
  });

  describe('getModelsForCredential()', () => {
    it('throws NotFoundException for nonexistent credential', async () => {
      await expect(svc.getModelsForCredential('nonexistent')).rejects.toThrow();
    });

    it('returns empty array when baseUrl is empty and no provider URL', async () => {
      const c = await svc.create({ name: 'Custom', provider: 'unknown-provider' as 'openai', apiKey: 'key' });
      const result = await svc.getModelsForCredential(c.id);
      expect(result).toEqual([]);
    });

    it('returns empty array when fetch fails', async () => {
      const fetchMock = vi.fn().mockRejectedValue(new Error('network error'));
      vi.stubGlobal('fetch', fetchMock);
      const c = await svc.create({ name: 'OpenAI', provider: 'openai', apiKey: 'key', model: 'gpt-4' });
      const result = await svc.getModelsForCredential(c.id);
      expect(result).toEqual([]);
      vi.unstubAllGlobals();
    });

    it('returns model list from successful fetch', async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ data: [{ id: 'gpt-4o' }, { id: 'gpt-4-turbo' }] }),
      });
      vi.stubGlobal('fetch', fetchMock);
      const c = await svc.create({ name: 'OpenAI', provider: 'openai', apiKey: 'key' });
      const result = await svc.getModelsForCredential(c.id);
      expect(result).toContain('gpt-4o');
      expect(result).toContain('gpt-4-turbo');
      vi.unstubAllGlobals();
    });

    it('returns empty array when fetch response is not ok', async () => {
      const fetchMock = vi.fn().mockResolvedValue({ ok: false });
      vi.stubGlobal('fetch', fetchMock);
      const c = await svc.create({ name: 'OpenAI', provider: 'openai', apiKey: 'key' });
      const result = await svc.getModelsForCredential(c.id);
      expect(result).toEqual([]);
      vi.unstubAllGlobals();
    });

    it('uses local timeout for custom credential pointing to localhost', async () => {
      await drizzleSvc.db.insert(schema.credentials).values({
        id: 'custom-local',
        name: 'Custom Local',
        provider: 'custom',
        apiKey: 'key',
        baseUrl: 'http://localhost:1234',
        model: null,
        createdAt: new Date(),
      });
      const fetchMock = vi.fn().mockResolvedValue({ ok: false });
      vi.stubGlobal('fetch', fetchMock);

      await svc.getModelsForCredential('custom-local');

      expect(timeoutSettings.getProviderTimeoutMs).toHaveBeenCalledWith(true);
      vi.unstubAllGlobals();
    });
  });
});
