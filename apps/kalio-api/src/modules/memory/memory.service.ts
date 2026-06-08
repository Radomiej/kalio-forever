import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { nanoid } from 'nanoid';
import fs from 'node:fs';
import path from 'node:path';
import type { MemoryIngestResult, MemoryScopeSummary, MemorySearchResult } from '@kalio/types';
import { EmbeddingService } from './embedding.service';
import { VectorStoreService } from './vector-store.service';
import { AppSettingsService } from '../../database/app-settings.service';
import { WebResultsMemoryStore } from './web-results-memory.store';
import { buildMemoryScopeSummary } from './memory-summary.utils';
import type { WebSearchChunk } from './web-search-chunking';

// ── Text splitting constants ────────────────────────────────────────────────

const MAX_CHUNK_SIZE = 1500;
const CHUNK_OVERLAP = 200;
const PROFILE_PREFIXES = ['local-transformers-', 'openai-compatible-', 'ollama-', 'disabled-'];

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

  private getStore(personaId: string): VectorStoreService {
    const profileId = this.embeddingService.getProfileId();
    return this.getStoreForProfile(personaId, profileId);
  }

  private getStoreForProfile(personaId: string, profileId: string): VectorStoreService {
    const storeKey = `${personaId}:${profileId}`;
    const existing = this.stores.get(storeKey);
    if (existing) return existing;

    const dbPath = path.join(this.dbBasePath, `${personaId}.${profileId}.db`);
    const dimensions = this.embeddingService.getDimensions();
    const store = new VectorStoreService(dbPath, dimensions);
    this.stores.set(storeKey, store);
    return store;
  }

  private getProfileDbPath(personaId: string, profileId: string): string {
    return path.join(this.dbBasePath, `${personaId}.${profileId}.db`);
  }

  private getLegacyDbPath(personaId: string): string {
    return path.join(this.dbBasePath, `${personaId}.db`);
  }

  private listPersonaProfileIds(personaId: string): string[] {
    if (!fs.existsSync(this.dbBasePath)) return [];

    const prefix = `${personaId}.`;
    return fs.readdirSync(this.dbBasePath)
      .filter((file) => file.startsWith(prefix) && file.endsWith('.db'))
      .map((file) => file.slice(prefix.length, -'.db'.length))
      .filter((profileId) => profileId.length > 0);
  }

  listIndexedPersonaIds(): string[] {
    if (!fs.existsSync(this.dbBasePath)) return [];

    const ids = new Set<string>();
    for (const file of fs.readdirSync(this.dbBasePath)) {
      if (!file.endsWith('.db')) continue;
      const withoutExt = file.slice(0, -'.db'.length);
      if (!PROFILE_PREFIXES.some((prefix) => withoutExt.includes(`.${prefix}`))) {
        ids.add(withoutExt);
        continue;
      }
      for (const prefix of PROFILE_PREFIXES) {
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

    const store = this.getStore(personaId);
    const chunks = splitTextIntoChunks(text);
    const ids: string[] = [];
    const embeddingModel = await this.embeddingService.getModelName();

    const embeddings = await this.embeddingService.embedBatch(chunks);

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

    const store = this.getStore(personaId);
    const ids: string[] = [];
    const embeddingModel = await this.embeddingService.getModelName();
    const embeddings = await this.embeddingService.embedBatch(blocks);

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

    const store = this.getStore(personaId);

    if (store.count() === 0) {
      return [];
    }

    const queryEmbedding = await this.embeddingService.embedOne(query);
    const results = store.search(queryEmbedding, limit);

    return results.map((r) => ({
      id: r.id,
      content: r.content,
      score: 1 / (1 + r.distance),
      metadata: r.metadata,
      createdAt: r.createdAt,
    }));
  }

  searchFTS(query: string, personaId: string, limit = 5): MemorySearchResult[] {
    const store = this.getStore(personaId);

    if (store.count() === 0) {
      return [];
    }

    const results = store.searchFTS(query, limit);

    return results.map((r) => ({
      id: r.id,
      content: r.content,
      score: r.bm25Score === 0 ? 1 : 1 / (1 + Math.abs(r.bm25Score)),
      metadata: r.metadata,
      createdAt: r.createdAt,
    }));
  }

  async hybridSearch(
    query: string,
    personaId: string,
    limit = 5
  ): Promise<MemorySearchResult[]> {
    if (!this.embeddingService.getStatus().configured) {
      return [];
    }

    const store = this.getStore(personaId);

    if (store.count() === 0) {
      return [];
    }

    const RRF_K = 60;
    const fetchLimit = Math.max(limit * 3, 20);

    const [vectorResults, ftsResults] = await Promise.all([
      (async () => {
        const queryEmbedding = await this.embeddingService.embedOne(query);
        return store.search(queryEmbedding, fetchLimit);
      })(),
      Promise.resolve(store.searchFTS(query, fetchLimit)),
    ]);

    const scoreMap = new Map<string, { score: number; content: string; metadata: Record<string, string>; createdAt: number }>();

    for (let rank = 0; rank < vectorResults.length; rank++) {
      const r = vectorResults[rank]!;
      const rrfScore = 1 / (RRF_K + rank + 1);
      scoreMap.set(r.id, {
        score: rrfScore,
        content: r.content,
        metadata: r.metadata,
        createdAt: r.createdAt,
      });
    }

    for (let rank = 0; rank < ftsResults.length; rank++) {
      const r = ftsResults[rank]!;
      const rrfScore = 1 / (RRF_K + rank + 1);
      const existing = scoreMap.get(r.id);
      if (existing) {
        existing.score += rrfScore;
      } else {
        scoreMap.set(r.id, {
          score: rrfScore,
          content: r.content,
          metadata: r.metadata,
          createdAt: r.createdAt,
        });
      }
    }

    const merged = Array.from(scoreMap.entries())
      .map(([id, data]) => ({
        id,
        content: data.content,
        score: data.score,
        metadata: data.metadata,
        createdAt: data.createdAt,
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);

    return merged;
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

  private async reembedMemoryId(personaId: string): Promise<{ count: number; model: string }> {
    if (!this.embeddingService.getStatus().configured) {
      return { count: 0, model: await this.embeddingService.getModelName() };
    }

    const currentProfileId = this.embeddingService.getProfileId();
    const profileIds = Array.from(new Set([...this.listPersonaProfileIds(personaId), currentProfileId]));
    const entriesById = new Map<string, ReturnType<VectorStoreService['getAll']>[number]>();

    const legacyDbPath = this.getLegacyDbPath(personaId);
    if (fs.existsSync(legacyDbPath)) {
      const legacyStore = new VectorStoreService(legacyDbPath, this.embeddingService.getDimensions());
      try {
        for (const entry of legacyStore.getAll()) {
          entriesById.set(entry.id, entry);
        }
      } finally {
        legacyStore.close();
      }
    }

    for (const profileId of profileIds) {
      const dbPath = this.getProfileDbPath(personaId, profileId);
      if (profileId !== currentProfileId && !fs.existsSync(dbPath)) continue;
      const sourceStore = this.getStoreForProfile(personaId, profileId);
      for (const entry of sourceStore.getAll()) {
        entriesById.set(entry.id, entry);
      }
    }

    const entries = Array.from(entriesById.values());

    if (entries.length === 0) {
      return { count: 0, model: await this.embeddingService.getModelName() };
    }

    const store = this.getStoreForProfile(personaId, currentProfileId);
    const model = await this.embeddingService.getModelName();
    const embeddings = await this.embeddingService.embedBatch(entries.map((entry) => entry.content));

    for (let index = 0; index < entries.length; index++) {
      const entry = entries[index]!;
      const embedding = embeddings[index]!;
      store.insert(entry.id, embedding, entry.content, entry.metadata, model);
    }

    this.logger.log(`Re-embedded ${entries.length} memories for persona ${personaId} using ${model}`);
    return { count: entries.length, model };
  }

  async reembedAll(): Promise<{ personas: number; count: number; model: string }> {
    const personaIds = this.listIndexedPersonaIds();
    let count = 0;

    for (const personaId of personaIds) {
      const result = await this.reembedMemoryId(personaId);
      count += result.count;
    }

    const webResult = await this.webResults.reembed();
    count += webResult.count;

    return { personas: personaIds.length, count, model: webResult.model };
  }

  getAll(personaId: string): MemorySearchResult[] {
    const store = this.getStore(personaId);
    return store.getAll().map((e) => ({
      id: e.id,
      content: e.content,
      score: 1,
      metadata: e.metadata,
      createdAt: e.createdAt,
    }));
  }

  delete(id: string, personaId: string): boolean {
    const store = this.getStore(personaId);
    return store.delete(id);
  }

  deleteAll(personaId: string): void {
    for (const profileId of this.listPersonaProfileIds(personaId)) {
      this.getStoreForProfile(personaId, profileId).deleteAll();
    }
    this.getStore(personaId).deleteAll();

    const legacyDbPath = this.getLegacyDbPath(personaId);
    if (fs.existsSync(legacyDbPath)) {
      const legacyStore = new VectorStoreService(legacyDbPath, this.embeddingService.getDimensions());
      try {
        legacyStore.deleteAll();
      } finally {
        legacyStore.close();
      }
    }
  }

  count(personaId: string): number {
    const store = this.getStore(personaId);
    return store.count();
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
