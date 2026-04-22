import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { nanoid } from 'nanoid';
import path from 'node:path';
import type { MemoryIngestResult, MemorySearchResult } from '@kalio/types';
import { EmbeddingService } from './embedding.service';
import { VectorStoreService } from './vector-store.service';

// ── Text splitting constants ────────────────────────────────────────────────

const MAX_CHUNK_SIZE = 1500;
const CHUNK_OVERLAP = 200;

// ── MemoryService ───────────────────────────────────────────────────────────

@Injectable()
export class MemoryService implements OnModuleDestroy {
  private readonly logger = new Logger(MemoryService.name);
  private readonly embeddingService: EmbeddingService;
  private readonly stores = new Map<string, VectorStoreService>();
  private readonly dbBasePath: string;

  constructor(private readonly config: ConfigService) {
    this.embeddingService = new EmbeddingService(config);
    this.dbBasePath = this.config.get<string>('MEMORY_DB_PATH', './data/memory');
    this.logger.log(`MemoryService initialized: ${this.dbBasePath}`);
  }

  getEmbeddingService(): EmbeddingService {
    return this.embeddingService;
  }

  private getStore(personaId: string): VectorStoreService {
    const existing = this.stores.get(personaId);
    if (existing) return existing;

    const dbPath = path.join(this.dbBasePath, `${personaId}.db`);
    const dimensions = this.embeddingService.getDimensions();
    const store = new VectorStoreService(dbPath, dimensions);
    this.stores.set(personaId, store);
    return store;
  }

  async ingest(
    text: string,
    personaId: string,
    metadata: Record<string, string> = {}
  ): Promise<MemoryIngestResult> {
    const store = this.getStore(personaId);
    const chunks = splitTextIntoChunks(text);
    const ids: string[] = [];

    const embeddings = await this.embeddingService.embedBatch(chunks);

    for (let i = 0; i < chunks.length; i++) {
      const id = nanoid();
      const chunk = chunks[i]!;
      const embedding = embeddings[i]!;
      store.insert(id, embedding, chunk, { ...metadata, chunk_index: String(i) });
      ids.push(id);
    }

    this.logger.log(`Ingested ${chunks.length} chunks for persona ${personaId}`);
    return { ids, count: ids.length };
  }

  async ingestConversation(
    messages: Array<{ role: string; content: string }>,
    personaId: string
  ): Promise<MemoryIngestResult> {
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
    const embeddings = await this.embeddingService.embedBatch(blocks);

    for (let i = 0; i < blocks.length; i++) {
      const id = nanoid();
      store.insert(id, embeddings[i]!, blocks[i]!, {
        source: 'conversation',
        block_index: String(i),
      });
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
    const store = this.getStore(personaId);
    store.deleteAll();
  }

  count(personaId: string): number {
    const store = this.getStore(personaId);
    return store.count();
  }

  onModuleDestroy(): void {
    this.logger.log('Shutting down MemoryService');
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
    let end = start + MAX_CHUNK_SIZE;

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
