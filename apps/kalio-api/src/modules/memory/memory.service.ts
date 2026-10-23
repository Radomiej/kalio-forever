import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { nanoid } from 'nanoid';
import fs from 'node:fs';
import type { EmbeddingSpace, MemoryIngestResult, MemoryScopeSummary, MemorySearchResult } from '@kalio/types';
import { EmbeddingService } from './embedding.service';
import { VectorStoreService } from './vector-store.service';
import { AppSettingsService } from '../../database/app-settings.service';
import { WebResultsMemoryStore } from './web-results-memory.store';
import { buildMemoryScopeSummary } from './memory-summary.utils';
import type { WebSearchChunk } from './web-search-chunking';
import { MEMORY_KINDS, MEMORY_PROFILE_PREFIXES, currentStorageSpace, partitionPath, listMemorySources, readMemorySource, fuseMemoryRanks, type MemoryKind } from './memory-partitions';

// ── Text splitting constants ────────────────────────────────────────────────

const MAX_CHUNK_SIZE = 1500;
const CHUNK_OVERLAP = 200;

// ── MemoryService ───────────────────────────────────────────────────────────

@Injectable()
export class MemoryService implements OnModuleDestroy {
  private readonly logger = new Logger(MemoryService.name);
  private readonly stores = new Map<string, VectorStoreService>();
  private readonly dbBasePath: string;
  private readonly webResults: WebResultsMemoryStore;

  constructor(
    private readonly config: ConfigService,
    private readonly appSettings: AppSettingsService,
    private readonly embeddingService: EmbeddingService,
  ) {
    this.dbBasePath = this.config.get<string>('MEMORY_DB_PATH', './data/memory');
    this.webResults = new WebResultsMemoryStore(this.dbBasePath, this.embeddingService);
    this.logger.log(`MemoryService initialized: ${this.dbBasePath}`);
  }

  getEmbeddingService(): EmbeddingService {
    return this.embeddingService;
  }

  private getStore(personaId: string, kind: MemoryKind = 'memory', space = currentStorageSpace(this.embeddingService)): VectorStoreService {
    return this.getStoreForProfile(personaId, space, kind);
  }

  private getStoreForProfile(personaId: string, space: Pick<EmbeddingSpace, 'id' | 'dimensions'>, kind: MemoryKind): VectorStoreService {
    const storeKey = `${personaId}:${space.id}:${kind}`;
    const existing = this.stores.get(storeKey);
    if (existing) return existing;

    const dbPath = partitionPath(this.dbBasePath, personaId, space.id, kind);
    const store = new VectorStoreService(dbPath, space.dimensions);
    this.stores.set(storeKey, store);
    return store;
  }

  private getStores(personaId: string, space = currentStorageSpace(this.embeddingService)): VectorStoreService[] {
    return MEMORY_KINDS.map(kind => this.getStore(personaId, kind, space));
  }

  listIndexedPersonaIds(): string[] {
    if (!fs.existsSync(this.dbBasePath)) return [];

    const ids = new Set<string>();
    for (const file of fs.readdirSync(this.dbBasePath)) {
      if (!file.endsWith('.db')) continue;
      const withoutExt = file.slice(0, -'.db'.length);
      if (!MEMORY_PROFILE_PREFIXES.some((prefix) => withoutExt.includes(`.${prefix}`))) {
        ids.add(withoutExt);
        continue;
      }
      for (const prefix of MEMORY_PROFILE_PREFIXES) {
        const marker = `.${prefix}`;
        const index = withoutExt.indexOf(marker);
        if (index > 0) {
          ids.add(withoutExt.slice(0, index));
          break;
        }
      }
    }
    return Array.from(ids).sort();
  }

  async ingest(
    text: string,
    personaId: string,
    metadata: Record<string, string> = {}
  ): Promise<MemoryIngestResult> {
    if (!this.embeddingService.getStatus().configured) {
      return { ids: [], count: 0 };
    }

    const space = this.embeddingService.captureSpace();
    const chunks = splitTextIntoChunks(text);
    const ids: string[] = [];
    const embeddingModel = space.model;
    const embeddings = await this.embeddingService.embedPinned(space, chunks);
    const store = this.getStore(personaId, 'memory', space);

    for (let i = 0; i < chunks.length; i++) {
      const id = nanoid();
      const chunk = chunks[i]!;
      const embedding = embeddings[i]!;
      store.insert(id, embedding, chunk, { ...metadata, chunk_index: String(i) }, embeddingModel);
      ids.push(id);
    }

    this.logger.log(`Ingested ${chunks.length} chunks for persona ${personaId}`);
    return { ids, count: ids.length };
  }

