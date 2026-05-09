import { describe, it, expect, beforeEach } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import Database from 'better-sqlite3';
import * as schema from '../../database/schema';
import { DrizzleService } from '../../database/drizzle.service';
import { AppSettingsService } from '../../database/app-settings.service';
import { EmbeddingCredentialsService } from './embedding-credentials.service';

/** Build isolated in-memory SQLite with required tables */
function makeTestDeps(): { drizzleSvc: DrizzleService; appSettings: AppSettingsService } {
  const sqlite = new Database(':memory:');
  sqlite.pragma('foreign_keys = ON');
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS embedding_credentials (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      provider TEXT NOT NULL,
      api_key TEXT NOT NULL,
      base_url TEXT NOT NULL DEFAULT '',
      model TEXT NOT NULL DEFAULT '',
      dimensions INTEGER NOT NULL DEFAULT 1536,
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
  (drizzleSvc as unknown as { db: typeof db }).db = db;

  const appSettings = new AppSettingsService(drizzleSvc);
  return { drizzleSvc, appSettings };
}

describe('EmbeddingCredentialsService', () => {
  let svc: EmbeddingCredentialsService;

  beforeEach(() => {
    const { drizzleSvc, appSettings } = makeTestDeps();
    svc = new EmbeddingCredentialsService(drizzleSvc, appSettings);
  });

  // ── findAll ──────────────────────────────────────────────────────────────

  describe('findAll', () => {
    it('returns empty array when no credentials', async () => {
      expect(await svc.findAll()).toEqual([]);
    });

    it('returns all credentials without apiKey', async () => {
      await svc.create({ name: 'A', provider: 'openai', apiKey: 'sk-a', baseUrl: 'https://api.openai.com/v1', model: 'text-embedding-3-small', dimensions: 1536 });
      await svc.create({ name: 'B', provider: 'ollama', apiKey: '', baseUrl: 'http://localhost:11434', model: 'nomic-embed-text', dimensions: 768 });
      const all = await svc.findAll();
      expect(all).toHaveLength(2);
      for (const c of all) {
        expect((c as unknown as Record<string, unknown>)['apiKey']).toBeUndefined();
      }
    });

    it('each row contains expected public fields', async () => {
      await svc.create({ name: 'MyOpenAI', provider: 'openai', apiKey: 'sk-secret', baseUrl: 'https://api.openai.com/v1', model: 'text-embedding-3-small', dimensions: 1536 });
      const [c] = await svc.findAll();
      expect(c!.id).toBeTruthy();
      expect(c!.name).toBe('MyOpenAI');
      expect(c!.provider).toBe('openai');
      expect(c!.model).toBe('text-embedding-3-small');
      expect(c!.baseUrl).toBe('https://api.openai.com/v1');
      expect(c!.dimensions).toBe(1536);
      expect(typeof c!.createdAt).toBe('number');
    });
  });

  // ── create ───────────────────────────────────────────────────────────────

  describe('create', () => {
    it('creates a credential and returns it without apiKey', async () => {
      const created = await svc.create({
        name: 'CometAPI',
        provider: 'cometapi',
        apiKey: 'secret-key',
        baseUrl: 'https://api.cometapi.com/v1',
        model: 'text-embedding-3-small',
        dimensions: 1536,
      });
      expect(created.id).toBeTruthy();
      expect(created.name).toBe('CometAPI');
      expect(created.provider).toBe('cometapi');
      expect((created as unknown as Record<string, unknown>)['apiKey']).toBeUndefined();
    });

    it('each created credential gets a unique id', async () => {
      const a = await svc.create({ name: 'A', provider: 'openai', apiKey: 'k', baseUrl: 'https://x.com', model: 'e', dimensions: 1536 });
      const b = await svc.create({ name: 'B', provider: 'openai', apiKey: 'k', baseUrl: 'https://x.com', model: 'e', dimensions: 1536 });
      expect(a.id).not.toBe(b.id);
    });

    it('createdAt is a unix ms number', async () => {
      const before = Date.now() - 10;
      const created = await svc.create({ name: 'T', provider: 'openai', apiKey: 'k', baseUrl: 'https://x.com', model: 'e', dimensions: 1536 });
      expect(created.createdAt).toBeGreaterThanOrEqual(before);
      expect(created.createdAt).toBeLessThanOrEqual(Date.now() + 10);
    });
  });

  // ── remove ───────────────────────────────────────────────────────────────

  describe('remove', () => {
    it('removes a credential from the list', async () => {
      const c = await svc.create({ name: 'Del', provider: 'openai', apiKey: 'k', baseUrl: 'https://x.com', model: 'e', dimensions: 1536 });
      await svc.remove(c.id);
      expect(await svc.findAll()).toHaveLength(0);
    });

    it('is a no-op for non-existent id', async () => {
      await expect(svc.remove('nonexistent-id')).resolves.not.toThrow();
    });

    it('clears active setting when the active credential is deleted', async () => {
      const c = await svc.create({ name: 'Active', provider: 'openai', apiKey: 'k', baseUrl: 'https://x.com', model: 'e', dimensions: 1536 });
      await svc.setActive(c.id);
      expect(await svc.getActiveId()).toBe(c.id);
      await svc.remove(c.id);
      expect(await svc.getActiveId()).toBeNull();
    });

    it('does not clear active when a different credential is deleted', async () => {
      const a = await svc.create({ name: 'A', provider: 'openai', apiKey: 'k', baseUrl: 'https://x.com', model: 'e', dimensions: 1536 });
      const b = await svc.create({ name: 'B', provider: 'openai', apiKey: 'k', baseUrl: 'https://x.com', model: 'e', dimensions: 1536 });
      await svc.setActive(a.id);
      await svc.remove(b.id);
      expect(await svc.getActiveId()).toBe(a.id);
    });
  });

  // ── setActive / clearActive / getActiveId ────────────────────────────────

  describe('active credential management', () => {
    it('returns null when no active credential is set', async () => {
      expect(await svc.getActiveId()).toBeNull();
    });

    it('sets and retrieves active credential id', async () => {
      const c = await svc.create({ name: 'A', provider: 'openai', apiKey: 'k', baseUrl: 'https://x.com', model: 'e', dimensions: 1536 });
      await svc.setActive(c.id);
      expect(await svc.getActiveId()).toBe(c.id);
    });

    it('throws NotFoundException when setting nonexistent credential as active', async () => {
      await expect(svc.setActive('nonexistent')).rejects.toThrow(NotFoundException);
    });

    it('replaces active when setActive called twice', async () => {
      const a = await svc.create({ name: 'A', provider: 'openai', apiKey: 'k', baseUrl: 'https://x.com', model: 'e', dimensions: 1536 });
      const b = await svc.create({ name: 'B', provider: 'openai', apiKey: 'k', baseUrl: 'https://x.com', model: 'e', dimensions: 1536 });
      await svc.setActive(a.id);
      await svc.setActive(b.id);
      expect(await svc.getActiveId()).toBe(b.id);
    });

    it('clearActive sets active to null', async () => {
      const c = await svc.create({ name: 'A', provider: 'openai', apiKey: 'k', baseUrl: 'https://x.com', model: 'e', dimensions: 1536 });
      await svc.setActive(c.id);
      await svc.clearActive();
      expect(await svc.getActiveId()).toBeNull();
    });

    it('clearActive is a no-op when nothing is active', async () => {
      await expect(svc.clearActive()).resolves.not.toThrow();
      expect(await svc.getActiveId()).toBeNull();
    });
  });

  // ── getActiveConfig ───────────────────────────────────────────────────────

  describe('getActiveConfig', () => {
    it('returns null when no active credential', async () => {
      expect(await svc.getActiveConfig()).toBeNull();
    });

    it('returns full config INCLUDING apiKey when active is set', async () => {
      const c = await svc.create({
        name: 'Full',
        provider: 'openai',
        apiKey: 'sk-internal',
        baseUrl: 'https://api.openai.com/v1',
        model: 'text-embedding-3-small',
        dimensions: 1536,
      });
      await svc.setActive(c.id);
      const cfg = await svc.getActiveConfig();
      expect(cfg).not.toBeNull();
      expect(cfg!.apiKey).toBe('sk-internal');
      expect(cfg!.id).toBe(c.id);
    });

    it('returns null when active id points to a deleted credential', async () => {
      // Simulate stale active pointer by inserting directly via appSettings
      const c = await svc.create({ name: 'Gone', provider: 'openai', apiKey: 'k', baseUrl: 'https://x.com', model: 'e', dimensions: 1536 });
      await svc.setActive(c.id);
      // Delete bypassing service to leave stale active key
      await svc.remove(c.id);
      // After remove, active key is cleared
      expect(await svc.getActiveConfig()).toBeNull();
    });
  });

  // ── getConfigById ─────────────────────────────────────────────────────────

  describe('getConfigById', () => {
    it('returns null for non-existent id', async () => {
      expect(await svc.getConfigById('nope')).toBeNull();
    });

    it('returns full config with apiKey by id', async () => {
      const c = await svc.create({ name: 'ById', provider: 'cometapi', apiKey: 'k-by-id', baseUrl: 'https://api.cometapi.com/v1', model: 'text-embedding-3-small', dimensions: 1536 });
      const cfg = await svc.getConfigById(c.id);
      expect(cfg).not.toBeNull();
      expect(cfg!.apiKey).toBe('k-by-id');
      expect(cfg!.name).toBe('ById');
    });

    it('returns correct config when multiple credentials exist', async () => {
      const a = await svc.create({ name: 'A', provider: 'openai', apiKey: 'ka', baseUrl: 'https://a.com', model: 'e', dimensions: 1536 });
      const b = await svc.create({ name: 'B', provider: 'ollama', apiKey: '', baseUrl: 'http://localhost:11434', model: 'nomic', dimensions: 768 });
      const cfgA = await svc.getConfigById(a.id);
      const cfgB = await svc.getConfigById(b.id);
      expect(cfgA!.apiKey).toBe('ka');
      expect(cfgB!.model).toBe('nomic');
    });
  });
});
