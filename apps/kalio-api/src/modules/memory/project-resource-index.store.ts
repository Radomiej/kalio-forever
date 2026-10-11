import type { EmbeddingSpace, MemorySearchMode, ProjectResourceSearchResult, ResourceModality, ResourceRepresentation } from '@kalio/types';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createSqliteDatabase, loadSqliteVec, type SqliteClient } from '../../database/sqlite-runtime';
import { verifyEmbeddingSpaceIdentity } from './embedding-identity';

export const RESOURCE_TYPES: readonly ResourceModality[] = ['text', 'code', 'image', 'audio', 'video', 'pdf'];
const CHUNKING_VERSION = 'token-bounded-v2';
export interface IndexedResourceChunk {
  id: string; path: string; resourceType: ResourceModality; representation: ResourceRepresentation;
  content: string; contentHash: string; embedding: number[];
}
interface ResourceRow {
  id: string; path: string; resource_type: ResourceModality; representation: ResourceRepresentation;
  content: string; content_hash: string; created_at: number;
}
function hash(value: string): string { return createHash('sha256').update(value).digest('hex'); }
function validType(type: string): asserts type is ResourceModality {
  if (!RESOURCE_TYPES.includes(type as ResourceModality)) throw new Error('INVALID_RESOURCE_TYPE');
}
function validateVector(vector: number[], dimensions: number): void {
  if (!Array.isArray(vector) || vector.length !== dimensions
    || vector.some(n => typeof n !== 'number' || !Number.isFinite(n) || Math.abs(n) > 3.402823466e38)) {
    throw new Error('INVALID_EMBEDDING_VECTOR');
  }
}

