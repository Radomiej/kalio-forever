import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import Database from 'better-sqlite3';
import type { EmbeddingSpace, ProjectResourceReaderPort, ProjectResourceSnapshot } from '@kalio/types';
import { ProjectResourceIndexService } from './project-resource-index.service';
import type { EmbeddingService } from './embedding.service';
import { buildEmbeddingSpace } from './embedding-identity';
import type { ProjectContextSettingsService } from './project-context-settings.service';
import type { DrizzleService } from '../../database/drizzle.service';
import { ProjectResourceIndexStore } from './project-resource-index.store';
import { ProjectResourceIndexStorage } from '../vfs/project-resource-index-storage';

const roots: string[] = [];
const space: EmbeddingSpace = buildEmbeddingSpace({ provider: 'mock', providerScope: 'test', backend: '', baseUrl: 'mock', model: 'a', modelRevision: '1', dimensions: 2,
  promptVersion: '1', documentPromptVersion: '1', queryPromptVersion: '1', codeQueryPromptVersion: '1', normalizationVersion: '1' });
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'kalio-resource-service-')); roots.push(root);
  let snapshot: ProjectResourceSnapshot = { projectId: 'project', complete: true, skipped: [], files: [
    { path: 'src/api.ts', sizeBytes: 30, content: Buffer.from('export function approveBuild() {}') },
    { path: 'assets/logo.png', sizeBytes: 4, content: new Uint8Array([137, 80, 78, 71]) },
  ] };
  const embeddings = { ensureCurrentIdentity: vi.fn(async () => undefined), captureSpace: () => space, getStatus: () => ({ configured: true, provider: 'mock' }),
    getDocumentSizer: vi.fn(async (_space: EmbeddingSpace): Promise<((text: string) => boolean) | undefined> => undefined),
    embedPinned: vi.fn(async (_space: EmbeddingSpace, texts: string[], _purpose?: string) => texts.map(() => [1, 0])) };
  const reader = { readProject: vi.fn(async () => snapshot) } satisfies ProjectResourceReaderPort;
  let enabled = true;
  const settings = { assertEnabled: async () => { if (!enabled) throw new Error('PROJECT_CONTEXT_DISABLED'); } };
  let projectId: string | undefined = 'project';
  const drizzle = { db: { select: () => ({ from: () => ({ where: () => ({ get: () => projectId === undefined ? undefined : { projectId } }) }) }) } };
  return { root, embeddings, reader, setSessionProject: (value: string | undefined) => { projectId = value; }, setEnabled: (value: boolean) => { enabled = value; }, setSnapshot: (s: ProjectResourceSnapshot) => { snapshot = s; },
    service: new ProjectResourceIndexService(new ProjectResourceIndexStorage(root), embeddings as unknown as EmbeddingService, reader,
      settings as ProjectContextSettingsService, drizzle as unknown as DrizzleService) };
}
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
describe('project indexing workflow', () => {
  it('rejects oversized asset metadata before inference and leaves its representation unchanged', async () => {
    const f = fixture();
    const path = `${'asset'.repeat(100)}.png`;
    f.setSnapshot({ projectId: 'project', complete: true, skipped: [], files: [{ path, sizeBytes: 1, content: new Uint8Array([137]) }] });
    f.embeddings.getDocumentSizer.mockResolvedValue(text => text.length <= 160);
    await expect(f.service.index('project', {})).rejects.toThrow('PROJECT_RESOURCE_TOKEN_LIMIT');
    expect(f.embeddings.embedPinned).not.toHaveBeenCalled();
    expect((await f.service.status('project')).indexedChunks).toBe(0);
  });
  it('requires an actual sizer for local-transformers rather than using legacy character limits', async () => {
    const f = fixture(); f.embeddings.captureSpace = () => buildEmbeddingSpace({ provider: 'local-transformers', providerScope: 'test', backend: 'cpu', baseUrl: 'local-cache:test',
      model: 'Xenova/multilingual-e5-small', modelRevision: '1', dimensions: 2, promptVersion: '1', documentPromptVersion: '1',
      queryPromptVersion: '1', codeQueryPromptVersion: '1', normalizationVersion: '1' });
    await expect(f.service.index('project', {})).rejects.toThrow('PROJECT_RESOURCE_TOKEN_LIMIT');
    expect(f.embeddings.embedPinned).not.toHaveBeenCalled();
  });
  it.each(['before-query', 'after-query'] as const)('rejects manual historical marker mutation %s even with unchanged generation', async stage => {
    const f = fixture(); await f.service.index('project', {}); const original = await f.reader.readProject();
    const markHistorical = () => {
      const hash = (value: string) => createHash('sha256').update(value).digest('hex');
      const db = new Database(join(f.root, 'project-resources', hash('project'), `${hash(space.id)}.db`));
      try { db.prepare("UPDATE resource_manifest SET chunking_version='' WHERE id=1").run(); }
      finally { db.close(); }
    };
    let reads = 0;
    f.reader.readProject.mockImplementation(async () => {
      if (stage === 'before-query' && ++reads === 2) markHistorical();
      return original;
    });
    f.embeddings.embedPinned.mockClear();
    f.embeddings.embedPinned.mockImplementation(async (_space, texts, purpose) => {
      if (stage === 'after-query' && purpose === 'query') markHistorical();
      return texts.map(() => [1, 0]);
    });
    await expect(f.service.search('project', { query: 'approveBuild' })).rejects.toThrow('PROJECT_RESOURCE_REINDEX_REQUIRED');
    expect(f.embeddings.embedPinned.mock.calls.filter(call => call[2] === 'query')).toHaveLength(stage === 'before-query' ? 0 : 1);
  });
  it.each(['vector', 'hybrid', 'fts'] as const)('refreshes a historical chunking version with unchanged source hashes before %s search', async mode => {
    const f = fixture(); await f.service.index('project', {});
    const hash = (value: string) => createHash('sha256').update(value).digest('hex');
    const db = new Database(join(f.root, 'project-resources', hash('project'), `${hash(space.id)}.db`));
    try { db.prepare("UPDATE resource_manifest SET chunking_version='' WHERE id=1").run(); }
    finally { db.close(); }
    const before = new ProjectResourceIndexStore(new ProjectResourceIndexStorage(f.root), 'project', space);
    let refs: ReturnType<ProjectResourceIndexStore['sourceReferences']>;
    try { expect(before.hasCurrentChunking()).toBe(false); refs = before.sourceReferences(); }
    finally { before.close(); }
    f.embeddings.embedPinned.mockClear();
    expect(await f.service.search('project', { query: 'approveBuild', mode, resourceTypes: ['code'] })).toHaveLength(1);
    expect(f.embeddings.embedPinned.mock.calls.filter(call => call[2] === 'document')).toHaveLength(1);
    const after = new ProjectResourceIndexStore(new ProjectResourceIndexStorage(f.root), 'project', space);
    try { expect(after.hasCurrentChunking()).toBe(true); expect(after.sourceReferences()).toEqual(refs); }
    finally { after.close(); }
    f.embeddings.embedPinned.mockClear();
    await f.service.search('project', { query: 'approveBuild', mode });
    expect(f.embeddings.embedPinned.mock.calls.filter(call => call[2] === 'document')).toHaveLength(0);
  });
  it('gets the document sizer once and embeds only full source chunks accepted by its finite budget', async () => {
    const f = fixture();
    const source = `const text = '${'🐈zażółć'.repeat(150)}';\r\n// TOKEN_TAIL`;
    f.setSnapshot({ projectId: 'project', complete: true, skipped: [], files: [
      { path: 'budget.ts', content: Buffer.from(source), sizeBytes: Buffer.byteLength(source) },
    ] });
    const fits = (text: string) => Buffer.byteLength(`passage: ${text}`, 'utf8') <= 180;
    f.embeddings.getDocumentSizer.mockResolvedValue(fits);
    await f.service.index('project', {});
    expect(f.embeddings.getDocumentSizer).toHaveBeenCalledExactlyOnceWith(space);
    const documents = f.embeddings.embedPinned.mock.calls.flatMap(call => call[1]);
    expect(documents.length).toBeGreaterThan(1);
    expect(documents.every(fits)).toBe(true);
    const results = await f.service.search('project', { query: 'TOKEN_TAIL', mode: 'fts' });
    expect(results.some(result => result.content.endsWith('// TOKEN_TAIL'))).toBe(true);
    expect(f.embeddings.getDocumentSizer).toHaveBeenCalledTimes(1);
  });
  it('fails token preparation safely without replacing a previous index or inferring documents', async () => {
    const f = fixture(); await f.service.index('project', {});
    f.embeddings.embedPinned.mockClear();
    f.embeddings.getDocumentSizer.mockResolvedValue(() => false);
    await expect(f.service.index('project', {})).rejects.toThrow('PROJECT_RESOURCE_TOKEN_LIMIT');
    expect(f.embeddings.embedPinned).not.toHaveBeenCalled();
    expect((await f.service.status('project')).indexedChunks).toBe(2);
  });
  it.each(['vector', 'hybrid', 'fts'] as const)('autoindexes the first %s search and does not reembed unchanged documents', async mode => {
    const f = fixture();
    expect(await f.service.search('project', { query: 'approveBuild', mode, resourceTypes: ['code'] })).toHaveLength(1);
    const documents = () => f.embeddings.embedPinned.mock.calls.filter(call => call[2] === 'document').length;
    expect(documents()).toBe(1);
    await f.service.search('project', { query: 'approveBuild', mode });
    expect(documents()).toBe(1);
  });
  it('finds added files, refreshes changed files, and removes deleted content', async () => {
    const f = fixture(); await f.service.index('project', {});
    const original = await f.reader.readProject();
    const file = (path: string, content: string) => ({ path, content: Buffer.from(content), sizeBytes: Buffer.byteLength(content) });
    f.setSnapshot({ projectId: 'project', complete: true, skipped: [], files: [
      ...original.files, file('new.mts', 'export const addedToken = 1;'),
    ] });
    expect((await f.service.search('project', { query: 'addedToken', mode: 'fts' }))[0]?.path).toBe('new.mts');
    f.setSnapshot({ projectId: 'project', complete: true, skipped: [], files: [file('new.mts', 'export const changedToken = 2;')] });
    expect(await f.service.search('project', { query: 'approveBuild', mode: 'fts' })).toEqual([]);
    expect(await f.service.search('project', { query: 'addedToken', mode: 'fts' })).toEqual([]);
    expect(await f.service.search('project', { query: 'changedToken', mode: 'fts' })).toHaveLength(1);
  });
  it('does not refresh for added empty, unsupported or invalid UTF-8 resources', async () => {
    const f = fixture(); await f.service.index('project', {});
    const original = await f.reader.readProject();
    f.setSnapshot({ ...original, files: [...original.files,
      { path: 'empty.ts', content: Buffer.from(' \n'), sizeBytes: 2 },
      { path: 'unknown.bin', content: Buffer.from('x'), sizeBytes: 1 },
      { path: 'invalid.ts', content: new Uint8Array([255]), sizeBytes: 1 },
    ] });
    f.embeddings.embedPinned.mockClear();
    expect(await f.service.search('project', { query: 'approveBuild', mode: 'fts' })).toHaveLength(1);
    expect(f.embeddings.embedPinned).not.toHaveBeenCalled();
  });
  it('keeps an empty published snapshot fresh without repeated indexing', async () => {
    const f = fixture(); f.setSnapshot({ projectId: 'project', complete: true, files: [], skipped: [] });
    const replace = vi.spyOn(ProjectResourceIndexStore.prototype, 'replace');
    expect(await f.service.search('project', { query: 'anything', mode: 'fts' })).toEqual([]);
    const status = await f.service.status('project');
    expect(status.indexedAt).not.toBeNull();
    expect(await f.service.search('project', { query: 'anything', mode: 'fts' })).toEqual([]);
    expect(await f.service.status('project')).toEqual(status);
    expect(f.embeddings.embedPinned).not.toHaveBeenCalled();
    expect(replace).toHaveBeenCalledTimes(1); replace.mockRestore();
  });
  it('requires own remote consent for missing and stale FTS autoindex, but not fresh FTS', async () => {
    const f = fixture(); f.embeddings.getStatus = () => ({ configured: true, provider: 'openai-compatible' });
    await expect(f.service.search('project', { query: 'approveBuild', mode: 'fts' })).rejects.toThrow('REMOTE_EMBEDDING_CONSENT_REQUIRED');
    expect(f.embeddings.embedPinned).not.toHaveBeenCalled();
    await f.service.index('project', { allowRemoteProcessing: true });
    f.embeddings.embedPinned.mockClear();
    expect(await f.service.search('project', { query: 'approveBuild', mode: 'fts' })).toHaveLength(1);
    f.setSnapshot({ projectId: 'project', complete: true, files: [], skipped: [] });
    await expect(f.service.search('project', { query: 'approveBuild', mode: 'fts' })).rejects.toThrow('REMOTE_EMBEDDING_CONSENT_REQUIRED');
    expect(f.embeddings.embedPinned).not.toHaveBeenCalled();
    expect((await f.service.status('project')).indexedChunks).toBe(2);
  });
  it('rejects duplicate snapshot paths rather than silently overwriting references', async () => {
    const f = fixture(); const original = await f.reader.readProject();
    f.setSnapshot({ ...original, files: [original.files[0]!, original.files[0]!] });
    await expect(f.service.search('project', { query: 'approveBuild', mode: 'fts' })).rejects.toThrow('PROJECT_RESOURCE_SCOPE_MISMATCH');
    expect(f.embeddings.embedPinned).not.toHaveBeenCalled();
  });
  it('coalesces autoindex while every remote FTS caller supplies its own consent', async () => {
    const f = fixture(); f.embeddings.getStatus = () => ({ configured: true, provider: 'openai-compatible' });
    let release!: () => void; let entered!: () => void;
    const blocked = new Promise<void>(resolve => { release = resolve; });
    const started = new Promise<void>(resolve => { entered = resolve; });
    f.embeddings.embedPinned.mockImplementation(async (_space, texts) => { entered(); await blocked; return texts.map(() => [1, 0]); });
    const first = f.service.search('project', { query: 'approveBuild', mode: 'fts', allowRemoteProcessing: true });
    await started;
    await expect(f.service.search('project', { query: 'approveBuild', mode: 'fts' })).rejects.toThrow('REMOTE_EMBEDDING_CONSENT_REQUIRED');
    const second = f.service.search('project', { query: 'approveBuild', mode: 'fts', allowRemoteProcessing: true });
    await expect(f.service.index('project', { allowRemoteProcessing: true })).rejects.toThrow('PROJECT_RESOURCE_INDEX_BUSY');
    release();
    expect(await first).toHaveLength(1); expect(await second).toHaveLength(1);
    expect(f.embeddings.embedPinned).toHaveBeenCalledTimes(1);
  });
  it('rereads a waiting caller snapshot after joining refresh and searches the current index', async () => {
    const f = fixture(); const old = await f.reader.readProject();
    const current = { ...old, files: [{ path: 'current.ts', content: Buffer.from('currentSnapshotToken'), sizeBytes: 20 }] };
    f.setSnapshot(current); f.reader.readProject.mockClear();
    let release!: () => void; let entered!: () => void;
    const blocked = new Promise<void>(resolve => { release = resolve; });
    const started = new Promise<void>(resolve => { entered = resolve; });
    f.embeddings.embedPinned.mockImplementation(async (_space, texts) => { entered(); await blocked; return texts.map(() => [1, 0]); });
    const first = f.service.search('project', { query: 'currentSnapshotToken', mode: 'fts' });
    await started;
    // The second caller acquired an older source snapshot before joining this refresh.
    f.reader.readProject.mockResolvedValueOnce(old);
    const second = f.service.search('project', { query: 'currentSnapshotToken', mode: 'fts' });
    const settled = Promise.allSettled([first, second]);
    try { await vi.waitFor(() => expect(f.reader.readProject).toHaveBeenCalledTimes(2)); }
    finally { release(); }
    for (const result of await settled) {
      expect(result.status).toBe('fulfilled');
      if (result.status === 'fulfilled') {
        expect(result.value).toHaveLength(1);
        expect(result.value[0]).toMatchObject({ path: 'current.ts', content: 'File: "current.ts"; lines 1-1\nSource:\ncurrentSnapshotToken' });
      }
    }
    expect(f.embeddings.embedPinned).toHaveBeenCalledTimes(1);
  });
  it.each(['disable', 'model'] as const)('rejects both waiting callers after %s changes', async change => {
    const f = fixture(); let release!: () => void; let entered!: () => void;
    const blocked = new Promise<void>(resolve => { release = resolve; });
    const started = new Promise<void>(resolve => { entered = resolve; });
    f.embeddings.embedPinned.mockImplementation(async (_space, texts) => { entered(); await blocked; return texts.map(() => [1, 0]); });
    const first = f.service.search('project', { query: 'approveBuild', mode: 'fts' });
    await started;
    const second = f.service.search('project', { query: 'approveBuild', mode: 'fts' });
    await vi.waitFor(() => expect(f.reader.readProject).toHaveBeenCalledTimes(2));
    if (change === 'disable') f.setEnabled(false);
    else f.embeddings.captureSpace = () => ({ ...space, id: 'changed' });
    const results = Promise.allSettled([first, second]); release();
    for (const result of await results) {
      expect(result.status).toBe('rejected');
      if (result.status === 'rejected') expect(result.reason).toMatchObject({
        message: change === 'disable' ? 'PROJECT_CONTEXT_DISABLED' : 'EMBEDDING_SPACE_CHANGED',
      });
    }
    expect(f.embeddings.embedPinned).toHaveBeenCalledTimes(1);
  });
  it('retries once when a file is added during query inference and returns its new content', async () => {
    const f = fixture(); await f.service.index('project', {}); const original = await f.reader.readProject();
    let queries = 0;
    f.embeddings.embedPinned.mockImplementation(async (_space, texts, purpose) => {
      if (purpose === 'query' && queries++ === 0) f.setSnapshot({ ...original, files: [...original.files,
        { path: 'added.ts', content: Buffer.from('newSearchToken'), sizeBytes: 14 },
      ] });
      return texts.map(() => [1, 0]);
    });
    const results = await f.service.search('project', { query: 'newSearchToken' });
    expect(results.some(result => result.path === 'added.ts' && result.content.includes('newSearchToken'))).toBe(true);
    expect(queries).toBe(2);
  });
  it.each(['disable', 'model'] as const)('rejects autoindex completion after %s changes', async change => {
    const f = fixture();
    f.embeddings.embedPinned.mockImplementation(async (_space, texts) => {
      if (change === 'disable') f.setEnabled(false);
      else f.embeddings.captureSpace = () => ({ ...space, id: 'changed' });
      return texts.map(() => [1, 0]);
    });
    await expect(f.service.search('project', { query: 'approveBuild', mode: 'fts' })).rejects
      .toThrow(change === 'disable' ? 'PROJECT_CONTEXT_DISABLED' : 'EMBEDDING_SPACE_CHANGED');
    expect(f.reader.readProject).toHaveBeenCalledTimes(1);
  });
  it('retries source change during search once and rejects repeated source changes', async () => {
    const f = fixture(); await f.service.index('project', {});
    const original = await f.reader.readProject();
    let changes = 0;
    f.embeddings.embedPinned.mockImplementation(async (_space, texts, purpose) => {
      if (purpose === 'query' && changes++ === 0) f.setSnapshot({ ...original, files: [] });
      return texts.map(() => [1, 0]);
    });
    expect(await f.service.search('project', { query: 'approveBuild' })).toEqual([]);
    f.setSnapshot(original); await f.service.index('project', {});
    f.embeddings.embedPinned.mockClear();
    f.embeddings.embedPinned.mockImplementation(async (_space, texts, purpose) => {
      if (purpose === 'query') f.setSnapshot({ ...original, files: [{ path: 'new.ts', sizeBytes: 1,
        content: Buffer.from(`export const change${changes++} = 1;`) }] });
      return texts.map(() => [1, 0]);
    });
    await expect(f.service.search('project', { query: 'approveBuild' })).rejects.toThrow('PROJECT_RESOURCE_REINDEX_REQUIRED');
    expect(f.embeddings.embedPinned.mock.calls.filter(call => call[2] === 'query')).toHaveLength(2);
  });
  it('failed autoindex preserves the old index when source changes during document embedding', async () => {
    const f = fixture(); await f.service.index('project', {});
    const original = await f.reader.readProject();
    f.setSnapshot({ ...original, files: [...original.files, { path: 'new.ts', content: Buffer.from('newToken'), sizeBytes: 8 }] });
    f.embeddings.embedPinned.mockImplementation(async (_space, texts) => { f.setSnapshot(original); return texts.map(() => [1, 0]); });
    await expect(f.service.search('project', { query: 'newToken', mode: 'fts' })).rejects.toThrow('PROJECT_RESOURCE_SOURCE_CHANGED');
    expect((await f.service.status('project')).indexedChunks).toBe(2);
    expect(await f.service.search('project', { query: 'approveBuild', mode: 'fts' })).toHaveLength(1);
  });
  it('returns source path and line labels through the real SQLite FTS index', async () => {
    const f = fixture(); await f.service.index('project', {});
    const results = await f.service.search('project', { query: 'approveBuild', mode: 'fts', resourceTypes: ['code'] });
    expect(results).toHaveLength(1);
    expect(results[0]?.content).toBe('File: "src/api.ts"; lines 1-1\nSource:\nexport function approveBuild() {}');
    const assets = await f.service.search('project', { query: 'logo', mode: 'fts', resourceTypes: ['image'] });
    expect(assets[0]?.content).toBe('image asset: assets/logo.png, size 4 bytes. File metadata only; binary content was not embedded.');
  });
  it.each(['mts', 'cts'])('fully indexes .%s source including its tail through SQLite FTS', async extension => {
    const f = fixture();
    const path = `src/module.${extension}`;
    const lines = ['export function moduleStart() {', ...Array.from({ length: 300 }, (_, index) => `  // coverageToken${index}`),
      "  return 'moduleTail';", '}'];
    const source = lines.join('\r\n');
    f.setSnapshot({ projectId: 'project', complete: true, skipped: [], files: [
      { path, sizeBytes: Buffer.byteLength(source), content: Buffer.from(source) },
    ] });
    expect(await f.service.index('project', {})).toMatchObject({ indexedFiles: 1, skipped: [] });
    for (const query of ['moduleStart', 'coverageToken150', 'moduleTail']) {
      const results = await f.service.search('project', { query, mode: 'fts', resourceTypes: ['code'] });
      expect(results.length).toBeGreaterThan(0);
      expect(results.every(result => result.path === path && result.content.startsWith(`File: "${path}"; lines `))).toBe(true);
    }
    const results = await f.service.search('project', { query: 'coverageToken', mode: 'fts', resourceTypes: ['code'], limit: 100 });
    // FTS token matching is exact; enumerate the persisted windows through a path term.
    const windows = await f.service.search('project', { query: 'module', mode: 'fts', resourceTypes: ['code'], limit: 100 });
    expect(results).toEqual([]);
    const covered = new Set<number>();
    for (const window of windows) {
      const label = window.content.match(/; lines (\d+)-(\d+)\n/)!;
      const body = window.content.split('Source:\n')[1]!;
      expect(body.length).toBeLessThanOrEqual(2000);
      expect(body).toBe(lines.slice(Number(label[1]) - 1, Number(label[2])).join('\r\n')
        + (Number(label[2]) < lines.length ? '\r\n' : ''));
      for (let line = Number(label[1]); line <= Number(label[2]); line++) covered.add(line);
    }
    expect(covered.size).toBe(lines.length);
  });
  it('blocks project vectors and reuse for mutable Ollama tags even when A -> B -> A metadata looks unchanged', async () => {
    const f = fixture(); await f.service.index('project', {});
    const ollama = buildEmbeddingSpace({ provider: 'ollama', providerScope: 'test', backend: '', baseUrl: 'http://localhost:11434',
      model: 'model:latest', modelRevision: 'a'.repeat(64), dimensions: 2, promptVersion: '1', documentPromptVersion: '1',
      queryPromptVersion: '1', codeQueryPromptVersion: '1', normalizationVersion: '1' });
    f.embeddings.captureSpace = () => ollama;
    f.embeddings.embedPinned.mockClear();
    await expect(f.service.index('project', {})).rejects.toThrow('EMBEDDING_IMMUTABLE_INFERENCE_REQUIRED');
    for (const mode of ['vector', 'hybrid', 'fts'] as const) {
      await expect(f.service.search('project', { query: 'approveBuild', mode })).rejects.toThrow('EMBEDDING_IMMUTABLE_INFERENCE_REQUIRED');
    }
    expect(f.embeddings.embedPinned).not.toHaveBeenCalled();
    f.embeddings.captureSpace = () => space;
    expect((await f.service.status('project')).indexedChunks).toBe(2);
  });
  it('refreshes identity for status and retains the old index across model changes', async () => {
    const f = fixture(); await f.service.index('project', {});
    const next = buildEmbeddingSpace({ provider: 'mock', providerScope: 'test', backend: '', baseUrl: 'mock', model: 'b', modelRevision: '2', dimensions: 2,
      promptVersion: '1', documentPromptVersion: '1', queryPromptVersion: '1', codeQueryPromptVersion: '1', normalizationVersion: '1' });
    f.embeddings.captureSpace = () => next;
    expect(await f.service.status('project')).toMatchObject({ space: next, indexedChunks: 0, indexedAt: null });
    expect(await f.service.search('project', { query: 'approveBuild', mode: 'fts' })).toHaveLength(1);
    f.embeddings.captureSpace = () => space;
    expect((await f.service.status('project')).indexedChunks).toBe(2);
    expect(await f.service.search('project', { query: 'approveBuild', mode: 'fts' })).toHaveLength(1);
    expect(f.embeddings.ensureCurrentIdentity).toHaveBeenCalled();
  });
  it('resolves refresh and search from the persisted session and rejects missing projects', async () => {
    const f = fixture();
    expect((await f.service.refreshForSession('session', {})).projectId).toBe('project');
    expect(await f.service.searchForSession('session', { query: 'approveBuild', mode: 'fts' })).toHaveLength(1);
    for (const project of [undefined, 'system:none', '']) {
      f.setSessionProject(project);
      await expect(f.service.refreshForSession('session', {})).rejects.toThrow('PROJECT_CONTEXT_SESSION_PROJECT_REQUIRED');
      await expect(f.service.searchForSession('session', { query: 'build' })).rejects.toThrow('PROJECT_CONTEXT_SESSION_PROJECT_REQUIRED');
    }
  });
  it('blocks disabled indexing and search before embedding', async () => {
    const f = fixture(); f.setEnabled(false);
    await expect(f.service.index('project', {})).rejects.toThrow('PROJECT_CONTEXT_DISABLED');
    await expect(f.service.search('project', { query: 'build' })).rejects.toThrow('PROJECT_CONTEXT_DISABLED');
    expect(f.embeddings.embedPinned).not.toHaveBeenCalled();
    expect(f.reader.readProject).not.toHaveBeenCalled();
  });
  it('does not publish after disable during embedding', async () => {
    const f = fixture();
    f.embeddings.embedPinned.mockImplementation(async (_space, texts) => { f.setEnabled(false); return texts.map(() => [1, 0]); });
    await expect(f.service.index('project', {})).rejects.toThrow('PROJECT_CONTEXT_DISABLED');
    expect((await f.service.status('project')).indexedChunks).toBe(0);
  });
  it('does not return search results after disable during query embedding', async () => {
    const f = fixture(); await f.service.index('project', {});
    f.embeddings.embedPinned.mockImplementation(async (_space, texts) => { f.setEnabled(false); return texts.map(() => [1, 0]); });
    await expect(f.service.search('project', { query: 'approveBuild' })).rejects.toThrow('PROJECT_CONTEXT_DISABLED');
  });
  it('indexes code contents and explicitly labels image metadata, then finds both with FTS', async () => {
    const f = fixture(); const indexed = await f.service.index('project', {});
    expect(indexed).toMatchObject({ indexedFiles: 2, indexedChunks: 2, space });
    expect((await f.service.search('project', { query: 'approveBuild', mode: 'fts', resourceTypes: ['code'] }))[0]?.path).toBe('src/api.ts');
    expect((await f.service.search('project', { query: 'logo', mode: 'fts', resourceTypes: ['image'] }))[0]?.representation).toBe('metadata');
    expect(f.embeddings.embedPinned.mock.calls.flatMap(c => c[1]).join(' ')).not.toContain('�PNG');
  });
  it('preserves previous results after failed enumeration and rejects cross-project snapshots', async () => {
    const f = fixture(); await f.service.index('project', {});
    f.setSnapshot({ projectId: 'other', complete: true, skipped: [], files: [] });
    await expect(f.service.index('project', {})).rejects.toThrow('PROJECT_RESOURCE_SCOPE_MISMATCH');
    await expect(f.service.search('project', { query: 'approveBuild', mode: 'fts' })).rejects.toThrow('PROJECT_RESOURCE_SCOPE_MISMATCH');
  });
  it('blocks remote indexing without explicit per-operation consent', async () => {
    const f = fixture(); f.embeddings.getStatus = () => ({ configured: true, provider: 'openai-compatible' });
    await expect(f.service.index('project', {})).rejects.toThrow('REMOTE_EMBEDDING_CONSENT_REQUIRED');
    expect(f.embeddings.embedPinned).not.toHaveBeenCalled();
    expect((await f.service.index('project', { allowRemoteProcessing: true })).indexedFiles).toBe(2);
  });
  it('never returns deleted or changed indexed content before reindex', async () => {
    const f = fixture(); await f.service.index('project', {});
    f.setSnapshot({ projectId: 'project', complete: true, skipped: [], files: [] });
    expect(await f.service.search('project', { query: 'approveBuild', mode: 'fts' })).toEqual([]);
  });
  it('rejects a concurrent publication even when source files and model remain equal', async () => {
    const f = fixture(); await f.service.index('project', {});
    f.embeddings.embedPinned.mockImplementation(async (_space, texts, purpose) => {
      if (purpose === 'query') await f.service.index('project', {});
      return texts.map(() => [1, 0]);
    });
    await expect(f.service.search('project', { query: 'approveBuild' })).rejects.toThrow('PROJECT_RESOURCE_INDEX_CHANGED');
  });
  it('requires explicit producer scope and model revision for durable assets', async () => {
    const f = fixture(); f.embeddings.captureSpace = () => ({ ...space, modelRevision: 'unresolved' });
    await expect(f.service.index('project', {})).rejects.toThrow('EMBEDDING_REVISION_REQUIRED');
    expect(f.embeddings.embedPinned).not.toHaveBeenCalled();
  });
  it('rejects source mutation during embedding without publishing it', async () => {
    const f = fixture();
    f.embeddings.embedPinned.mockImplementation(async (_space, texts) => {
      f.setSnapshot({ projectId: 'project', complete: true, skipped: [], files: [] });
      return texts.map(() => [1, 0]);
    });
    await expect(f.service.index('project', {})).rejects.toThrow('PROJECT_RESOURCE_SOURCE_CHANGED');
    expect((await f.service.status('project')).indexedChunks).toBe(0);
  });
  it('does not publish if model identity changes between embedding and publication', async () => {
    const f = fixture(); await f.service.index('project', {});
    f.embeddings.embedPinned.mockImplementation(async (_space, texts) => {
      f.embeddings.captureSpace = () => ({ ...space, id: 'changed' }); return texts.map(() => [1, 0]);
    });
    await expect(f.service.index('project', {})).rejects.toThrow('EMBEDDING_SPACE_CHANGED');
    f.embeddings.captureSpace = () => space;
    expect(await f.service.search('project', { query: 'approveBuild', mode: 'fts' })).toHaveLength(1);
  });
  it('reindex removes deleted files and abort does not publish a partial snapshot', async () => {
    const f = fixture(); await f.service.index('project', {});
    const controller = new AbortController(); controller.abort();
    await expect(f.service.index('project', {}, controller.signal)).rejects.toThrow();
    expect(await f.service.search('project', { query: 'logo', mode: 'fts' })).toHaveLength(1);
    f.setSnapshot({ projectId: 'project', complete: true, files: [], skipped: [] });
    await f.service.index('project', {});
    expect(await f.service.search('project', { query: 'logo', mode: 'fts' })).toEqual([]);
  });
});