  async ingestWebSearchResult(
    chunks: WebSearchChunk[],
  ): Promise<MemoryIngestResult> {
    return this.webResults.ingest(chunks);
  }

  async ingestConversation(
    messages: Array<{ role: string; content: string }>,
    personaId: string
  ): Promise<MemoryIngestResult> {
    if (!this.embeddingService.getStatus().configured) {
      return { ids: [], count: 0 };
    }

    if (!messages || !Array.isArray(messages)) {
      return { ids: [], count: 0 };
    }
    const meaningful = messages.filter(
      (m) => m.content && m.content.trim().length > 0 && m.role !== 'system'
    );

    if (meaningful.length === 0) {
      return { ids: [], count: 0 };
    }

    const blocks: string[] = [];
    let currentBlock = '';

    for (const msg of meaningful) {
      const prefix = msg.role === 'user' ? 'User' : msg.role === 'assistant' ? 'Assistant' : msg.role;
      const line = `${prefix}: ${msg.content.trim()}`;

      if (currentBlock.length + line.length > MAX_CHUNK_SIZE) {
        if (currentBlock) blocks.push(currentBlock.trim());
        currentBlock = line;
      } else {
        currentBlock += (currentBlock ? '\n' : '') + line;
      }
    }
    if (currentBlock.trim()) blocks.push(currentBlock.trim());

    const space = this.embeddingService.captureSpace();
    const ids: string[] = [];
    const embeddingModel = space.model;
    const embeddings = await this.embeddingService.embedPinned(space, blocks);
    const store = this.getStore(personaId, 'conversation', space);

    for (let i = 0; i < blocks.length; i++) {
      const id = nanoid();
      store.insert(id, embeddings[i]!, blocks[i]!, {
        source: 'conversation',
        block_index: String(i),
      }, embeddingModel);
      ids.push(id);
    }

    this.logger.log(`Ingested ${blocks.length} conversation blocks for persona ${personaId}`);
    return { ids, count: ids.length };
  }

  async search(
    query: string,
    personaId: string,
    limit = 5
  ): Promise<MemorySearchResult[]> {
    if (!this.embeddingService.getStatus().configured) {
      return [];
    }

    const space = this.embeddingService.captureSpace();
    const stores = this.getStores(personaId, space).filter(store => store.count() > 0);
    if (!stores.length) return [];
    const [queryEmbedding] = await this.embeddingService.embedPinned(space, [query], 'query');
    return fuseMemoryRanks(stores.map(store => store.search(queryEmbedding!, Math.max(limit * 3, 20)).map((r) => ({
      id: r.id,
      content: r.content,
      score: 1 / (1 + r.distance),
      metadata: r.metadata,
      createdAt: r.createdAt,
    }))), limit);
  }

  searchFTS(query: string, personaId: string, limit = 5): MemorySearchResult[] {
    return fuseMemoryRanks(this.getStores(personaId).map(store => store.searchFTS(query, Math.max(limit * 3, 20)).map((r) => ({
      id: r.id,
      content: r.content,
      score: r.bm25Score === 0 ? 1 : 1 / (1 + Math.abs(r.bm25Score)),
      metadata: r.metadata,
      createdAt: r.createdAt,
    }))), limit);
  }

  async hybridSearch(
    query: string,
    personaId: string,
    limit = 5
  ): Promise<MemorySearchResult[]> {
    if (!this.embeddingService.getStatus().configured) {
      return [];
    }

    const space = this.embeddingService.captureSpace();
    const stores = this.getStores(personaId, space).filter(store => store.count() > 0);
    if (!stores.length) return [];
    const fetchLimit = Math.max(limit * 3, 20);
    const [queryEmbedding] = await this.embeddingService.embedPinned(space, [query], 'query');
    return fuseMemoryRanks(stores.flatMap(store => [
      store.search(queryEmbedding!, fetchLimit).map(r => ({ ...r, score: 0 })),
      store.searchFTS(query, fetchLimit).map(r => ({ ...r, score: 0 })),
    ]), limit);
  }

  async searchWebResults(
    query: string,
    limit = 5
  ): Promise<MemorySearchResult[]> {
    return this.webResults.search(query, limit);
  }

  getAllWebResults(): MemorySearchResult[] {
    return this.webResults.getAll();
  }

  deleteWebResultsDbFile(): string {
    return this.webResults.deleteCurrentDbFile();
  }

  getSummary(personas: Array<{ id: string; name: string }>): MemoryScopeSummary {
    return buildMemoryScopeSummary(personas, (personaId) => this.getAll(personaId), this.getAllWebResults());
  }

  async reembedPersona(personaId: string): Promise<{ count: number; model: string }> {
    return this.reembedMemoryId(personaId);
  }

