import { createSqliteDatabase } from '../../database/sqlite-runtime';
import fs from 'node:fs';
import path from 'node:path';
import type { EmbeddingSpace, MemorySearchResult } from '@kalio/types';
import type { VecEntry } from './vector-store.service';
import type { EmbeddingService } from './embedding.service';

export const MEMORY_KINDS = ['memory', 'conversation'] as const;
export type MemoryKind = typeof MEMORY_KINDS[number];
export const MEMORY_PROFILE_PREFIXES = ['local-transformers-', 'openai-compatible-', 'ollama-', 'disabled-', 'mock-'];

/** Text listing/FTS must not require an online embedding provider. */
export function currentStorageSpace(service: EmbeddingService): Pick<EmbeddingSpace, 'id' | 'dimensions'> {
  return service.getStatus().configured ? service.captureSpace()
    : { id: service.getProfileId(), dimensions: service.getDimensions() };
}

export function partitionPath(base: string, persona: string, profile: string, kind: MemoryKind): string {
  return path.join(base, `${persona}.${profile}.${kind}.db`);
}

/** Read text only: never initialize vec0 with the target model's dimensions. */
export function readMemorySource(dbPath: string): VecEntry[] {
  const db = createSqliteDatabase(dbPath, undefined, { readonly: true, fileMustExist: true }).client;
  try {
    const columns = db.prepare('PRAGMA table_info(memories)').all() as { name: string }[];
    if (!columns.length) return [];
    const model = columns.some(column => column.name === 'embedding_model') ? 'embedding_model' : "'' AS embedding_model";
    const rows = db.prepare(`SELECT id, content, metadata, ${model}, created_at FROM memories ORDER BY created_at DESC`).all() as {
      id: string; content: string; metadata: string; embedding_model: string; created_at: number;
    }[];
    return rows.map(row => ({ id: row.id, content: row.content,
      metadata: JSON.parse(row.metadata) as Record<string, string>,
      embeddingModel: row.embedding_model, createdAt: row.created_at }));
  } finally {
    db.close();
  }
}

export function listMemorySources(base: string, persona: string): { dbPath: string; kind?: MemoryKind }[] {
  if (!fs.existsSync(base)) return [];
  return fs.readdirSync(base).filter(file => file === `${persona}.db`
    || (MEMORY_PROFILE_PREFIXES.some(prefix => file.startsWith(`${persona}.${prefix}`)) && file.endsWith('.db'))).sort().map(file => ({
      dbPath: path.join(base, file),
      kind: MEMORY_KINDS.find(kind => file.endsWith(`.${kind}.db`)),
    }));
}

/** Rank fusion avoids comparing raw vector distances or BM25 across partitions. */
export function fuseMemoryRanks(lists: MemorySearchResult[][], limit: number): MemorySearchResult[] {
  const merged = new Map<string, MemorySearchResult>();
  for (const list of lists) list.forEach((entry, rank) => {
    const existing = merged.get(entry.id);
    const score = 1 / (60 + rank + 1);
    if (existing) existing.score += score;
    else merged.set(entry.id, { id: entry.id, content: entry.content, metadata: entry.metadata, createdAt: entry.createdAt, score });
  });
  return [...merged.values()].sort((a, b) => b.score - a.score).slice(0, limit);
}
