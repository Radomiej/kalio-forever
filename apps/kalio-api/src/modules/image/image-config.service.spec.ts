/**
 * ImageConfigService — integration tests with in-memory SQLite.
 *
 * Tests the full persistence layer: config reads/writes through the
 * app_settings table, with schema migration applied to ':memory:' DB.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle, BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { resolve } from 'node:path';
import * as schema from '../../database/schema';
import { DrizzleService } from '../../database/drizzle.service';
import { AppSettingsService } from '../../database/app-settings.service';
import { ImageConfigService } from './image-config.service';

// ── Test DB setup ──────────────────────────────────────────────────────────────

function createTestDb(): { db: BetterSQLite3Database<typeof schema>; close: () => void } {
  const sqlite = new Database(':memory:');
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  const db = drizzle(sqlite, { schema });
  // Apply schema migrations so app_settings table exists
  const migrationsFolder = resolve(__dirname, '../../database/migrations');
  migrate(db, { migrationsFolder });
  return { db, close: () => sqlite.close() };
}

function createServices(db: BetterSQLite3Database<typeof schema>): ImageConfigService {
  const drizzleService = { db } as unknown as DrizzleService;
  const settingsService = new AppSettingsService(drizzleService);
  return new ImageConfigService(settingsService);
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('ImageConfigService — persistence', () => {
  let testDb: ReturnType<typeof createTestDb>;
  let service: ImageConfigService;

  beforeAll(() => {
    testDb = createTestDb();
    service = createServices(testDb.db);
  });

  afterAll(() => { testDb.close(); });

  it('returns default config when nothing is saved', async () => {
    const cfg = await service.getConfig();
    expect(cfg.provider).toBe('auto');
    expect(cfg.model).toBe('flux-schnell');
    expect(cfg.source).toBe('default');
    expect(cfg.baseUrl).toBeUndefined();
  });

  it('getApiKey returns null when no config saved', async () => {
    expect(await service.getApiKey()).toBeNull();
  });

  it('saves provider + apiKey + model via updateConfig', async () => {
    await service.updateConfig({
      provider: 'cometapi',
      apiKey: 'sk-test-key',
      model: 'flux-dev',
    });

    const cfg = await service.getConfig();
    expect(cfg.provider).toBe('cometapi');
    expect(cfg.model).toBe('flux-dev');
    expect(cfg.source).toBe('db');
    // apiKey must NOT be returned in public config
    expect(cfg).not.toHaveProperty('apiKey');
  });

  it('getApiKey returns the saved key', async () => {
    const key = await service.getApiKey();
    expect(key).toBe('sk-test-key');
  });

  it('saves baseUrl and exposes it in config', async () => {
    await service.updateConfig({ baseUrl: 'https://custom.proxy.com/v1' });
    const cfg = await service.getConfig();
    expect(cfg.baseUrl).toBe('https://custom.proxy.com/v1');
  });

  it('partial update merges into existing config', async () => {
    // Only update model; provider and apiKey should be preserved
    await service.updateConfig({ model: 'flux-1.1-pro' });
    const cfg = await service.getConfig();
    expect(cfg.provider).toBe('cometapi');
    expect(cfg.model).toBe('flux-1.1-pro');
    expect(await service.getApiKey()).toBe('sk-test-key');
  });

  it('saves replicate provider', async () => {
    await service.updateConfig({ provider: 'replicate', model: 'flux-schnell' });
    const cfg = await service.getConfig();
    expect(cfg.provider).toBe('replicate');
  });

  it('saves compression config and returns it', async () => {
    await service.updateConfig({
      compression: { enabled: true, maxDimension: 512, maxKb: 256, detail: 'low' },
    });
    const cfg = await service.getConfig();
    expect(cfg.compression?.enabled).toBe(true);
    expect(cfg.compression?.maxDimension).toBe(512);
    expect(cfg.compression?.maxKb).toBe(256);
    expect(cfg.compression?.detail).toBe('low');
  });

  it('handles corrupted DB value gracefully — returns default', async () => {
    // Directly write invalid JSON to simulate corruption
    const settingsService = new AppSettingsService({ db: testDb.db } as unknown as DrizzleService);
    await settingsService.set('image_config', 'not-valid-json{{{');

    const cfg = await service.getConfig();
    // Should fall back to default without throwing
    expect(cfg.provider).toBe('auto');
    expect(cfg.source).toBe('default');
  });
});
