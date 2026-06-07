import { Logger } from '@nestjs/common';
import fs from 'node:fs';
import path from 'node:path';
import type { MemoryIngestResult, MemorySearchResult } from '@kalio/types';
import { EmbeddingService } from './embedding.service';
import { VectorStoreService } from './vector-store.service';
import type { WebSearchChunk } from './web-search-chunking';

const WEB_RESULTS_DB_NAME = 'web-results.db';
const RRF_K = 60;
const DELETE_RETRY_COUNT = 10;
const DELETE_RETRY_DELAY_MS = 50;

function isRetryableDeleteError(err: unknown): boolean {
  return err instanceof Error
    && 'code' in err
    && (err.code === 'EPERM' || err.code === 'EBUSY');
}

function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

export class WebResultsMemoryStore {
  private readonly logger = new Logger(WebResultsMemoryStore.name);
  private readonly stores = new Map<string, VectorStoreService>();

  constructor(
    private readonly dbBasePath: string,
    private readonly embeddingService: EmbeddingService,
  ) {}

  async ingest(chunks: WebSearchChunk[]): Promise<MemoryIngestResult> {
    if (!this.embeddingService.getStatus().configured) {
      return { ids: [], count: 0 };
    }
    if (chunks.length === 0) {
      return { ids: [], count: 0 };
    }

    const store = this.getStore();
    const ids: string[] = [];
    const embeddingModel = await this.embeddingService.getModelName();
    const embeddings = await this.embeddingService.embedBatch(chunks.map((chunk) => chunk.content));

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i]!;
      const id = `${chunk.webResultId}:${chunk.blockIndex}`;
      store.insert(
        id,
        embeddings[i]!,
        chunk.content,
        {
          namespace: 'web_search',
          chunk_version: 'v2',
          web_result_id: chunk.webResultId,
          block_type: chunk.blockType,
          block_index: String(chunk.blockIndex),
          citation_urls_json: JSON.stringify(chunk.citationUrls),
          heading_path_json: JSON.stringify(chunk.headingPath),
          query: chunk.query,
          provider: chunk.provider,
          model: chunk.model,
        },
        embeddingModel,
      );
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

  getAll(): MemorySearchResult[] {
    return this.getStore().getAll().map((entry) => ({
      id: entry.id,
      content: entry.content,
      score: 1,
      metadata: entry.metadata,
      createdAt: entry.createdAt,
    }));
  }

  count(): number {
    return this.getStore().count();
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

  currentDbExists(): boolean {
    return fs.existsSync(this.getCurrentDbPath());
  }

  deleteAllCurrentProfile(): void {
    this.getStore().deleteAll();
  }

  deleteCurrentDbFile(): string {
    const profileId = this.embeddingService.getProfileId();
    const dbPath = this.getDbPath(profileId);
    this.closeStoreForProfile(profileId);
    this.removeDbArtifact(dbPath);
    this.removeDbArtifact(`${dbPath}-wal`);
    this.removeDbArtifact(`${dbPath}-shm`);
    return dbPath;
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

  private closeStoreForProfile(profileId: string): void {
    const store = this.stores.get(profileId);
    if (!store) {
      return;
    }
    try {
      store.close();
    } finally {
      this.stores.delete(profileId);
    }
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

  private removeDbArtifact(targetPath: string): void {
    if (!fs.existsSync(targetPath)) {
      return;
    }

    for (let attempt = 1; attempt <= DELETE_RETRY_COUNT; attempt += 1) {
      try {
        fs.rmSync(targetPath, { force: true });
        return;
      } catch (err) {
        if (!isRetryableDeleteError(err) || attempt === DELETE_RETRY_COUNT) {
          throw err;
        }
        sleepSync(DELETE_RETRY_DELAY_MS);
      }
    }
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
