import { Injectable, Logger } from '@nestjs/common';
import Database from 'better-sqlite3';
import * as sqliteVec from 'sqlite-vec';
import path from 'node:path';
import fs from 'node:fs';

// ── Interfaces ──────────────────────────────────────────────────────────────

export interface VecSearchResult {
  id: string;
  content: string;
  metadata: Record<string, string>;
  distance: number;
  createdAt: number;
}

export interface FtsSearchResult {
  id: string;
  content: string;
  metadata: Record<string, string>;
  bm25Score: number;
  createdAt: number;
}

export interface VecEntry {
  id: string;
  content: string;
  metadata: Record<string, string>;
  embeddingModel: string;
  createdAt: number;
}

// ── VectorStoreService ───────────────────────────────────────────────────────

@Injectable()
export class VectorStoreService {
  private readonly logger = new Logger(VectorStoreService.name);
  private db: Database.Database;
  private readonly dimensions: number;

  constructor(dbPath: string, dimensions: number) {
    this.dimensions = dimensions;

    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    this.db = new Database(dbPath);
    sqliteVec.load(this.db);

    this.initSchema();
    this.logger.debug(`Initialized vector store: ${dbPath}, dimensions: ${dimensions}`);
  }

  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS memories (
        id TEXT PRIMARY KEY,
        content TEXT NOT NULL,
        metadata TEXT NOT NULL DEFAULT '{}',
        embedding_model TEXT NOT NULL DEFAULT '',
        created_at INTEGER NOT NULL
      )
    `);

    // Migrate existing DBs that were created before embedding_model column was added
    try {
      this.db.exec(`ALTER TABLE memories ADD COLUMN embedding_model TEXT NOT NULL DEFAULT ''`);
    } catch {
      // Column already exists — ignore
    }

    this.db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS memories_vec USING vec0(
        id TEXT PRIMARY KEY,
        embedding float[${this.dimensions}]
      )
    `);

    this.db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
        id UNINDEXED,
        content,
        tokenize='porter unicode61'
      )
    `);
  }

  insert(id: string, embedding: number[], content: string, metadata: Record<string, string> = {}, embeddingModel = ''): void {
    const now = Date.now();
    const vecBuffer = new Float32Array(embedding);

    const insertMeta = this.db.prepare(
      'INSERT OR REPLACE INTO memories (id, content, metadata, embedding_model, created_at) VALUES (?, ?, ?, ?, ?)'
    );
    const deleteVec = this.db.prepare('DELETE FROM memories_vec WHERE id = ?');
    const insertVec = this.db.prepare(
      'INSERT INTO memories_vec (id, embedding) VALUES (?, ?)'
    );
    const deleteFts = this.db.prepare('DELETE FROM memories_fts WHERE id = ?');
    const insertFts = this.db.prepare(
      'INSERT INTO memories_fts (id, content) VALUES (?, ?)'
    );

    const transaction = this.db.transaction(() => {
      insertMeta.run(id, content, JSON.stringify(metadata), embeddingModel, now);
      deleteVec.run(id);
      insertVec.run(id, vecBuffer);
      deleteFts.run(id);
      insertFts.run(id, content);
    });
    transaction();
  }

  search(queryEmbedding: number[], limit = 5): VecSearchResult[] {
    const vecBuffer = new Float32Array(queryEmbedding);
    const safeLimit = Math.min(limit, 4096);

    const rows = this.db
      .prepare(
        `SELECT v.id, v.distance, m.content, m.metadata, m.created_at
         FROM memories_vec v
         JOIN memories m ON m.id = v.id
         WHERE v.embedding MATCH ? AND k = ?
         ORDER BY v.distance`
      )
      .all(vecBuffer, safeLimit) as Array<{
        id: string;
        distance: number;
        content: string;
        metadata: string;
        created_at: number;
      }>;

    return rows.map((r) => ({
      id: r.id,
      content: r.content,
      metadata: JSON.parse(r.metadata) as Record<string, string>,
      distance: r.distance,
      createdAt: r.created_at,
    }));
  }

  searchFTS(query: string, limit = 5): FtsSearchResult[] {
    try {
      const rows = this.db
        .prepare(
          `SELECT f.id, f.rank AS bm25_score, m.content, m.metadata, m.created_at
           FROM memories_fts f
           JOIN memories m ON m.id = f.id
           WHERE f.content MATCH ?
           ORDER BY f.rank
           LIMIT ?`
        )
        .all(query, limit) as Array<{
          id: string;
          bm25_score: number;
          content: string;
          metadata: string;
          created_at: number;
        }>;

      return rows.map((r) => ({
        id: r.id,
        content: r.content,
        metadata: JSON.parse(r.metadata) as Record<string, string>,
        bm25Score: r.bm25_score,
        createdAt: r.created_at,
      }));
    } catch {
      return [];
    }
  }

  delete(id: string): boolean {
    const deleteMeta = this.db.prepare('DELETE FROM memories WHERE id = ?');
    const deleteVec = this.db.prepare('DELETE FROM memories_vec WHERE id = ?');
    const deleteFts = this.db.prepare('DELETE FROM memories_fts WHERE id = ?');

    let changed = false;
    const transaction = this.db.transaction(() => {
      const result = deleteMeta.run(id);
      changed = result.changes > 0;
      deleteVec.run(id);
      deleteFts.run(id);
    });
    transaction();
    return changed;
  }

  getAll(): VecEntry[] {
    const rows = this.db
      .prepare('SELECT id, content, metadata, embedding_model, created_at FROM memories ORDER BY created_at DESC')
      .all() as Array<{
        id: string;
        content: string;
        metadata: string;
        embedding_model: string;
        created_at: number;
      }>;

    return rows.map((r) => ({
      id: r.id,
      content: r.content,
      metadata: JSON.parse(r.metadata) as Record<string, string>,
      embeddingModel: r.embedding_model,
      createdAt: r.created_at,
    }));
  }

  count(): number {
    const row = this.db.prepare('SELECT COUNT(*) as cnt FROM memories').get() as { cnt: number };
    return row.cnt;
  }

  totalContentSize(): number {
    const row = this.db.prepare('SELECT COALESCE(SUM(LENGTH(content)), 0) as total FROM memories').get() as {
      total: number;
    };
    return row.total;
  }

  deleteAll(): void {
    const transaction = this.db.transaction(() => {
      this.db.exec('DELETE FROM memories');
      this.db.exec('DELETE FROM memories_vec');
      this.db.exec('DELETE FROM memories_fts');
    });
    transaction();
  }

  close(): void {
    this.db.close();
  }
}
