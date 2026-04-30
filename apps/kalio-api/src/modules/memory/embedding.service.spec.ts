import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ConfigService } from '@nestjs/config';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import Database from 'better-sqlite3';
import * as schema from '../../database/schema';
import { DrizzleService } from '../../database/drizzle.service';
import { AppSettingsService } from '../../database/app-settings.service';
import { EmbeddingCredentialsService } from './embedding-credentials.service';
import {
  EmbeddingService,
  MockEmbeddingProvider,
  OpenAICompatibleEmbeddingProvider,
  OllamaEmbeddingProvider,
} from './embedding.service';

// ── helpers ──────────────────────────────────────────────────────────────────

function makeTestDeps(): {
  drizzleSvc: DrizzleService;
  appSettings: AppSettingsService;
  embeddingCredentials: EmbeddingCredentialsService;
} {
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
  return { drizzleSvc, appSettings, embeddingCredentials };
}

function makeConfig(env: Record<string, string> = {}): ConfigService {
  return { get: (key: string, def = '') => env[key] ?? def } as unknown as ConfigService;
}

function makeService(env: Record<string, string> = {}): {
  svc: EmbeddingService;
  credentials: EmbeddingCredentialsService;
} {
  const { embeddingCredentials } = makeTestDeps();
  const config = makeConfig(env);
  const svc = new EmbeddingService(config, embeddingCredentials);
  return { svc, credentials: embeddingCredentials };
}

// ── MockEmbeddingProvider ─────────────────────────────────────────────────────

describe('MockEmbeddingProvider', () => {
  it('returns zero-ish vectors for each input text', async () => {
    const p = new MockEmbeddingProvider(4);
    const result = await p.embed(['hello', 'world']);
    expect(result).toHaveLength(2);
    expect(result[0]).toHaveLength(4);
    expect(result[1]).toHaveLength(4);
  });

  it('getDimensions returns constructor value', () => {
    expect(new MockEmbeddingProvider(768).getDimensions()).toBe(768);
    expect(new MockEmbeddingProvider(1536).getDimensions()).toBe(1536);
  });

  it('defaults to 1536 dimensions', () => {
    expect(new MockEmbeddingProvider().getDimensions()).toBe(1536);
  });
});

// ── OllamaEmbeddingProvider ───────────────────────────────────────────────────

describe('OllamaEmbeddingProvider', () => {
  it('getDimensions returns constructor value', () => {
    expect(new OllamaEmbeddingProvider('http://localhost:11434', 'nomic', 768).getDimensions()).toBe(768);
  });

  it('throws on non-ok HTTP response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 503,
      text: async () => 'Service Unavailable',
    }));
    const p = new OllamaEmbeddingProvider('http://localhost:11434', 'nomic', 768);
    await expect(p.embed(['test'])).rejects.toThrow('503');
    vi.unstubAllGlobals();
  });

  it('parses embeddings array from response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({ embeddings: [[0.1, 0.2, 0.3]] }),
    }));
    const p = new OllamaEmbeddingProvider('http://localhost:11434', 'nomic', 3);
    const result = await p.embed(['hi']);
    expect(result[0]).toEqual([0.1, 0.2, 0.3]);
    vi.unstubAllGlobals();
  });

  it('parses single embedding array from response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({ embedding: [0.5, 0.6] }),
    }));
    const p = new OllamaEmbeddingProvider('http://localhost:11434', 'nomic', 2);
    const result = await p.embed(['hi']);
    expect(result[0]).toEqual([0.5, 0.6]);
    vi.unstubAllGlobals();
  });

  it('throws on invalid response shape', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({ unexpected: true }),
    }));
    const p = new OllamaEmbeddingProvider('http://localhost:11434', 'nomic', 768);
    await expect(p.embed(['test'])).rejects.toThrow('Invalid Ollama');
    vi.unstubAllGlobals();
  });
});

// ── OpenAICompatibleEmbeddingProvider ─────────────────────────────────────────

