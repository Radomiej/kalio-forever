import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import Database from 'better-sqlite3';
import * as schema from '../../database/schema';
import { DrizzleService } from '../../database/drizzle.service';
import { AppSettingsService } from '../../database/app-settings.service';
import { EmbeddingCredentialsService } from './embedding-credentials.service';
import { EmbeddingService } from './embedding.service';
import { MemoryController } from './memory.controller';
import { MemoryService } from './memory.service';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeTestDeps() {
  const sqlite = new Database(':memory:');
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
  const embeddingCredentials = new EmbeddingCredentialsService(drizzleSvc, appSettings);
  const config = { get: (_k: string, def = '') => def } as unknown as ConfigService;
  const embeddingService = new EmbeddingService(config, embeddingCredentials);

  // Minimal stub for MemoryService — only exposes getEmbeddingService()
  const memoryService = {
    getEmbeddingService: () => embeddingService,
  } as unknown as MemoryService;

  const controller = new MemoryController(memoryService, embeddingCredentials);
  return { controller, embeddingCredentials, embeddingService };
}

const BASE_DTO = {
  name: 'Test Provider',
  provider: 'openai' as const,
  apiKey: 'sk-test',
  baseUrl: 'https://api.openai.com/v1',
  model: 'text-embedding-3-small',
  dimensions: 1536,
};

// ── Test suite ────────────────────────────────────────────────────────────────