/** One database per project/space, separate vec0 indexes per resource type. */
export class ProjectResourceIndexStore {
  static exists(root: string, projectId: string, spaceId: string): boolean {
    return existsSync(join(root, 'project-resources', hash(projectId), `${hash(spaceId)}.db`));
  }
  private readonly db: SqliteClient;
  private closed = false;
  private readonly space: EmbeddingSpace;
  constructor(root: string, private readonly projectId: string, space: EmbeddingSpace) {
    if (!projectId || !verifyEmbeddingSpaceIdentity(space) || space.dimensions > 4096) {
      throw new Error('INVALID_EMBEDDING_SPACE');
    }
    this.space = { ...space };
    const base = join(root, 'project-resources');
    const dir = join(base, hash(projectId));
    const filename = join(dir, `${hash(space.id)}.db`);
    if (!existsSync(filename) && existsSync(base)) {
      const projects = readdirSync(base, { withFileTypes: true });
      if (projects.length > 32) throw new Error('PROJECT_RESOURCE_STORAGE_LIMIT');
      let databases = 0;
      for (const project of projects) {
        if (!project.isDirectory() || project.isSymbolicLink() || !/^[a-f0-9]{64}$/.test(project.name)) throw new Error('PROJECT_RESOURCE_STORAGE_LIMIT');
        const files = readdirSync(join(base, project.name));
        if (files.length > 64) throw new Error('PROJECT_RESOURCE_STORAGE_LIMIT');
        databases += files.filter(file => file.endsWith('.db')).length;
      }
      if (databases >= 16) throw new Error('PROJECT_RESOURCE_STORAGE_LIMIT');
    }
    mkdirSync(dir, { recursive: true });
    this.db = createSqliteDatabase(filename).client;
    try {
      loadSqliteVec(this.db);
      this.db.exec('PRAGMA busy_timeout=5000');
      const pageSize = this.db.prepare<{ page_size: number }>('PRAGMA page_size').get()!.page_size;
      this.db.exec(`PRAGMA max_page_count=${Math.floor(64 * 1024 * 1024 / pageSize)}`);
      this.db.exec(`CREATE TABLE IF NOT EXISTS resource_manifest (id INTEGER PRIMARY KEY CHECK(id=1), identity TEXT NOT NULL, indexed_at INTEGER, generation INTEGER NOT NULL DEFAULT 0);
        CREATE TABLE IF NOT EXISTS resources (id TEXT PRIMARY KEY, path TEXT NOT NULL, resource_type TEXT NOT NULL,
        representation TEXT NOT NULL, content TEXT NOT NULL, content_hash TEXT NOT NULL, created_at INTEGER NOT NULL);
        CREATE VIRTUAL TABLE IF NOT EXISTS resources_fts USING fts5(id UNINDEXED, content, tokenize='unicode61');`);
      const columns = this.db.prepare<{ name: string }>('PRAGMA table_info(resource_manifest)').all();
      if (!columns.some(column => column.name === 'generation')) this.db.exec('ALTER TABLE resource_manifest ADD COLUMN generation INTEGER NOT NULL DEFAULT 0');
      if (!columns.some(column => column.name === 'chunking_version')) this.db.exec("ALTER TABLE resource_manifest ADD COLUMN chunking_version TEXT NOT NULL DEFAULT ''");
      const identity = JSON.stringify([1, projectId, space.id, space.provider, space.providerScope, space.model, space.modelRevision,
        space.dimensions, space.backend, space.endpointFingerprint, space.promptVersion, space.documentPromptVersion, space.queryPromptVersion, space.codeQueryPromptVersion, space.normalizationVersion]);
      const manifest = this.db.prepare<{ identity: string }>('SELECT identity FROM resource_manifest WHERE id=1').get();
      if (manifest && manifest.identity !== identity) throw new Error('EMBEDDING_SPACE_MISMATCH');
      if (!manifest) this.db.prepare('INSERT INTO resource_manifest(id,identity) VALUES(1,?)').run(identity);
      for (const type of RESOURCE_TYPES) this.db.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS resource_vec_${type} USING vec0(id TEXT PRIMARY KEY, embedding float[${space.dimensions}])`);
    } catch (error) { this.db.close(); throw error; }
  }

  /** Full bounded snapshot only. Failure leaves the previous published snapshot intact. */
  replace(chunks: readonly IndexedResourceChunk[], indexedAt: number): void {
    if (!Number.isSafeInteger(indexedAt) || indexedAt < 1 || chunks.length > 10000) throw new Error('INVALID_RESOURCE_SNAPSHOT');
    const ids = new Set<string>();
    for (const chunk of chunks) {
      validType(chunk.resourceType); validateVector(chunk.embedding, this.space.dimensions);
      if (!chunk.id || ids.has(chunk.id) || !chunk.path || !['content', 'metadata'].includes(chunk.representation)
        || !chunk.content || chunk.content.length > 8192 || !chunk.contentHash) throw new Error('INVALID_RESOURCE_CHUNK');
      ids.add(chunk.id);
    }
    this.db.transaction(() => {
      this.db.exec('DELETE FROM resources; DELETE FROM resources_fts;');
      for (const type of RESOURCE_TYPES) this.db.exec(`DELETE FROM resource_vec_${type}`);
      for (const chunk of chunks) {
        this.db.prepare('INSERT INTO resources VALUES(?,?,?,?,?,?,?)').run(chunk.id, chunk.path, chunk.resourceType, chunk.representation, chunk.content, chunk.contentHash, indexedAt);
        this.db.prepare('INSERT INTO resources_fts(id,content) VALUES(?,?)').run(chunk.id, chunk.content);
        this.db.prepare(`INSERT INTO resource_vec_${chunk.resourceType}(id,embedding) VALUES(?,?)`).run(chunk.id, new Float32Array(chunk.embedding));
      }
      this.db.prepare('UPDATE resource_manifest SET indexed_at=?,generation=generation+1,chunking_version=? WHERE id=1').run(indexedAt, CHUNKING_VERSION);
    })();
  }

  search(query: string, vector: number[] | undefined, types: readonly ResourceModality[], limit: number, mode: MemorySearchMode): ProjectResourceSearchResult[] {
    if (!query?.trim() || query.length > 4096 || !Number.isSafeInteger(limit) || limit < 1 || limit > 100
      || !['vector', 'fts', 'hybrid'].includes(mode)) throw new Error('INVALID_RESOURCE_SEARCH');
    for (const type of types) validType(type);
    if (mode !== 'fts') { if (!vector) throw new Error('MISSING_QUERY_EMBEDDING'); validateVector(vector, this.space.dimensions); }
    const selected = [...new Set(types)];
    if (!selected.length) return [];
    const ranked = new Map<string, { row: ResourceRow; score: number }>();
    const add = (rows: ResourceRow[]) => rows.forEach((row, rank) => {
      const prior = ranked.get(row.id); const score = 1 / (60 + rank + 1);
      ranked.set(row.id, { row, score: (prior?.score ?? 0) + score });
    });
    const fetchLimit = Math.min(300, Math.max(20, limit * 3));
    if (mode !== 'fts') {
      // Filter is implemented by selecting the type index before nearest-neighbor search.
      const rows: Array<ResourceRow & { distance: number }> = [];
      for (const type of selected) rows.push(...this.db.prepare<ResourceRow & { distance: number }>(
        `SELECT r.*,v.distance FROM resource_vec_${type} v JOIN resources r ON r.id=v.id
         WHERE v.embedding MATCH ? AND k=? ORDER BY v.distance`).all(new Float32Array(vector!), fetchLimit));
      add(rows.sort((a, b) => a.distance - b.distance || a.id.localeCompare(b.id)).slice(0, fetchLimit));
    }
    if (mode !== 'vector') {
      const ftsQuery = (query.match(/[\p{L}\p{N}_]+/gu) ?? []).map(term => `"${term}"`).join(' OR ');
      if (ftsQuery) add(this.db.prepare<ResourceRow>(`SELECT r.* FROM resources_fts f JOIN resources r ON r.id=f.id
        WHERE resources_fts MATCH ? AND r.resource_type IN (${selected.map(() => '?').join(',')})
        ORDER BY bm25(resources_fts),r.id LIMIT ?`).all(ftsQuery, ...selected, fetchLimit));
    }
    return [...ranked.values()].sort((a, b) => b.score - a.score || a.row.id.localeCompare(b.row.id)).slice(0, limit).map(({ row, score }) => ({
      id: row.id, projectId: this.projectId, spaceId: this.space.id, path: row.path,
      resourceType: row.resource_type, representation: row.representation, content: row.content, score,
      metadata: { contentHash: row.content_hash, model: this.space.model }, createdAt: row.created_at,
    }));
  }

  status(): { indexedChunks: number; indexedAt: number | null } {
    const count = this.db.prepare<{ count: number }>('SELECT COUNT(*) AS count FROM resources').get()!;
    const manifest = this.db.prepare<{ indexed_at: number | null }>('SELECT indexed_at FROM resource_manifest WHERE id=1').get()!;
    return { indexedChunks: count.count, indexedAt: manifest.indexed_at };
  }
  sourceReferences(): Array<{ path: string; contentHash: string }> {
    return this.db.prepare<{ path: string; contentHash: string }>('SELECT DISTINCT path,content_hash AS contentHash FROM resources').all();
  }
  generation(): number {
    return this.db.prepare<{ generation: number }>('SELECT generation FROM resource_manifest WHERE id=1').get()!.generation;
  }
  hasCurrentChunking(): boolean {
    return this.db.prepare<{ chunking_version: string }>('SELECT chunking_version FROM resource_manifest WHERE id=1').get()!.chunking_version === CHUNKING_VERSION;
  }
  close(): void { if (!this.closed) { this.closed = true; this.db.close(); } }
}
