import { Inject, Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { basename, extname } from 'node:path';
import { PROJECT_RESOURCE_READER, type EmbeddingSpace, type ProjectResourceReaderPort, type ProjectResourceIndexRequest,
  type ProjectResourceIndexResult, type ProjectResourceSearchRequest, type ProjectResourceSearchResult,
  type ProjectResourceFile, type ProjectResourceSnapshot, type ResourceModality, type ResourceRepresentation } from '@kalio/types';
import { EmbeddingService } from './embedding.service';
import { ProjectResourceIndexStore, RESOURCE_TYPES, type IndexedResourceChunk } from './project-resource-index.store';
import { eq } from 'drizzle-orm';
import { DrizzleService } from '../../database/drizzle.service';
import { sessions } from '../../database/schema';
import { ProjectContextSettingsService } from './project-context-settings.service';
import { chunkProjectResourceContent } from './project-resource-chunks';
import { PROJECT_RESOURCE_INDEX_STORAGE, type ProjectResourceIndexStoragePort } from '@kalio/types';

// Keep format coverage aligned with VFS ProjectResourceReaderService; exercised by the reader → index parity test.
const CODE = new Set(('.html .htm .css .scss .sass .less .js .jsx .ts .tsx .mts .cts .mjs .cjs .vue .svelte .py .rb .go .rs .java .kt .kts .cs .c .h .cpp .hpp .sql .sh .ps1 .bat .cmd .lua .luau .php .swift .dart').split(' '));
const TEXT = new Set(('.txt .md .mdx .rst .csv .tsv .json .jsonc .yaml .yml .toml .xml').split(' '));
const TEXT_NAMES = new Set(['readme', 'license', 'licence', 'dockerfile', 'makefile']);
const BINARY: Record<string, ResourceModality> = {
  '.png': 'image', '.jpg': 'image', '.jpeg': 'image', '.gif': 'image', '.webp': 'image', '.svg': 'image', '.ico': 'image', '.bmp': 'image', '.avif': 'image',
  '.pdf': 'pdf', '.mp3': 'audio', '.wav': 'audio', '.flac': 'audio', '.ogg': 'audio', '.m4a': 'audio', '.aac': 'audio',
  '.mp4': 'video', '.webm': 'video', '.mov': 'video', '.mkv': 'video',
};
function digest(value: string | Uint8Array): string { return createHash('sha256').update(value).digest('hex'); }
function readResource(file: ProjectResourceFile) {
  const extension = extname(file.path).toLowerCase();
  const type: ResourceModality | undefined = CODE.has(extension) ? 'code'
    : TEXT.has(extension) || TEXT_NAMES.has(basename(file.path).toLowerCase()) ? 'text' : BINARY[extension];
  if (!type) return undefined;
  const representation: ResourceRepresentation = type === 'text' || type === 'code' ? 'content' : 'metadata';
  const content = representation === 'metadata'
    ? `${type} asset: ${file.path}, size ${file.sizeBytes} bytes. File metadata only; binary content was not embedded.`
    : new TextDecoder('utf-8', { fatal: true }).decode(file.content);
  if (!content.trim()) return undefined;
  return { type, representation, content, contentHash: digest(file.content) };
}
function prepareFile(file: ProjectResourceFile, resource: NonNullable<ReturnType<typeof readResource>>,
  fits?: (content: string) => boolean): Array<Omit<IndexedResourceChunk, 'embedding'>> {
  const { type, representation, content, contentHash } = resource;
  const chunks: Array<Omit<IndexedResourceChunk, 'embedding'>> = [];
  if (representation === 'content') {
    return chunkProjectResourceContent(file.path, content, fits).map(chunk => ({
      id: digest(JSON.stringify([file.path, chunk.startOffset, contentHash])), path: file.path, resourceType: type,
      representation, content: chunk.content, contentHash,
    }));
  }
  if (fits && !fits(content)) throw new Error('PROJECT_RESOURCE_TOKEN_LIMIT');
  for (let offset = 0; offset < content.length; offset += 1800) {
    const metadata = content.slice(offset, offset + 2000);
    if (fits && !fits(metadata)) throw new Error('PROJECT_RESOURCE_TOKEN_LIMIT');
    chunks.push({ id: digest(JSON.stringify([file.path, offset, contentHash])), path: file.path, resourceType: type,
      representation, content: metadata, contentHash });
    if (offset + 2000 >= content.length) break;
  }
  return chunks;
}

function parseSnapshot(snapshot: ProjectResourceSnapshot) {
  const resources = new Map<string, NonNullable<ReturnType<typeof readResource>>>();
  const skipped = [...snapshot.skipped]; const paths = new Set<string>();
  for (const file of snapshot.files) {
    if (paths.has(file.path)) throw new Error('PROJECT_RESOURCE_SCOPE_MISMATCH');
    paths.add(file.path);
    try {
      const resource = readResource(file);
      if (resource) resources.set(file.path, resource);
      else skipped.push({ path: file.path, reason: 'Unsupported or empty resource' });
    } catch (error) {
      if (!(error instanceof TypeError)) throw error;
      skipped.push({ path: file.path, reason: 'Not valid UTF-8; content indexing skipped' });
    }
  }
  return { snapshot, resources, skipped };
}
type ParsedSnapshot = ReturnType<typeof parseSnapshot>;
function matchesReferences(parsed: ParsedSnapshot, refs: Array<{ path: string; contentHash: string }>): boolean {
  const references = new Map(refs.map(ref => [ref.path, ref.contentHash]));
  return references.size === refs.length && references.size === parsed.resources.size
    && [...parsed.resources].every(([path, resource]) => references.get(path) === resource.contentHash);
}

@Injectable()
export class ProjectResourceIndexService {
  private readonly indexing = new Set<string>();
  private readonly autoRefreshes = new Map<string, Promise<void>>();
  constructor(@Inject(PROJECT_RESOURCE_INDEX_STORAGE) private readonly storage: ProjectResourceIndexStoragePort,
    private readonly embeddings: EmbeddingService,
    @Inject(PROJECT_RESOURCE_READER) private readonly reader: ProjectResourceReaderPort,
    private readonly settings: ProjectContextSettingsService,
    private readonly drizzle: DrizzleService) {}

  async index(project: string, request: ProjectResourceIndexRequest, signal?: AbortSignal): Promise<ProjectResourceIndexResult> {
    return this.indexSnapshot(project, request, signal);
  }
  private async indexSnapshot(project: string, request: ProjectResourceIndexRequest, signal?: AbortSignal,
    parsed?: ParsedSnapshot, expectedSpace?: EmbeddingSpace): Promise<ProjectResourceIndexResult> {
    await this.settings.assertEnabled();
    await this.embeddings.ensureCurrentIdentity();
    this.assertProjectId(project); this.assertConsent(request.allowRemoteProcessing); signal?.throwIfAborted();
    await this.settings.assertEnabled();
    if (expectedSpace) this.assertCurrent(expectedSpace);
    if (this.indexing.has(project)) throw new Error('PROJECT_RESOURCE_INDEX_BUSY');
    this.indexing.add(project);
    try {
      const space = this.embeddings.captureSpace();
      this.assertReusable(space);
      const snapshot = parsed?.snapshot ?? await this.reader.readProject(project, signal);
      if (snapshot.projectId !== project || snapshot.complete !== true) throw new Error('PROJECT_RESOURCE_SCOPE_MISMATCH');
      signal?.throwIfAborted();
      const prepared: Array<Omit<IndexedResourceChunk, 'embedding'>> = [];
      const inputs = parsed ?? parseSnapshot(snapshot);
      const skipped = inputs.skipped; const indexedFiles = inputs.resources.size;
      const fits = await this.embeddings.getDocumentSizer(space);
      await this.settings.assertEnabled(); this.assertCurrent(space); signal?.throwIfAborted();
      if (space.provider === 'local-transformers' && !fits) throw new Error('PROJECT_RESOURCE_TOKEN_LIMIT');
      for (const file of snapshot.files) {
        const resource = inputs.resources.get(file.path);
        if (resource) prepared.push(...prepareFile(file, resource, fits));
      }
      if (prepared.length > 10000) throw new Error('PROJECT_RESOURCE_CHUNK_LIMIT');
      const chunks: IndexedResourceChunk[] = [];
      for (let start = 0; start < prepared.length; start += 32) {
        await this.settings.assertEnabled(); this.assertCurrent(space);
        signal?.throwIfAborted();
        const batch = prepared.slice(start, start + 32);
        const vectors = await this.embeddings.embedPinned(space, batch.map(c => c.content), 'document');
        if (vectors.length !== batch.length) throw new Error('INVALID_EMBEDDING_BATCH');
        batch.forEach((chunk, index) => chunks.push({ ...chunk, embedding: vectors[index]! }));
      }
      signal?.throwIfAborted(); this.assertCurrent(space);
      await this.settings.assertEnabled();
      const fresh = await this.reader.readProject(project, signal);
      this.assertSnapshot(project, fresh);
      const originalHashes = snapshot.files.map(file => [file.path, digest(file.content)]).sort();
      const freshHashes = fresh.files.map(file => [file.path, digest(file.content)]).sort();
      if (JSON.stringify(originalHashes) !== JSON.stringify(freshHashes)) throw new Error('PROJECT_RESOURCE_SOURCE_CHANGED');
      signal?.throwIfAborted(); this.assertCurrent(space);
      const indexedAt = Date.now();
      await this.settings.assertEnabled();
      await this.embeddings.ensureCurrentIdentity();
      await this.settings.assertEnabled();
      this.assertCurrent(space);
      const store = new ProjectResourceIndexStore(this.storage, project, space);
      try { store.replace(chunks, indexedAt); } finally { store.close(); }
      return { projectId: project, space, indexedFiles, indexedChunks: chunks.length, skipped, indexedAt };
    } finally { this.indexing.delete(project); }
  }

  async search(project: string, request: ProjectResourceSearchRequest): Promise<ProjectResourceSearchResult[]> {
    await this.settings.assertEnabled();
    await this.embeddings.ensureCurrentIdentity();
    this.assertProjectId(project);
    await this.settings.assertEnabled();
    const mode = request.mode ?? 'hybrid'; const types = request.resourceTypes ?? [...RESOURCE_TYPES]; const limit = request.limit ?? 5;
    if (typeof request.query !== 'string' || !request.query.trim() || request.query.length > 4096
      || !['vector', 'fts', 'hybrid'].includes(mode) || !Number.isSafeInteger(limit) || limit < 1 || limit > 100
      || !Array.isArray(types) || types.some(type => !RESOURCE_TYPES.includes(type))) throw new Error('INVALID_RESOURCE_SEARCH');
    if (mode !== 'fts') this.assertConsent(request.allowRemoteProcessing);
    const space = this.embeddings.captureSpace();
    this.assertReusable(space);
    let parsed = await this.readSnapshot(project, space);
    for (let attempt = 0; attempt < 2; attempt++) {
      await this.ensureFreshIndex(project, request, space, parsed);
      parsed = await this.readSnapshot(project, space);
      await this.settings.assertEnabled(); this.assertCurrent(space);
      const store = new ProjectResourceIndexStore(this.storage, project, space);
      try {
        const generation = store.generation();
        const refs = store.sourceReferences();
        if (!store.hasCurrentChunking() || !matchesReferences(parsed, refs)) throw new Error('PROJECT_RESOURCE_REINDEX_REQUIRED');
        const vector = mode === 'fts' || !store.status().indexedChunks ? undefined
          : (await this.embeddings.embedPinned(space, [request.query], types.length === 1 && types[0] === 'code' ? 'code_query' : 'query'))[0];
        await this.settings.assertEnabled(); this.assertCurrent(space);
        const results = store.status().indexedChunks ? store.search(request.query, vector, types, limit, mode) : [];
        const verified = await this.readSnapshot(project, space);
        await this.embeddings.ensureCurrentIdentity();
        await this.settings.assertEnabled(); this.assertCurrent(space);
        if (store.generation() !== generation) throw new Error('PROJECT_RESOURCE_INDEX_CHANGED');
        if (!store.hasCurrentChunking()) throw new Error('PROJECT_RESOURCE_REINDEX_REQUIRED');
        if (matchesReferences(verified, refs)) return results;
        if (attempt === 1) throw new Error('PROJECT_RESOURCE_REINDEX_REQUIRED');
        parsed = verified;
      } finally { store.close(); }
    }
    throw new Error('PROJECT_RESOURCE_REINDEX_REQUIRED');
  }

  private async readSnapshot(project: string, space: EmbeddingSpace): Promise<ParsedSnapshot> {
    await this.settings.assertEnabled(); this.assertCurrent(space);
    const snapshot = await this.reader.readProject(project);
    await this.settings.assertEnabled(); this.assertCurrent(space);
    this.assertSnapshot(project, snapshot);
    return parseSnapshot(snapshot);
  }
  private async ensureFreshIndex(project: string, request: ProjectResourceSearchRequest,
    space: EmbeddingSpace, parsed: ParsedSnapshot): Promise<void> {
    await this.settings.assertEnabled(); this.assertCurrent(space);
    let fresh = false;
    if (this.storage.exists(project, space.id)) {
      const store = new ProjectResourceIndexStore(this.storage, project, space);
      try { fresh = store.status().indexedAt !== null && store.hasCurrentChunking() && matchesReferences(parsed, store.sourceReferences()); }
      finally { store.close(); }
    }
    if (fresh) return;
    // Each caller authorizes document inference before joining another caller's refresh.
    this.assertConsent(request.allowRemoteProcessing);
    let refresh = this.autoRefreshes.get(project);
    if (!refresh) {
      refresh = this.indexSnapshot(project, { allowRemoteProcessing: request.allowRemoteProcessing }, undefined, parsed, space)
        .then(() => undefined).finally(() => { this.autoRefreshes.delete(project); });
      this.autoRefreshes.set(project, refresh);
    }
    await refresh;
    await this.settings.assertEnabled();
    await this.embeddings.ensureCurrentIdentity(); this.assertCurrent(space);
  }

  async status(project: string): Promise<{ projectId: string; space: EmbeddingSpace; indexedChunks: number; indexedAt: number | null }> {
    this.assertProjectId(project); await this.embeddings.ensureCurrentIdentity(); const space = this.embeddings.captureSpace();
    if (!this.storage.exists(project, space.id)) return { projectId: project, space, indexedChunks: 0, indexedAt: null };
    const store = new ProjectResourceIndexStore(this.storage, project, space);
    try { return { projectId: project, space, ...store.status() }; } finally { store.close(); }
  }
  async refreshForSession(sessionId: string, request: ProjectResourceIndexRequest): Promise<ProjectResourceIndexResult> {
    return this.index(this.projectForSession(sessionId), request);
  }
  async searchForSession(sessionId: string, request: ProjectResourceSearchRequest): Promise<ProjectResourceSearchResult[]> {
    return this.search(this.projectForSession(sessionId), request);
  }
  private projectForSession(sessionId: string): string {
    const row = this.drizzle.db.select({ projectId: sessions.projectId }).from(sessions).where(eq(sessions.id, sessionId)).get();
    if (!row || !row.projectId || row.projectId === 'system:none') throw new Error('PROJECT_CONTEXT_SESSION_PROJECT_REQUIRED');
    return row.projectId;
  }
  private assertCurrent(space: EmbeddingSpace): void {
    if (this.embeddings.captureSpace().id !== space.id) throw new Error('EMBEDDING_SPACE_CHANGED');
  }
  private assertReusable(space: EmbeddingSpace): void {
    if (space.modelRevision === 'unresolved' || space.providerScope === 'unresolved') throw new Error('EMBEDDING_REVISION_REQUIRED');
    // /api/tags proves metadata only. Mutable /api/embed model names can undergo
    // A -> B -> A between checks, so no project vectors may be produced/reused.
    if (space.provider === 'ollama') throw new Error('EMBEDDING_IMMUTABLE_INFERENCE_REQUIRED');
  }
  private assertSnapshot(project: string, snapshot: { projectId: string; complete: boolean }): void {
    if (snapshot.projectId !== project || snapshot.complete !== true) throw new Error('PROJECT_RESOURCE_SCOPE_MISMATCH');
  }
  private assertProjectId(project: string): void {
    if (typeof project !== 'string' || !project.trim() || project.length > 128) throw new Error('INVALID_PROJECT_ID');
  }
  private assertConsent(consent?: boolean): void {
    const status = this.embeddings.getStatus();
    if (!status.configured) throw new Error('EMBEDDING_PROVIDER_UNAVAILABLE');
    let local = status.provider === 'local-transformers' || status.provider === 'mock';
    if (status.provider === 'ollama') {
      try { local = ['localhost', '127.0.0.1', '[::1]'].includes(new URL(status.baseUrlMasked).hostname); }
      catch { local = false; }
    }
    if (!local && consent !== true) throw new Error('REMOTE_EMBEDDING_CONSENT_REQUIRED');
  }
}
