import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { WebSearchHistoryStore } from './web-search-history.store';

function makeConfig(dbPath: string) {
  return {
    get: (key: string, fallback?: string) => {
      if (key === 'WEBSEARCH_DB_PATH') return dbPath;
      if (key === 'WORKSPACE_ROOT') return fallback ?? './data/workspaces';
      return fallback;
    },
  };
}

describe('WebSearchHistoryStore', () => {
  let tempDir: string | null = null;

  afterEach(() => {
    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true });
      tempDir = null;
    }
  });

  it('persists query and answer records across store instances', () => {
    tempDir = mkdtempSync(join(tmpdir(), 'kalio-websearch-'));
    const dbPath = join(tempDir, 'websearch.db');
    const first = new WebSearchHistoryStore(makeConfig(dbPath) as never);
    first.onModuleInit();

    const inserted = first.insert({
      query: 'Perplexity through OpenRouter pricing',
      answer: 'Pricing answer',
      citations: ['https://example.com/pricing'],
      model: 'perplexity/sonar',
      provider: 'perplexity-openrouter',
    });
    first.onModuleDestroy();

    const second = new WebSearchHistoryStore(makeConfig(dbPath) as never);
    second.onModuleInit();
    const results = second.search('OpenRouter Perplexity pricing', 5);
    second.onModuleDestroy();

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      id: inserted.id,
      query: 'Perplexity through OpenRouter pricing',
      answer: 'Pricing answer',
      citations: ['https://example.com/pricing'],
      model: 'perplexity/sonar',
      provider: 'perplexity-openrouter',
    });
    expect(results[0].score).toBeGreaterThan(0);
  });

  it('can exclude a just-inserted record from related history results', () => {
    tempDir = mkdtempSync(join(tmpdir(), 'kalio-websearch-'));
    const store = new WebSearchHistoryStore(makeConfig(join(tempDir, 'websearch.db')) as never);
    store.onModuleInit();

    const older = store.insert({
      query: 'TypeScript strict mode',
      answer: 'Older strict mode answer',
      citations: [],
      model: 'sonar',
      provider: 'perplexity',
    });
    const current = store.insert({
      query: 'TypeScript strict mode',
      answer: 'Current strict mode answer',
      citations: [],
      model: 'sonar',
      provider: 'perplexity',
    });

    const results = store.search('TypeScript strict mode', 5, current.id);
    store.onModuleDestroy();

    expect(results.map((result) => result.id)).toContain(older.id);
    expect(results.map((result) => result.id)).not.toContain(current.id);
  });
});