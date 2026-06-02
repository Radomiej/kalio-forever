import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConfigService } from '@nestjs/config';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as schema from '../../database/schema';
import { DrizzleService } from '../../database/drizzle.service';
import { AppSettingsService } from '../../database/app-settings.service';
import { EmbeddingCredentialsService } from './embedding-credentials.service';
import { EmbeddingService } from './embedding.service';
import { MemoryService } from './memory.service';
import { VectorStoreService } from './vector-store.service';

afterEach(() => {
  vi.restoreAllMocks();
});

function makeMemoryService() {
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
  const memoryPath = fs.mkdtempSync(path.join(os.tmpdir(), 'kalio-memory-test-'));
  const config = { get: (key: string, def = '') => ({ MEMORY_DB_PATH: memoryPath }[key] ?? def) } as unknown as ConfigService;

  const embedBatch = vi.fn(async (texts: string[]) => texts.map((text) => Array<number>(384).fill(text.length)));
  const embedOne = vi.fn(async (text: string) => Array<number>(384).fill(text.length));
  const embeddingService = {
    getDimensions: () => 384,
    getStatus: vi.fn(() => ({ configured: true })),
    getProfileId: vi.fn(() => 'local-transformers-xenova-multilingual-e5-small-384-auto'),
    getModelName: vi.fn(async () => 'Xenova/multilingual-e5-small'),
    embedBatch,
    embedOne,
  } as unknown as EmbeddingService;

  const memoryService = new MemoryService(config, appSettings, embeddingService);
  return { memoryService, embeddingService, embedBatch, memoryPath };
}

