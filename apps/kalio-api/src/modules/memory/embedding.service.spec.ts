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
  buildDefaultLocalEmbeddingConfig,
  readEmbeddingEnabled,
} from './embedding.service';

const { pipelineMock } = vi.hoisted(() => ({
  pipelineMock: vi.fn(),
}));

vi.mock('@huggingface/transformers', () => ({
  env: {
    cacheDir: '',
    allowRemoteModels: true,
  },
  pipeline: pipelineMock,
}));

pipelineMock.mockImplementation(async () => async () => ({
  data: new Float32Array(384).fill(0.01),
}));

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

function makeConfig(env: Record<string, string | boolean> = {}): ConfigService {
  return {
    get: <T>(key: string, def?: T) => (key in env ? env[key] as T : def as T),
  } as unknown as ConfigService;
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
    it('uses the local default embedding model when nothing configured', async () => {
      const { svc } = makeService();
      await svc.reloadFromCredential();
      const status = svc.getStatus();
      expect(status.source).toBe('local');
      expect(status.configured).toBe(true);
      expect(status.model).toBe('Xenova/multilingual-e5-small');
      expect(status.dimensions).toBe(384);
    });

    it('getStatus returns the local default model shape', async () => {
      const { svc } = makeService();
      await svc.reloadFromCredential();
      const s = svc.getStatus();
      expect(s.provider).toBe('local-transformers');
        expect(s.source).toBe('local');
        expect(s.model).toBe('Xenova/multilingual-e5-small');
        expect(s.backend).toBe('cpu');
        expect(s.gpuAvailable).toBeUndefined();
        expect(s.cacheDir).toBe('./data/embeddings-cache');
        expect(s.profileId).toBe('local-transformers-xenova-multilingual-e5-small-384-cpu');
      });

    it('can disable embeddings from local config', async () => {
      const { svc, credentials } = makeService();
      await credentials.updateLocalConfig({
        enabled: false,
        model: 'Xenova/multilingual-e5-small',
        dimensions: 384,
        backend: 'cpu',
      });
      await svc.reloadFromCredential();

      const status = svc.getStatus();
      expect(status.provider).toBe('disabled');
      expect(status.source).toBe('disabled');
      expect(status.configured).toBe(false);
      await expect(svc.embedOne('hello')).rejects.toThrow('disabled');
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

    it('does NOT fall back to LLM_API_KEY/LLM_BASE_URL — embedding must be explicitly configured', async () => {
      // Regression: LLM env vars must never be used as embedding fallback.
      // An LLM key may not support embeddings API; silently using it causes
      // confusing failures at runtime.
      const { svc } = makeService({
        LLM_API_KEY: 'sk-llm',
        LLM_BASE_URL: 'https://cometapi.com/v1',
      });
      await svc.reloadFromCredential();
      const status = svc.getStatus();
      expect(status.source).toBe('local');      // must NOT pick up LLM vars
      expect(status.configured).toBe(true);
      expect(status.model).toBe('Xenova/multilingual-e5-small');
    });

    it('treats "mock" as missing for env fallback', async () => {
      const { svc } = makeService({
        EMBEDDING_API_KEY: 'mock',
        EMBEDDING_BASE_URL: 'mock',
      });
      await svc.reloadFromCredential();
      expect(svc.getStatus().source).toBe('local');
      expect(svc.getStatus().model).toBe('Xenova/multilingual-e5-small');
    });

    it('does not leak remote EMBEDDING_MODEL into forced-local runtime defaults', async () => {
      const { svc, credentials } = makeService({
        EMBEDDING_API_KEY: 'sk-env',
        EMBEDDING_BASE_URL: 'https://api.openai.com/v1',
        EMBEDDING_MODEL: 'text-embedding-3-small',
        EMBEDDING_DIMENSIONS: '1536',
      });
      await credentials.clearActive();
      await svc.reloadFromCredential();

      const status = svc.getStatus();
      expect(status.source).toBe('local');
      expect(status.model).toBe('Xenova/multilingual-e5-small');
      expect(status.dimensions).toBe(384);
    });

    it('prefers explicit EMBEDDING_LOCAL_* overrides for local runtime defaults', async () => {
      const { svc, credentials } = makeService({
        EMBEDDING_API_KEY: 'sk-env',
        EMBEDDING_BASE_URL: 'https://api.openai.com/v1',
        EMBEDDING_MODEL: 'text-embedding-3-small',
        EMBEDDING_DIMENSIONS: '1536',
        EMBEDDING_LOCAL_MODEL: 'Xenova/multilingual-e5-base',
        EMBEDDING_LOCAL_DIMENSIONS: '768',
        EMBEDDING_LOCAL_BACKEND: 'cpu',
      });
      await credentials.clearActive();
      await svc.reloadFromCredential();

      const status = svc.getStatus();
      expect(status.source).toBe('local');
      expect(status.model).toBe('Xenova/multilingual-e5-base');
      expect(status.dimensions).toBe(768);
      expect(status.profileId).toBe('local-transformers-xenova-multilingual-e5-base-768-cpu');
    });
  });

  describe('readEmbeddingEnabled', () => {
    it('treats boolean false from Joi config as disabled', () => {
      const config = makeConfig({ EMBEDDING_ENABLED: false });
      expect(readEmbeddingEnabled(config)).toBe(false);
      expect(buildDefaultLocalEmbeddingConfig(config).enabled).toBe(false);
    });

    it('treats string "false" as disabled', () => {
      const config = makeConfig({ EMBEDDING_ENABLED: 'false' });
      expect(readEmbeddingEnabled(config)).toBe(false);
    });
  });

  describe('buildDefaultLocalEmbeddingConfig', () => {
    it('falls back to legacy dimensions when EMBEDDING_LOCAL_DIMENSIONS is invalid', () => {
      const config = makeConfig({
        EMBEDDING_MODEL: 'Xenova/distiluse-base-multilingual-cased-v2',
        EMBEDDING_DIMENSIONS: '512',
        EMBEDDING_LOCAL_DIMENSIONS: 'invalid',
      });

      expect(buildDefaultLocalEmbeddingConfig(config)).toMatchObject({
        model: 'Xenova/distiluse-base-multilingual-cased-v2',
        dimensions: 512,
      });
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

    it('uses local embeddings when DB credential is cleared even if env embeddings exist', async () => {
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
      expect(svc.getStatus().source).toBe('local');
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
    it('returns local default dimensions when not configured', async () => {
      const { svc } = makeService();
      await svc.reloadFromCredential();
      expect(svc.getDimensions()).toBe(384);
    });
  });

  describe('getProfileId', () => {
    it('uses model, dimensions, and backend for local profile isolation', async () => {
      const { svc } = makeService({ EMBEDDING_BACKEND: 'cpu' });
      await svc.reloadFromCredential();
      expect(svc.getProfileId()).toBe('local-transformers-xenova-multilingual-e5-small-384-cpu');
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

    it('returns local default when not configured', async () => {
      const { svc } = makeService();
      await svc.reloadFromCredential();
      expect(await svc.getModelName()).toBe('Xenova/multilingual-e5-small');
    });
  });

  describe('edge case: getProvider before onModuleInit', () => {
    it('boots the local default provider without crashing', async () => {
      const { svc } = makeService();
      // Do NOT call reloadFromCredential — embedOne should bootstrap the default provider lazily.
      const vec = await svc.embedOne('test before init');
      expect(Array.isArray(vec)).toBe(true);
    });
  });
});