describe('MemoryController — embedding credential routes', () => {
  let controller: MemoryController;
  let credentials: EmbeddingCredentialsService;
  let embeddingService: EmbeddingService;

  beforeEach(async () => {
    ({ controller, embeddingCredentials: credentials, embeddingService } = makeTestDeps());
    await embeddingService.reloadFromCredential();
  });

  // ── GET /embedding-credentials ──────────────────────────────────────────────

  describe('listEmbeddingCredentials', () => {
    it('returns empty array initially', async () => {
      expect(await controller.listEmbeddingCredentials()).toEqual([]);
    });

    it('returns created credentials without apiKey', async () => {
      await controller.createEmbeddingCredential(BASE_DTO);
      const list = await controller.listEmbeddingCredentials();
      expect(list).toHaveLength(1);
      expect(list[0]!.name).toBe('Test Provider');
      expect((list[0] as unknown as Record<string, unknown>)['apiKey']).toBeUndefined();
    });
  });

  // ── POST /embedding-credentials ─────────────────────────────────────────────

  describe('createEmbeddingCredential', () => {
    it('creates and returns credential', async () => {
      const created = await controller.createEmbeddingCredential(BASE_DTO);
      expect(created.id).toBeTruthy();
      expect(created.name).toBe('Test Provider');
    });

    it('multiple creates return distinct ids', async () => {
      const a = await controller.createEmbeddingCredential({ ...BASE_DTO, name: 'A' });
      const b = await controller.createEmbeddingCredential({ ...BASE_DTO, name: 'B' });
      expect(a.id).not.toBe(b.id);
    });
  });

  // ── PUT /embedding-credentials/active/:id ────────────────────────────────────

  describe('setActiveEmbeddingCredential', () => {
    it('sets active and reloads: status source becomes db', async () => {
      const c = await controller.createEmbeddingCredential(BASE_DTO);
      const status = await controller.setActiveEmbeddingCredential(c.id);
      expect(status.source).toBe('db');
      expect(status.configured).toBe(true);
      expect(status.activeCredentialId).toBe(c.id);
      expect(status.activeCredentialName).toBe('Test Provider');
    });

    it('throws NotFoundException for unknown id', async () => {
      await expect(controller.setActiveEmbeddingCredential('bogus-id')).rejects.toThrow(NotFoundException);
    });

    it('switching active between two credentials updates status correctly', async () => {
      const a = await controller.createEmbeddingCredential({ ...BASE_DTO, name: 'ProviderA', model: 'model-a' });
      const b = await controller.createEmbeddingCredential({ ...BASE_DTO, name: 'ProviderB', model: 'model-b' });
      await controller.setActiveEmbeddingCredential(a.id);
      const statusB = await controller.setActiveEmbeddingCredential(b.id);
      expect(statusB.model).toBe('model-b');
      expect(statusB.activeCredentialId).toBe(b.id);
    });
  });

  // ── DELETE /embedding-credentials/active ────────────────────────────────────

  describe('clearActiveEmbeddingCredential', () => {
    it('clears active: status source falls to mock', async () => {
      const c = await controller.createEmbeddingCredential(BASE_DTO);
      await controller.setActiveEmbeddingCredential(c.id);
      const status = await controller.clearActiveEmbeddingCredential();
      expect(status.source).toBe('mock');
      expect(status.configured).toBe(false);
    });

    it('is idempotent when nothing active', async () => {
      const status = await controller.clearActiveEmbeddingCredential();
      expect(status.source).toBe('mock');
    });
  });

  // ── DELETE /embedding-credentials/:id ──────────────────────────────────────

  describe('removeEmbeddingCredential', () => {
    it('removes credential and returns mock status when it was the active one', async () => {
      const c = await controller.createEmbeddingCredential(BASE_DTO);
      await controller.setActiveEmbeddingCredential(c.id);
      const status = await controller.removeEmbeddingCredential(c.id);
      expect(status.source).toBe('mock');
      const list = await controller.listEmbeddingCredentials();
      expect(list).toHaveLength(0);
    });

    it('removes non-active credential without affecting active status', async () => {
      const active = await controller.createEmbeddingCredential({ ...BASE_DTO, name: 'Active' });
      const other = await controller.createEmbeddingCredential({ ...BASE_DTO, name: 'Other' });
      await controller.setActiveEmbeddingCredential(active.id);
      const status = await controller.removeEmbeddingCredential(other.id);
      expect(status.source).toBe('db');
      expect(status.activeCredentialId).toBe(active.id);
      const list = await controller.listEmbeddingCredentials();
      expect(list).toHaveLength(1);
    });

    it('is a no-op for nonexistent id and returns current status', async () => {
      const status = await controller.removeEmbeddingCredential('nonexistent');
      expect(status).toBeDefined();
      expect(status.source).toBe('mock');
    });
  });

  // ── GET /status/embedding ───────────────────────────────────────────────────

  describe('getEmbeddingStatus', () => {
    it('returns mock status when nothing configured', async () => {
      const status = await controller.getEmbeddingStatus();
      expect(status.source).toBe('mock');
      expect(status.configured).toBe(false);
    });

    it('returns db status after activating a credential', async () => {
      const c = await controller.createEmbeddingCredential(BASE_DTO);
      await controller.setActiveEmbeddingCredential(c.id);
      const status = await controller.getEmbeddingStatus();
      expect(status.source).toBe('db');
      expect(status.configured).toBe(true);
    });
  });

  // ── POST /embedding-credentials/:id/test ────────────────────────────────────

  describe('testEmbeddingCredential', () => {
    it('throws NotFoundException for unknown credential id', async () => {
      await expect(controller.testEmbeddingCredential('no-such-id')).rejects.toThrow(NotFoundException);
    });

    it('returns { ok: false, error } when provider returns HTTP error', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce({
        ok: false,
        status: 401,
        text: async () => 'Unauthorized',
      }));
      const c = await controller.createEmbeddingCredential(BASE_DTO);
      const result = await controller.testEmbeddingCredential(c.id);
      expect(result.ok).toBe(false);
      expect(result.error).toContain('401');
      vi.unstubAllGlobals();
    });

    it('returns { ok: true } when provider responds correctly', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: [{ index: 0, embedding: [0.1, 0.2] }] }),
      }));
      const c = await controller.createEmbeddingCredential(BASE_DTO);
      const result = await controller.testEmbeddingCredential(c.id);
      expect(result.ok).toBe(true);
      expect(result.error).toBeUndefined();
      vi.unstubAllGlobals();
    });

    it('tests ollama credential via OllamaEmbeddingProvider', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => ({ embeddings: [[0.1, 0.2]] }),
      }));
      const c = await controller.createEmbeddingCredential({
        name: 'LocalOllama',
        provider: 'ollama',
        apiKey: '',
        baseUrl: 'http://localhost:11434',
        model: 'nomic-embed-text',
        dimensions: 768,
      });
      const result = await controller.testEmbeddingCredential(c.id);
      expect(result.ok).toBe(true);
      vi.unstubAllGlobals();
    });

    it('does NOT change active credential after test', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: [{ index: 0, embedding: [0.1] }] }),
      }));
      const active = await controller.createEmbeddingCredential({ ...BASE_DTO, name: 'Active' });
      const tested = await controller.createEmbeddingCredential({ ...BASE_DTO, name: 'Tested' });
      await controller.setActiveEmbeddingCredential(active.id);

      await controller.testEmbeddingCredential(tested.id);
      const status = await controller.getEmbeddingStatus();
      expect(status.activeCredentialId).toBe(active.id); // unchanged
      vi.unstubAllGlobals();
    });
  });

  // ── Full lifecycle integration ────────────────────────────────────────────────

  describe('full lifecycle', () => {
    it('create → activate → verify → add second → switch → remove first → status consistent', async () => {
      // Create first provider
      const p1 = await controller.createEmbeddingCredential({ ...BASE_DTO, name: 'P1', model: 'model-1' });
      expect((await controller.listEmbeddingCredentials())).toHaveLength(1);

      // Activate first
      let status = await controller.setActiveEmbeddingCredential(p1.id);
      expect(status.source).toBe('db');
      expect(status.model).toBe('model-1');

      // Add second
      const p2 = await controller.createEmbeddingCredential({ ...BASE_DTO, name: 'P2', model: 'model-2' });
      expect((await controller.listEmbeddingCredentials())).toHaveLength(2);

      // Switch to second
      status = await controller.setActiveEmbeddingCredential(p2.id);
      expect(status.model).toBe('model-2');
      expect(status.activeCredentialId).toBe(p2.id);

      // Remove second (active) — should fall to mock
      status = await controller.removeEmbeddingCredential(p2.id);
      expect(status.source).toBe('mock');

      // First still in list
      const remaining = await controller.listEmbeddingCredentials();
      expect(remaining).toHaveLength(1);
      expect(remaining[0]!.id).toBe(p1.id);
    });
  });
});
