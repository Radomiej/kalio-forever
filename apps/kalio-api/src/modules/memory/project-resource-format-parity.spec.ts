import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDrizzleDatabase, createSqliteDatabase } from '../../database/sqlite-runtime';
import * as schema from '../../database/schema';
import type { DrizzleService } from '../../database/drizzle.service';
import { ProjectResourceReaderService } from '../vfs/project-resource-reader.service';
import { ProjectResourceIndexStorage } from '../vfs/project-resource-index-storage';
import { ProjectResourceIndexService } from './project-resource-index.service';
import { buildEmbeddingSpace } from './embedding-identity';
import type { EmbeddingService } from './embedding.service';
import type { ProjectContextSettingsService } from './project-context-settings.service';

// Explicit expectations, not derived from either production allowlist.
const code = '.html .htm .css .scss .sass .less .js .jsx .ts .tsx .mts .cts .mjs .cjs .vue .svelte .py .rb .go .rs .java .kt .kts .cs .c .h .cpp .hpp .sql .sh .ps1 .bat .cmd .lua .luau .php .swift .dart'.split(' ');
const text = '.txt .md .mdx .rst .csv .tsv .json .jsonc .yaml .yml .toml .xml'.split(' ');
const binary = [
  ...'.png .jpg .jpeg .gif .webp .svg .ico .bmp .avif'.split(' ').map(ext => [ext, 'image'] as const),
  ['.pdf', 'pdf'],
  ...'.mp3 .wav .ogg .flac .m4a .aac'.split(' ').map(ext => [ext, 'audio'] as const),
  ...'.mp4 .webm .mov .mkv'.split(' ').map(ext => [ext, 'video'] as const),
] as const;
const cases = [
  ...code.map(ext => ({ path: `source${ext}`, type: 'code', representation: 'content' })),
  ...text.map(ext => ({ path: `document${ext}`, type: 'text', representation: 'content' })),
  ...['README', 'LICENSE', 'LICENCE', 'Dockerfile', 'Makefile'].map(path => ({ path, type: 'text', representation: 'content' })),
  ...binary.map(([ext, type]) => ({ path: `asset${ext}`, type, representation: 'metadata' })),
];
const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup(); });

describe('real reader → partitioned index supported-format parity', () => {
  it('indexes every admitted format and special filename without decoding binary bytes or secret files', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kalio-format-parity-'));
    const database = createSqliteDatabase(':memory:', 'node');
    cleanups.push(async () => { database.client.close(); await rm(root, { recursive: true, force: true }); });
    database.client.exec('CREATE TABLE projects (id TEXT PRIMARY KEY, path TEXT)');
    database.client.prepare('INSERT INTO projects(id,path) VALUES(?,?)').run('approved', root);
    const drizzle = { db: createDrizzleDatabase(database.client, database.driver, schema) } as DrizzleService;
    for (const item of cases) await writeFile(join(root, item.path), item.representation === 'metadata'
      ? Buffer.from([255, 254, 0, 137]) : 'formatparityneedle source document');
    await writeFile(join(root, '.env'), 'NEVER_INDEX_SECRET');
    await mkdir(join(root, 'node_modules'));
    await writeFile(join(root, 'node_modules', 'dependency.ts'), 'NEVER_INDEX_DEPENDENCY');
    const reader = new ProjectResourceReaderService(drizzle);
    const snapshot = await reader.readProject('approved');
    expect(snapshot.files.map(file => file.path).sort()).toEqual(cases.map(item => item.path).sort());
    const space = buildEmbeddingSpace({ provider: 'mock', providerScope: 'test', backend: '', baseUrl: 'mock', model: 'parity',
      modelRevision: '1', dimensions: 2, promptVersion: '1', documentPromptVersion: '1', queryPromptVersion: '1',
      codeQueryPromptVersion: '1', normalizationVersion: '1' });
    const embeddings = { ensureCurrentIdentity: vi.fn(async () => undefined), captureSpace: () => space,
      getStatus: () => ({ configured: true, provider: 'mock' }), getDocumentSizer: async () => undefined,
      embedPinned: vi.fn(async (_space: unknown, values: string[]) => values.map(() => [1, 0])) };
    const index = new ProjectResourceIndexService(new ProjectResourceIndexStorage(join(root, '.cache')),
      embeddings as unknown as EmbeddingService, reader,
      { assertEnabled: async () => undefined } as unknown as ProjectContextSettingsService, drizzle);
    const result = await index.index('approved', {});
    expect(result.indexedFiles).toBe(cases.length);
    expect(result.skipped.map(item => item.path).sort()).toEqual(['.env', 'node_modules']);
    const results = [...await index.search('approved', { query: 'formatparityneedle', mode: 'fts', limit: 100 }),
      ...await index.search('approved', { query: 'asset', mode: 'fts', limit: 100 })];
    for (const item of cases) {
      expect(results.find(row => row.path === item.path), item.path).toMatchObject({ resourceType: item.type, representation: item.representation });
    }
    expect(embeddings.embedPinned.mock.calls.flatMap(call => call[1]).join('\n')).not.toContain('NEVER_INDEX');
  });
});