describe('OpenAICompatibleEmbeddingProvider', () => {
  it('getDimensions returns constructor value', () => {
    const p = new OpenAICompatibleEmbeddingProvider({ apiKey: 'k', baseUrl: 'https://api.openai.com/v1', model: 'm', dimensions: 512 });
    expect(p.getDimensions()).toBe(512);
  });

  it('throws on non-ok HTTP response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 401,
      text: async () => 'Unauthorized',
    }));
    const p = new OpenAICompatibleEmbeddingProvider({ apiKey: 'bad', baseUrl: 'https://api.openai.com/v1', model: 'e', dimensions: 1536 });
    await expect(p.embed(['test'])).rejects.toThrow('401');
    vi.unstubAllGlobals();
  });

  it('returns sorted embeddings by index', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        data: [
          { index: 1, embedding: [0.2, 0.3] },
          { index: 0, embedding: [0.0, 0.1] },
        ],
      }),
    }));
    const p = new OpenAICompatibleEmbeddingProvider({ apiKey: 'k', baseUrl: 'https://api.openai.com/v1', model: 'e', dimensions: 2 });
    const result = await p.embed(['a', 'b']);
    expect(result[0]).toEqual([0.0, 0.1]);
    expect(result[1]).toEqual([0.2, 0.3]);
    vi.unstubAllGlobals();
  });

  it('throws on missing data array in response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({ model: 'e' }),
    }));
    const p = new OpenAICompatibleEmbeddingProvider({ apiKey: 'k', baseUrl: 'https://api.openai.com/v1', model: 'e', dimensions: 1536 });
    await expect(p.embed(['test'])).rejects.toThrow('Invalid embedding API');
    vi.unstubAllGlobals();
  });

  it('sends Authorization header with Bearer token', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: [{ index: 0, embedding: [0.1] }] }),
    });
    vi.stubGlobal('fetch', fetchMock);
    const p = new OpenAICompatibleEmbeddingProvider({ apiKey: 'sk-test', baseUrl: 'https://api.openai.com/v1', model: 'e', dimensions: 1 });
    await p.embed(['hello']);
    const [_url, opts] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect((opts.headers as Record<string, string>)['Authorization']).toBe('Bearer sk-test');
    vi.unstubAllGlobals();
  });

  it('strips trailing slash from baseUrl', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: [{ index: 0, embedding: [0.1] }] }),
    });
    vi.stubGlobal('fetch', fetchMock);
    const p = new OpenAICompatibleEmbeddingProvider({ apiKey: 'k', baseUrl: 'https://api.openai.com/v1/', model: 'e', dimensions: 1 });
    await p.embed(['test']);
    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toBe('https://api.openai.com/v1/embeddings');
    vi.unstubAllGlobals();
  });
});

// ── EmbeddingService ──────────────────────────────────────────────────────────

