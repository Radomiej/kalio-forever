import { Logger } from '@nestjs/common';
import { nanoid } from 'nanoid';
import fs from 'node:fs';
import path from 'node:path';
import type { MemoryIngestResult, MemorySearchResult } from '@kalio/types';
import { EmbeddingService } from './embedding.service';
import { VectorStoreService } from './vector-store.service';

const WEB_RESULTS_DB_NAME = 'web-results.db';
const RRF_K = 60;

export class WebResultsMemoryStore {
  private readonly logger = new Logger(WebResultsMemoryStore.name);
  private readonly stores = new Map<string, VectorStoreService>();

  constructor(
    private readonly dbBasePath: string,
    private readonly embeddingService: EmbeddingService,
    private readonly splitText: (text: string) => string[],
  ) {}

  async ingest(text: string, metadata: Record<string, string> = {}): Promise<MemoryIngestResult> {
    if (!this.embeddingService.getStatus().configured) {
      return { ids: [], count: 0 };
    }

    const store = this.getStore();
    const chunks = this.splitText(text);
    const ids: string[] = [];
    const embeddingModel = await this.embeddingService.getModelName();
    const embeddings = await this.embeddingService.embedBatch(chunks);

    for (let i = 0; i < chunks.length; i++) {
      const id = nanoid();
      const chunk = chunks[i]!;
      store.insert(id, embeddings[i]!, chunk, { ...metadata, namespace: 'web_search', chunk_index: String(i) }, embeddingModel);
      ids.push(id);
    }

    this.logger.log(`Ingested ${chunks.length} web result chunks`);
    return { ids, count: ids.length };
  }

  async search(query: string, limit = 5): Promise<MemorySearchResult[]> {
    if (!this.embeddingService.getStatus().configured) {
      return [];
    }

    const store = this.getStore();
    if (store.count() === 0) {
      return [];
    }

    const fetchLimit = Math.max(limit * 3, 20);
    const [vectorResults, ftsResults] = await Promise.all([
      (async () => store.search(await this.embeddingService.embedOne(query), fetchLimit))(),
      Promise.resolve(store.searchFTS(query, fetchLimit)),
    ]);

    const scoreMap = new Map<string, { score: number; content: string; metadata: Record<string, string>; createdAt: number }>();
    for (let rank = 0; rank < vectorResults.length; rank++) {
      const r = vectorResults[rank]!;
      scoreMap.set(r.id, {
        score: 1 / (RRF_K + rank + 1),
        content: r.content,
        metadata: r.metadata,
        createdAt: r.createdAt,
      });
    }
    for (let rank = 0; rank < ftsResults.length; rank++) {
      const r = ftsResults[rank]!;
      const existing = scoreMap.get(r.id);
      if (existing) {
        existing.score += 1 / (RRF_K + rank + 1);
      } else {
        scoreMap.set(r.id, {
          score: 1 / (RRF_K + rank + 1),
          content: r.content,
          metadata: r.metadata,
          createdAt: r.createdAt,
        });
      }
    }

    return Array.from(scoreMap.entries())
      .map(([id, data]) => ({
        id,
        content: data.content,
        score: data.score,
        metadata: data.metadata,
        createdAt: data.createdAt,
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  async reembed(): Promise<{ count: number; model: string }> {
    if (!this.embeddingService.getStatus().configured) {
      return { count: 0, model: await this.embeddingService.getModelName() };
    }

    const currentProfileId = this.embeddingService.getProfileId();
    const profileIds = Array.from(new Set([...this.listProfileIds(), currentProfileId]));
    const entriesById = new Map<string, ReturnType<VectorStoreService['getAll']>[number]>();

    for (const profileId of profileIds) {
      const dbPath = this.getDbPath(profileId);
      if (profileId !== currentProfileId && !fs.existsSync(dbPath)) continue;
      for (const entry of this.getStoreForProfile(profileId).getAll()) {
        entriesById.set(entry.id, entry);
      }
    }

    const entries = Array.from(entriesById.values());
    if (entries.length === 0) {
      return { count: 0, model: await this.embeddingService.getModelName() };
    }

    const store = this.getStoreForProfile(currentProfileId);
    const model = await this.embeddingService.getModelName();
    const embeddings = await this.embeddingService.embedBatch(entries.map((entry) => entry.content));

    for (let index = 0; index < entries.length; index++) {
      const entry = entries[index]!;
      store.insert(entry.id, embeddings[index]!, entry.content, entry.metadata, model);
    }

    this.logger.log(`Re-embedded ${entries.length} web result memories using ${model}`);
    return { count: entries.length, model };
  }

  getCurrentDbPath(): string {
    return this.getDbPath(this.embeddingService.getProfileId());
  }

  close(): void {
    for (const [profileId, store] of this.stores) {
      try {
        store.close();
        this.logger.debug(`Closed web results store ${profileId}`);
      } catch (err) {
        this.logger.error(`Error closing web results store ${profileId}`, err);
      }
    }
    this.stores.clear();
  }

  private getStore(): VectorStoreService {
    return this.getStoreForProfile(this.embeddingService.getProfileId());
  }

  private getStoreForProfile(profileId: string): VectorStoreService {
    const existing = this.stores.get(profileId);
    if (existing) return existing;

    const store = new VectorStoreService(this.getDbPath(profileId), this.embeddingService.getDimensions());
    this.stores.set(profileId, store);
    return store;
  }

  private getDbPath(profileId: string): string {
    return path.join(this.dbBasePath, profileId, WEB_RESULTS_DB_NAME);
  }

  private listProfileIds(): string[] {
    if (!fs.existsSync(this.dbBasePath)) return [];

    return fs.readdirSync(this.dbBasePath)
      .filter((entry) => {
        const fullPath = path.join(this.dbBasePath, entry);
        return fs.statSync(fullPath).isDirectory()
          && fs.existsSync(path.join(fullPath, WEB_RESULTS_DB_NAME));
      });
  }
}