describe('MemoryService reembedPersona', () => {
  it('re-embeds stored chunks with the current model', async () => {
    const { memoryService, embeddingService, embedBatch } = makeMemoryService();

    await memoryService.ingest('First chunk. Second chunk.', 'persona-a');
    const before = memoryService.getAll('persona-a');

    const result = await memoryService.reembedPersona('persona-a');
    const after = memoryService.getAll('persona-a');

    expect(result.count).toBe(before.length);
    expect(result.model).toBe('Xenova/multilingual-e5-small');
    expect(embedBatch).toHaveBeenCalledTimes(2);
    expect(embedBatch.mock.calls[1]?.[0]).toEqual(before.map((entry) => entry.content));
    expect(after).toHaveLength(before.length);
  });

  it('returns zero count when persona has no memories', async () => {
    const { memoryService } = makeMemoryService();
    const result = await memoryService.reembedPersona('empty-persona');

    expect(result.count).toBe(0);
  });

  it('keeps memories isolated per active embedding profile', async () => {
    const { memoryService, embeddingService } = makeMemoryService();
    const getProfileId = vi.mocked(embeddingService.getProfileId);

    await memoryService.ingest('First model memory.', 'persona-profile');
    expect(memoryService.getAll('persona-profile')).toHaveLength(1);

    getProfileId.mockReturnValue('local-transformers-xenova-multilingual-e5-small-384-cpu');
    expect(memoryService.getAll('persona-profile')).toHaveLength(0);

    await memoryService.ingest('Second model memory.', 'persona-profile');
    expect(memoryService.getAll('persona-profile')).toHaveLength(1);

    getProfileId.mockReturnValue('local-transformers-xenova-multilingual-e5-small-384-auto');
    expect(memoryService.getAll('persona-profile')).toHaveLength(1);
  });

  it('rebuilds the active profile from memories stored in previous profiles', async () => {
    const { memoryService, embeddingService } = makeMemoryService();
    const getProfileId = vi.mocked(embeddingService.getProfileId);

    await memoryService.ingest('Old profile memory.', 'persona-profile');
    getProfileId.mockReturnValue('local-transformers-xenova-multilingual-e5-small-384-cpu');

    const result = await memoryService.reembedPersona('persona-profile');

    expect(result.count).toBe(1);
    expect(memoryService.getAll('persona-profile')).toHaveLength(1);
  });

  it('rebuilds the active profile from legacy persona databases', async () => {
    const { memoryService, memoryPath, embedBatch } = makeMemoryService();
    const legacyStore = new VectorStoreService(path.join(memoryPath, 'legacy-persona.db'), 384);
    legacyStore.insert('legacy-1', Array<number>(384).fill(1), 'Legacy memory.', { source: 'legacy' }, 'legacy-model');
    legacyStore.close();

    const result = await memoryService.reembedPersona('legacy-persona');

    expect(result.count).toBe(1);
    expect(embedBatch).toHaveBeenCalledWith(['Legacy memory.']);
    expect(memoryService.getAll('legacy-persona')).toHaveLength(1);
  });

  it('rebuilds all indexed personas into the active profile', async () => {
    const { memoryService, embeddingService } = makeMemoryService();
    const getProfileId = vi.mocked(embeddingService.getProfileId);

    await memoryService.ingest('Persona A memory.', 'persona-a');
    await memoryService.ingest('Persona B memory.', 'persona-b');
    getProfileId.mockReturnValue('local-transformers-xenova-multilingual-e5-small-384-cpu');

    const result = await memoryService.reembedAll();

    expect(result.personas).toBe(2);
    expect(result.count).toBe(2);
    expect(memoryService.getAll('persona-a')).toHaveLength(1);
    expect(memoryService.getAll('persona-b')).toHaveLength(1);
  });

  it('includes legacy persona databases when listing indexed personas for reindex all', async () => {
    const { memoryService, memoryPath } = makeMemoryService();
    const legacyStore = new VectorStoreService(path.join(memoryPath, 'legacy-all.db'), 384);
    legacyStore.insert('legacy-all-1', Array<number>(384).fill(1), 'Legacy all memory.', {}, 'legacy-model');
    legacyStore.close();

    const result = await memoryService.reembedAll();

    expect(result.personas).toBe(1);
    expect(result.count).toBe(1);
    expect(memoryService.getAll('legacy-all')).toHaveLength(1);
  });

  it('uses vector and FTS/BM25 when searching persona memory through hybrid search', async () => {
    const { memoryService } = makeMemoryService();
    const searchVector = vi.spyOn(VectorStoreService.prototype, 'search');
    const searchFts = vi.spyOn(VectorStoreService.prototype, 'searchFTS');

    await memoryService.ingest('Persona memory mentions boron carbide.', 'persona-a');
    await memoryService.hybridSearch('boron carbide', 'persona-a');

    expect(searchVector).toHaveBeenCalledWith(expect.any(Array), expect.any(Number));
    expect(searchFts).toHaveBeenCalledWith('boron carbide', expect.any(Number));
  });

  it('stores web search results in a dedicated web-results.db for the active profile', async () => {
    const { memoryService, memoryPath } = makeMemoryService();

    await memoryService.ingestWebSearchResult('Search answer about local embeddings.', {
      source: 'web_search',
      query: 'local embeddings',
    });

    const results = await memoryService.searchWebResults('local embeddings');

    expect(results).toHaveLength(1);
    expect(results[0]?.metadata).toMatchObject({ source: 'web_search', namespace: 'web_search' });
    expect(fs.existsSync(path.join(
      memoryPath,
      'local-transformers-xenova-multilingual-e5-small-384-auto',
      'web-results.db',
    ))).toBe(true);
  });

  it('uses vector and FTS/BM25 when searching the dedicated web-results index', async () => {
    const { memoryService } = makeMemoryService();
    const searchVector = vi.spyOn(VectorStoreService.prototype, 'search');
    const searchFts = vi.spyOn(VectorStoreService.prototype, 'searchFTS');

    await memoryService.ingestWebSearchResult('Web result mentions tungsten carbide.', {
      source: 'web_search',
      query: 'tungsten carbide',
    });
    await memoryService.searchWebResults('tungsten carbide');

    expect(searchVector).toHaveBeenCalledWith(expect.any(Array), expect.any(Number));
    expect(searchFts).toHaveBeenCalledWith('tungsten carbide', expect.any(Number));
  });

  it('rebuilds web search results into the active profile dedicated DB', async () => {
    const { memoryService, embeddingService, memoryPath } = makeMemoryService();
    const getProfileId = vi.mocked(embeddingService.getProfileId);

    await memoryService.ingestWebSearchResult('Old web result memory.', {
      source: 'web_search',
      query: 'old web result',
    });
    getProfileId.mockReturnValue('local-transformers-xenova-multilingual-e5-small-384-cpu');

    const result = await memoryService.reembedAll();
    const results = await memoryService.searchWebResults('old web result');

    expect(result.count).toBe(1);
    expect(results).toHaveLength(1);
    expect(fs.existsSync(path.join(
      memoryPath,
      'local-transformers-xenova-multilingual-e5-small-384-cpu',
      'web-results.db',
    ))).toBe(true);
  });

  it('does not ingest or search vectors when embeddings are disabled', async () => {
    const { memoryService, embeddingService } = makeMemoryService();
    vi.mocked(embeddingService.getStatus).mockReturnValue({ configured: false } as ReturnType<EmbeddingService['getStatus']>);

    await expect(memoryService.ingest('Disabled memory.', 'persona-disabled')).resolves.toEqual({ ids: [], count: 0 });
    await expect(memoryService.ingestWebSearchResult('Disabled web result.')).resolves.toEqual({ ids: [], count: 0 });
    await expect(memoryService.search('anything', 'persona-disabled')).resolves.toEqual([]);
    await expect(memoryService.hybridSearch('anything', 'persona-disabled')).resolves.toEqual([]);
    await expect(memoryService.searchWebResults('anything')).resolves.toEqual([]);
  });

  it('deletes memories from all profile databases and legacy database for a persona', async () => {
    const { memoryService, embeddingService, memoryPath } = makeMemoryService();
    const getProfileId = vi.mocked(embeddingService.getProfileId);

    await memoryService.ingest('Auto profile memory.', 'persona-delete');
    getProfileId.mockReturnValue('local-transformers-xenova-multilingual-e5-small-384-cpu');
    await memoryService.ingest('CPU profile memory.', 'persona-delete');

    const legacyStore = new VectorStoreService(path.join(memoryPath, 'persona-delete.db'), 384);
    legacyStore.insert('legacy-delete-1', Array<number>(384).fill(1), 'Legacy delete memory.', {}, 'legacy-model');
    legacyStore.close();

    memoryService.deleteAll('persona-delete');

    expect(memoryService.getAll('persona-delete')).toHaveLength(0);
    getProfileId.mockReturnValue('local-transformers-xenova-multilingual-e5-small-384-auto');
    expect(memoryService.getAll('persona-delete')).toHaveLength(0);

    const legacyCheck = new VectorStoreService(path.join(memoryPath, 'persona-delete.db'), 384);
    expect(legacyCheck.count()).toBe(0);
    legacyCheck.close();
  });
});
