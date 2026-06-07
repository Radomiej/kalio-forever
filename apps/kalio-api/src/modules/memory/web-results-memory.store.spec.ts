import { beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import { WebResultsMemoryStore } from './web-results-memory.store';

describe('WebResultsMemoryStore', () => {
  const profileId = 'local-transformers-test-profile';
  const dbBasePath = 'C:\\tmp\\kalio-memory-test';

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(fs, 'existsSync').mockImplementation((targetPath) => {
      const normalized = String(targetPath).replace(/\//g, '\\');
      return normalized.endsWith('web-results.db')
        || normalized.endsWith('web-results.db-wal')
        || normalized.endsWith('web-results.db-shm');
    });
    vi.spyOn(fs, 'rmSync').mockImplementation(() => undefined);
  });

  it('ingests structured web-search chunks with stable ids and v2 metadata', async () => {
    const insert = vi.fn();
    const embedBatch = vi.fn().mockResolvedValue([[0.1, 0.2], [0.3, 0.4]]);
    const store = new WebResultsMemoryStore(dbBasePath, {
      getStatus: () => ({ configured: true }),
      getModelName: () => Promise.resolve('local-minilm'),
      embedBatch,
      getProfileId: () => profileId,
    } as never);
    const storeState = store as unknown as { getStore: () => { insert: typeof insert } };

    vi.spyOn(storeState, 'getStore').mockReturnValue({ insert } as never);

    const result = await store.ingest([
      {
        content: 'Alpha paragraph',
        citationUrls: ['https://example.com/alpha'],
        blockType: 'paragraph',
        headingPath: ['Release Notes'],
        webResultId: 'web-1',
        blockIndex: 0,
        query: 'TypeScript latest',
        provider: 'perplexity',
        model: 'sonar',
      },
      {
        content: 'Beta quote',
        citationUrls: ['https://example.com/beta'],
        blockType: 'quote',
        headingPath: ['Release Notes', 'Quotes'],
        webResultId: 'web-1',
        blockIndex: 1,
        query: 'TypeScript latest',
        provider: 'perplexity',
        model: 'sonar',
      },
    ]);

    expect(embedBatch).toHaveBeenCalledWith(['Alpha paragraph', 'Beta quote']);
    expect(insert).toHaveBeenNthCalledWith(
      1,
      'web-1:0',
      [0.1, 0.2],
      'Alpha paragraph',
      expect.objectContaining({
        namespace: 'web_search',
        chunk_version: 'v2',
        web_result_id: 'web-1',
        block_type: 'paragraph',
        block_index: '0',
        citation_urls_json: JSON.stringify(['https://example.com/alpha']),
        heading_path_json: JSON.stringify(['Release Notes']),
        query: 'TypeScript latest',
        provider: 'perplexity',
        model: 'sonar',
      }),
      'local-minilm',
    );
    expect(insert).toHaveBeenNthCalledWith(
      2,
      'web-1:1',
      [0.3, 0.4],
      'Beta quote',
      expect.objectContaining({
        block_type: 'quote',
        block_index: '1',
        heading_path_json: JSON.stringify(['Release Notes', 'Quotes']),
      }),
      'local-minilm',
    );
    expect(result).toEqual({ ids: ['web-1:0', 'web-1:1'], count: 2 });
  });

  it('skips embedding work when there are no chunks to ingest', async () => {
    const embedBatch = vi.fn();
    const store = new WebResultsMemoryStore(dbBasePath, {
      getStatus: () => ({ configured: true }),
      getModelName: () => Promise.resolve('local-minilm'),
      embedBatch,
      getProfileId: () => profileId,
    } as never);

    await expect(store.ingest([])).resolves.toEqual({ ids: [], count: 0 });
    expect(embedBatch).not.toHaveBeenCalled();
  });

  it('retries deletion when Windows keeps the DB file locked briefly after close', () => {
    const close = vi.fn();
    const store = new WebResultsMemoryStore(dbBasePath, {
      getProfileId: () => profileId,
    } as never);
    const storeState = store as unknown as { stores: Map<string, { close: () => void }> };
    const rmSyncSpy = vi.mocked(fs.rmSync);
    const existsSyncSpy = vi.mocked(fs.existsSync);

    storeState.stores.set(profileId, { close });

    const eperm = Object.assign(new Error('file is busy'), { code: 'EPERM' });
    rmSyncSpy
      .mockImplementationOnce(() => { throw eperm; })
      .mockImplementation(() => undefined);

    const dbPath = store.deleteCurrentDbFile();

    expect(close).toHaveBeenCalledTimes(1);
    expect(dbPath).toBe(`${dbBasePath}\\${profileId}\\web-results.db`);
    expect(rmSyncSpy).toHaveBeenCalledWith(`${dbPath}`, { force: true });
    expect(rmSyncSpy).toHaveBeenCalledWith(`${dbPath}-wal`, { force: true });
    expect(rmSyncSpy).toHaveBeenCalledWith(`${dbPath}-shm`, { force: true });
    expect(rmSyncSpy).toHaveBeenCalledTimes(4);
    expect(existsSyncSpy).toHaveBeenCalled();
  });
});