  private async reembedMemoryId(personaId: string, pinnedSpace?: EmbeddingSpace): Promise<{ count: number; model: string }> {
    if (!this.embeddingService.getStatus().configured) {
      if (pinnedSpace) throw new Error('EMBEDDING_SPACE_CHANGED');
      return { count: 0, model: await this.embeddingService.getModelName() };
    }

    const space = pinnedSpace ?? this.embeddingService.captureSpace();
    const entriesById = new Map<string, { entry: ReturnType<VectorStoreService['getAll']>[number]; kind: MemoryKind }>();
    for (const source of listMemorySources(this.dbBasePath, personaId)) {
      for (const entry of readMemorySource(source.dbPath)) {
        // TODO: legacy fallback — old mixed databases identify conversations through source metadata.
        const kind = source.kind ?? (entry.metadata.source === 'conversation' ? 'conversation' : 'memory');
        const key = `${kind}:${entry.id}`;
        const existing = entriesById.get(key);
        if (!existing || entry.createdAt > existing.entry.createdAt) entriesById.set(key, { entry, kind });
      }
    }
    const entries = Array.from(entriesById.values());

    if (entries.length === 0) {
      return { count: 0, model: space.model };
    }

    const model = space.model;
    const embeddings = await this.embeddingService.embedPinned(space, entries.map(({ entry }) => entry.content));

    for (let index = 0; index < entries.length; index++) {
      const { entry, kind } = entries[index]!;
      const embedding = embeddings[index]!;
      const store = this.getStore(personaId, kind, space);
      store.insert(entry.id, embedding, entry.content, entry.metadata, model);
    }

    this.logger.log(`Re-embedded ${entries.length} memories for persona ${personaId} using ${model}`);
    return { count: entries.length, model };
  }

  async reembedAll(): Promise<{ personas: number; count: number; model: string }> {
    const space = this.embeddingService.getStatus().configured ? this.embeddingService.captureSpace() : undefined;
    const personaIds = this.listIndexedPersonaIds();
    let count = 0;

    for (const personaId of personaIds) {
      const result = await this.reembedMemoryId(personaId, space);
      count += result.count;
    }

    const webResult = await this.webResults.reembed(space);
    count += webResult.count;

    return { personas: personaIds.length, count, model: webResult.model };
  }

  getAll(personaId: string): MemorySearchResult[] {
    return this.getStores(personaId).flatMap(store => store.getAll()).sort((a, b) => b.createdAt - a.createdAt).map((e) => ({
      id: e.id,
      content: e.content,
      score: 1,
      metadata: e.metadata,
      createdAt: e.createdAt,
    }));
  }

  delete(id: string, personaId: string): boolean {
    const results = this.getStores(personaId).map(store => store.delete(id));
    return results.some(Boolean);
  }

  deleteAll(personaId: string): void {
    for (const store of this.getStores(personaId)) store.deleteAll();
  }

  count(personaId: string): number {
    return this.getStores(personaId).reduce((count, store) => count + store.count(), 0);
  }

  onModuleDestroy(): void {
    this.logger.log('Shutting down MemoryService');
    this.webResults.close();
    for (const [id, store] of this.stores) {
      try {
        store.close();
        this.logger.debug(`Closed store ${id}`);
      } catch (err) {
        this.logger.error(`Error closing store ${id}`, err);
      }
    }
    this.stores.clear();
  }
}

// ── Text splitting utilities ─────────────────────────────────────────────────

function splitTextIntoChunks(text: string): string[] {
  const trimmed = text.trim();
  if (trimmed.length <= MAX_CHUNK_SIZE) {
    return [trimmed];
  }

  const chunks: string[] = [];
  let start = 0;

  while (start < trimmed.length) {
    const end = start + MAX_CHUNK_SIZE;

    if (end >= trimmed.length) {
      chunks.push(trimmed.slice(start).trim());
      break;
    }

    const segment = trimmed.slice(start, end);
    let splitAt = segment.lastIndexOf('\n\n');
    if (splitAt === -1 || splitAt < MAX_CHUNK_SIZE * 0.3) {
      splitAt = segment.lastIndexOf('. ');
      if (splitAt !== -1) splitAt += 1;
    }
    if (splitAt === -1 || splitAt < MAX_CHUNK_SIZE * 0.3) {
      splitAt = segment.lastIndexOf(' ');
    }
    if (splitAt === -1 || splitAt < MAX_CHUNK_SIZE * 0.3) {
      splitAt = MAX_CHUNK_SIZE;
    }

    chunks.push(trimmed.slice(start, start + splitAt).trim());
    start += splitAt - CHUNK_OVERLAP;
    if (start < 0) start = 0;
  }

  return chunks.filter((c) => c.length > 0);
}
