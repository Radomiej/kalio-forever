import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { createSqliteDatabase } from '../../database/sqlite-runtime';
import type { EmbeddingSpace } from '@kalio/types';
import { buildEmbeddingSpace } from './embedding-identity';
import { ProjectResourceIndexStore, type IndexedResourceChunk } from './project-resource-index.store';
import { ProjectResourceIndexStorage } from '../vfs/project-resource-index-storage';

const space: EmbeddingSpace = buildEmbeddingSpace({ provider: 'mock', providerScope: 'test', backend: '', baseUrl: 'mock', model: 'a', modelRevision: '1', dimensions: 2,
  promptVersion: '1', documentPromptVersion: '1', queryPromptVersion: '1', codeQueryPromptVersion: '1', normalizationVersion: '1' });
const roots: string[] = [];
const stores: ProjectResourceIndexStore[] = [];
function open(projectId = 'one', modelSpace = space, root?: string) {
  const dir = root ?? mkdtempSync(join(tmpdir(), 'kalio-resource-index-'));
  if (!root) roots.push(dir);
  const store = new ProjectResourceIndexStore(new ProjectResourceIndexStorage(dir), projectId, modelSpace);
  stores.push(store); return { store, dir };
}
function chunk(id: string, resourceType: IndexedResourceChunk['resourceType'] = 'code', vector = [1, 0]): IndexedResourceChunk {
  return { id, path: `${id}.ts`, resourceType, representation: 'content', content: `build ${id}`, contentHash: 'sha256', embedding: vector };
}
afterEach(() => { for (const s of stores.splice(0)) s.close(); for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true }); });
describe('project resource partitioned SQLite index', () => {
  it('validates embedding identity before asking storage to prepare a database', () => {
    const storage = { exists: vi.fn(() => false), prepare: vi.fn(() => { throw new Error('PREPARE_CALLED'); }) };
    expect(() => new ProjectResourceIndexStore(storage, 'one', { ...space, model: 'tampered' })).toThrow('INVALID_EMBEDDING_SPACE');
    expect(storage.prepare).not.toHaveBeenCalled();
    expect(() => new ProjectResourceIndexStore(storage, 'one', space)).toThrow('PREPARE_CALLED');
    expect(storage.prepare).toHaveBeenCalledWith('one', space.id);
  });
  it('marks legacy chunking stale without deleting its previously published rows', () => {
    const { store, dir } = open(); store.replace([chunk('retained')], 1);
    expect(store.hasCurrentChunking()).toBe(true);
    const hash = (text: string) => createHash('sha256').update(text).digest('hex');
    const legacy = createSqliteDatabase(join(dir, 'project-resources', hash('one'), `${hash(space.id)}.db`)).client;
    try { legacy.exec("UPDATE resource_manifest SET chunking_version='' WHERE id=1"); } finally { legacy.close(); }
    expect(store.hasCurrentChunking()).toBe(false);
    expect(store.search('retained', undefined, ['code'], 5, 'fts')).toHaveLength(1);
    store.replace([chunk('new')], 2);
    expect(store.hasCurrentChunking()).toBe(true);
  });
  it('separates equal-dimensional models, projects and resource types before top-k', () => {
    const { store, dir } = open(); store.replace([chunk('code'), chunk('photo', 'image', [0, 1])], 123);
    const otherProject = open('two', space, dir).store;
    const otherModel = open('one', buildEmbeddingSpace({ ...space, baseUrl: 'mock', model: 'b' }), dir).store;
    expect(store.search('build', [1, 0], ['image'], 1, 'hybrid').map(r => r.path)).toEqual(['photo.ts']);
    expect(otherProject.search('build', [1, 0], ['code'], 5, 'hybrid')).toEqual([]);
    expect(otherModel.search('build', [1, 0], ['code'], 5, 'hybrid')).toEqual([]);
  });
  it('publishes a replacement atomically and removes stale chunks', () => {
    const { store } = open(); store.replace([chunk('old')], 1);
    expect(() => store.replace([chunk('new'), chunk('bad', 'code', [NaN, 1])], 2)).toThrow();
    expect(store.search('build', [1, 0], ['code'], 5, 'fts').map(r => r.id)).toEqual(['old']);
    store.replace([chunk('new')], 3);
    expect(store.search('build', [1, 0], ['code'], 5, 'fts').map(r => r.id)).toEqual(['new']);
    expect(store.status()).toMatchObject({ indexedChunks: 1, indexedAt: 3 });
  });
  it('retains durable results after reopening and rejects manifest mismatch', () => {
    const { store, dir } = open(); store.replace([chunk('persist')], 10); store.close(); stores.splice(stores.indexOf(store), 1);
    expect(open('one', space, dir).store.search('persist', [1, 0], ['code'], 5, 'fts')[0]?.spaceId).toBe(space.id);
    expect(() => open('one', { ...space, model: 'different' }, dir)).toThrow('INVALID_EMBEDDING_SPACE');
  });
  it('labels binary metadata and refuses invalid dimensions, kinds, limits and duplicate ids', () => {
    const { store } = open(); store.replace([{ ...chunk('photo', 'image'), representation: 'metadata' }], 1);
    expect(store.search('photo', [1, 0], ['image'], 5, 'hybrid')[0]?.representation).toBe('metadata');
    expect(() => store.search('photo', [1], ['image'], 5, 'vector')).toThrow();
    expect(() => store.search('photo', [1, 0], ['image'], 0, 'fts')).toThrow();
    expect(() => store.replace([chunk('same'), chunk('same')], 2)).toThrow();
    expect(() => store.replace([{ ...chunk('x'), resourceType: 'malicious' as 'text' }], 2)).toThrow();
  });
  it('caps accumulated project/space databases without deleting previous indexes', () => {
    const { dir, store } = open(); store.replace([chunk('retained')], 1);
    for (let i = 1; i < 16; i++) open(`project-${i}`, space, dir);
    expect(() => open('overflow', space, dir)).toThrow('PROJECT_RESOURCE_STORAGE_LIMIT');
    expect(store.search('retained', undefined, ['code'], 5, 'fts')).toHaveLength(1);
  });
});