describe('EmbeddingService', () => {
  describe('reloadFromCredential — no DB credential, no env', () => {
    it('uses MockEmbeddingProvider when nothing configured', async () => {
      const { svc } = makeService();
      await svc.reloadFromCredential();
      const status = svc.getStatus();
      expect(status.source).toBe('mock');
      expect(status.configured).toBe(false);
    });

    it('getStatus returns mock shape', async () => {
      const { svc } = makeService();
      await svc.reloadFromCredential();
      const s = svc.getStatus();
      expect(s.provider).toBe('mock');
      expect(s.model).toBe('mock');
      expect(s.baseUrlMasked).toBe('(mock)');
    });
  });

  describe('reloadFromCredential — env vars', () => {
    it('uses env provider when EMBEDDING_API_KEY + EMBEDDING_BASE_URL set', async () => {
      const { svc } = makeService({
        EMBEDDING_API_KEY: 'sk-env',
        EMBEDDING_BASE_URL: 'https://api.openai.com/v1',
        EMBEDDING_MODEL: 'text-embedding-ada-002',
        EMBEDDING_DIMENSIONS: '1536',
      });
      await svc.reloadFromCredential();
      const status = svc.getStatus();
      expect(status.source).toBe('env');
      expect(status.configured).toBe(true);
      expect(status.model).toBe('text-embedding-ada-002');
    });

    it('falls back to LLM_API_KEY + LLM_BASE_URL if embedding-specific vars absent', async () => {
      const { svc } = makeService({
        LLM_API_KEY: 'sk-llm',
        LLM_BASE_URL: 'https://cometapi.com/v1',
      });
      await svc.reloadFromCredential();
      const status = svc.getStatus();
      expect(status.source).toBe('env');
      expect(status.configured).toBe(true);
    });

    it('treats "mock" as missing for env fallback', async () => {
      const { svc } = makeService({
        EMBEDDING_API_KEY: 'mock',
        EMBEDDING_BASE_URL: 'mock',
      });
      await svc.reloadFromCredential();
      expect(svc.getStatus().source).toBe('mock');
    });
  });

  describe('reloadFromCredential — DB credential takes priority over env', () => {
    it('uses DB credential and ignores env when active credential exists', async () => {
      const { svc, credentials } = makeService({
        EMBEDDING_API_KEY: 'sk-env',
        EMBEDDING_BASE_URL: 'https://env.example.com/v1',
      });
      const c = await credentials.create({
        name: 'DBCred',
        provider: 'openai',
        apiKey: 'sk-db',
        baseUrl: 'https://db.example.com/v1',
        model: 'text-embedding-3-large',
        dimensions: 3072,
      });
      await credentials.setActive(c.id);
      await svc.reloadFromCredential();

      const status = svc.getStatus();
      expect(status.source).toBe('db');
      expect(status.configured).toBe(true);
      expect(status.model).toBe('text-embedding-3-large');
      expect(status.activeCredentialId).toBe(c.id);
      expect(status.activeCredentialName).toBe('DBCred');
    });

    it('falls back to env when DB credential is cleared', async () => {
      const { svc, credentials } = makeService({
        EMBEDDING_API_KEY: 'sk-env',
        EMBEDDING_BASE_URL: 'https://env.example.com/v1',
      });
      const c = await credentials.create({ name: 'C', provider: 'openai', apiKey: 'sk-db', baseUrl: 'https://db.example.com/v1', model: 'e', dimensions: 1536 });
      await credentials.setActive(c.id);
      await svc.reloadFromCredential();
      expect(svc.getStatus().source).toBe('db');

      await credentials.clearActive();
      await svc.reloadFromCredential();
      expect(svc.getStatus().source).toBe('env');
    });
  });

  describe('getStatus — ollama URL detection', () => {
    it('reports provider as ollama for localhost:11434 URL', async () => {
      const { svc, credentials } = makeService();
      const c = await credentials.create({ name: 'Ollama', provider: 'ollama', apiKey: '', baseUrl: 'http://localhost:11434', model: 'nomic-embed-text', dimensions: 768 });
      await credentials.setActive(c.id);
      await svc.reloadFromCredential();
      expect(svc.getStatus().provider).toBe('ollama');
    });
  });

  describe('onModuleInit', () => {
    it('calls reloadFromCredential on startup', async () => {
      const { svc } = makeService();
      const spy = vi.spyOn(svc, 'reloadFromCredential');
      await svc.onModuleInit();
      expect(spy).toHaveBeenCalledOnce();
    });
  });

  describe('embedOne / embedBatch', () => {
    it('embedOne returns a number array', async () => {
      const { svc } = makeService();
      await svc.reloadFromCredential(); // uses MockProvider
      const vec = await svc.embedOne('hello');
      expect(Array.isArray(vec)).toBe(true);
      expect(vec.length).toBeGreaterThan(0);
    });

    it('embedBatch returns one vector per input', async () => {
      const { svc } = makeService();
      await svc.reloadFromCredential();
      const vecs = await svc.embedBatch(['a', 'b', 'c']);
      expect(vecs).toHaveLength(3);
    });
  });

  describe('getDimensions', () => {
    it('returns mock dimensions when not configured', async () => {
      const { svc } = makeService();
      await svc.reloadFromCredential();
      expect(svc.getDimensions()).toBe(1536);
    });
  });

  describe('getModelName', () => {
    it('returns active model name when configured from DB', async () => {
      const { svc, credentials } = makeService();
      const c = await credentials.create({ name: 'M', provider: 'openai', apiKey: 'k', baseUrl: 'https://x.com', model: 'text-embedding-3-large', dimensions: 3072 });
      await credentials.setActive(c.id);
      await svc.reloadFromCredential();
      expect(await svc.getModelName()).toBe('text-embedding-3-large');
    });

    it('returns default when not configured', async () => {
      const { svc } = makeService();
      await svc.reloadFromCredential();
      expect(await svc.getModelName()).toBe('text-embedding-3-small');
    });
  });

  describe('edge case: getProvider before onModuleInit', () => {
    it('returns mock provider without crashing', async () => {
      const { svc } = makeService();
      // Do NOT call reloadFromCredential — test defensive fallback
      const vec = await svc.embedOne('test before init');
      expect(Array.isArray(vec)).toBe(true);
    });
  });
});
