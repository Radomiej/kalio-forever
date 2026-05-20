import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { SearchProvider } from './web-search.service';

export interface WebSearchHistoryInsert {
  query: string;
  answer: string;
  citations: string[];
  model: string;
  provider: SearchProvider;
}

export interface HistoricalWebSearchResult extends WebSearchHistoryInsert {
  id: string;
  createdAt: number;
  score: number;
}

interface WebSearchHistoryRow {
  id: string;
  query: string;
  answer: string;
  citations_json: string;
  model: string;
  provider: string;
  created_at: number;
}

const RECENT_SCAN_LIMIT = 500;

@Injectable()
export class WebSearchHistoryStore implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WebSearchHistoryStore.name);
  private db: Database.Database | null = null;

  constructor(private readonly configService: ConfigService) {}

  onModuleInit(): void {
    if (this.db) return;

    const dbPath = this.resolveDbPath();
    mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.initSchema();
    this.logger.log(`Web search history database connected: ${dbPath}`);
  }

  onModuleDestroy(): void {
    if (!this.db) return;

    this.db.close();
    this.db = null;
  }

  insert(entry: WebSearchHistoryInsert): HistoricalWebSearchResult {
    const db = this.getDb();
    const id = randomUUID();
    const createdAt = Date.now();

    db.prepare(
      `INSERT INTO web_search_history
       (id, query, answer, citations_json, model, provider, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      entry.query,
      entry.answer,
      JSON.stringify(entry.citations),
      entry.model,
      entry.provider,
      createdAt,
    );

    return { id, ...entry, createdAt, score: 1 };
  }

  search(query: string, limit = 5, excludeId?: string): HistoricalWebSearchResult[] {
    const db = this.getDb();
    const normalizedLimit = Math.min(Math.max(limit, 1), 20);
    const rows = db
      .prepare(
        `SELECT id, query, answer, citations_json, model, provider, created_at
         FROM web_search_history
         WHERE (? IS NULL OR id != ?)
         ORDER BY created_at DESC
         LIMIT ?`,
      )
      .all(excludeId ?? null, excludeId ?? null, RECENT_SCAN_LIMIT) as WebSearchHistoryRow[];

    return rows
      .map((row) => ({ row, score: this.score(query, row) }))
      .filter((item) => item.score > 0)
      .sort((left, right) => right.score - left.score || right.row.created_at - left.row.created_at)
      .slice(0, normalizedLimit)
      .map(({ row, score }) => this.toResult(row, score));
  }

  private resolveDbPath(): string {
    const configuredPath = this.configService.get<string>('WEBSEARCH_DB_PATH');
    if (configuredPath?.trim()) return configuredPath.trim();

    const appData = process.env['APPDATA'];
    if (appData?.trim()) return join(appData, 'Kalio', 'websearch.db');

    const workspaceRoot = this.configService.get<string>('WORKSPACE_ROOT', './data/workspaces') ?? './data/workspaces';
    return join(workspaceRoot, 'websearch.db');
  }

  private initSchema(): void {
    this.getDb().exec(`
      CREATE TABLE IF NOT EXISTS web_search_history (
        id TEXT PRIMARY KEY,
        query TEXT NOT NULL,
        answer TEXT NOT NULL,
        citations_json TEXT NOT NULL DEFAULT '[]',
        model TEXT NOT NULL,
        provider TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_web_search_history_created_at
        ON web_search_history(created_at);
      CREATE INDEX IF NOT EXISTS idx_web_search_history_query
        ON web_search_history(query);
    `);
  }

  private getDb(): Database.Database {
    if (!this.db) this.onModuleInit();
    if (!this.db) throw new Error('WEBSEARCH_HISTORY_DB_UNAVAILABLE');
    return this.db;
  }

  private score(query: string, row: WebSearchHistoryRow): number {
    const queryTokens = tokenize(query);
    if (queryTokens.length === 0) return 0;

    const textTokens = new Set([...tokenize(row.query), ...tokenize(row.answer)]);
    const matches = queryTokens.filter((token) => textTokens.has(token)).length;
    const tokenScore = matches / queryTokens.length;
    const normalizedNeedle = normalizeText(query);
    const normalizedRowQuery = normalizeText(row.query);
    const phraseBoost = normalizedRowQuery.includes(normalizedNeedle) || normalizedNeedle.includes(normalizedRowQuery) ? 0.5 : 0;

    return Math.min(1, tokenScore + phraseBoost);
  }

  private toResult(row: WebSearchHistoryRow, score: number): HistoricalWebSearchResult {
    return {
      id: row.id,
      query: row.query,
      answer: row.answer,
      citations: this.parseCitations(row.citations_json, row.id),
      model: row.model,
      provider: row.provider === 'perplexity-openrouter' ? 'perplexity-openrouter' : 'perplexity',
      createdAt: row.created_at,
      score,
    };
  }

  private parseCitations(value: string, id: string): string[] {
    try {
      const parsed = JSON.parse(value) as unknown;
      if (!Array.isArray(parsed)) return [];
      return parsed.filter((item): item is string => typeof item === 'string');
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      this.logger.error(`Failed to parse web search citations for history id=${id}`, error);
      return [];
    }
  }
}

function normalizeText(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9\s]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function tokenize(value: string): string[] {
  const normalized = normalizeText(value);
  if (!normalized) return [];
  return normalized.split(' ').filter((token) => token.length > 2);
}