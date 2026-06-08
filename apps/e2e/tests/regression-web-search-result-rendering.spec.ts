import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { API_BASE } from './helpers/test-config';

type SeedStatement = {
  run: (...params: unknown[]) => unknown;
};

type SeedDb = {
  pragma: (sql: string) => unknown;
  prepare: (sql: string) => SeedStatement;
  transaction: (fn: () => void) => () => void;
  close: () => void;
};

interface SeededWebSearchFixture {
  sessionId: string;
  title: string;
}

const requireBackend = createRequire(resolve(__dirname, '../../kalio-api/package.json'));
const BetterSqlite3 = requireBackend('better-sqlite3') as new (path: string) => SeedDb;
const PROCESS_ENV = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env;
const API_DIR = resolve(__dirname, '../../kalio-api');
const configuredDatabasePath = PROCESS_ENV?.DATABASE_PATH?.trim();
const DB_PATH = configuredDatabasePath
  ? resolve(API_DIR, configuredDatabasePath)
  : resolve(API_DIR, 'data/kalio.db');

function openDb(): SeedDb {
  mkdirSync(dirname(DB_PATH), { recursive: true });
  const db = new BetterSqlite3(DB_PATH);
  db.pragma('foreign_keys = ON');
  return db;
}

function seedWebSearchFixture(): SeededWebSearchFixture {
  const stamp = Date.now();
  const fixture: SeededWebSearchFixture = {
    sessionId: `e2e-web-search-${stamp}`,
    title: `E2E web search renderer ${stamp}`,
  };

  const toolResultPayload = {
    answer: [
      '[1] Release Notes',
      'Chunk by paragraph boundaries and keep source URLs per block.',
      'Sources: https://docs.example.com/chunking',
    ].join('\n'),
    citations: [
      'https://docs.example.com/chunking',
      'https://docs.example.com/citations',
    ],
    model: 'persona-memory',
    provider: 'memory',
    offline: true,
    memory: {
      ids: ['wr-1:0', 'wr-1:1'],
      count: 2,
    },
    results: [
      {
        content: 'Chunk by paragraph boundaries instead of slicing in the middle of the text block.',
        citationUrls: ['https://docs.example.com/chunking'],
        blockType: 'paragraph',
        headingPath: ['Release Notes'],
        webResultId: 'wr-1',
        blockIndex: 0,
        query: 'web search chunking',
        provider: 'perplexity',
        model: 'sonar-pro',
      },
      {
        content: '- Keep citations attached to every returned chunk.\n- Prefer heading-aware recall when a section path exists.',
        citationUrls: [
          'https://docs.example.com/chunking',
          'https://docs.example.com/citations',
        ],
        blockType: 'list',
        headingPath: ['Release Notes', 'Implementation'],
        webResultId: 'wr-1',
        blockIndex: 1,
        query: 'web search chunking',
        provider: 'perplexity',
        model: 'sonar-pro',
      },
    ],
  };

  const db = openDb();
  try {
    const insertSession = db.prepare(
      `INSERT INTO sessions (
        id, persona_id, title, kind, parent_session_id, parent_turn_id, parent_tool_call_id, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const insertMessage = db.prepare(
      `INSERT INTO messages (
        id, session_id, role, content, thinking, tool_calls, tool_call_id, attachments, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );

    const seed = db.transaction(() => {
      insertSession.run(fixture.sessionId, 'default', fixture.title, 'chat', null, null, null, stamp, stamp + 400);

      insertMessage.run(
        `user-${stamp}`,
        fixture.sessionId,
        'user',
        'Show the stored web research about chunking quality.',
        null,
        null,
        null,
        null,
        stamp + 10,
      );
      insertMessage.run(
        `assistant-tools-${stamp}`,
        fixture.sessionId,
        'assistant',
        'I pulled the stored web research result with chunk-level sources.',
        null,
        JSON.stringify([
          {
            id: 'call-web-search',
            name: 'web_search',
            args: {
              query: 'web search chunking',
              offline_search: true,
            },
          },
        ]),
        null,
        null,
        stamp + 20,
      );
      insertMessage.run(
        `tool-result-${stamp}`,
        fixture.sessionId,
        'tool_result',
        JSON.stringify(toolResultPayload),
        null,
        null,
        'call-web-search',
        null,
        stamp + 30,
      );
      insertMessage.run(
        `assistant-final-${stamp}`,
        fixture.sessionId,
        'assistant',
        'The stored results now render as semantic blocks with attached source links.',
        null,
        null,
        null,
        null,
        stamp + 40,
      );
    });

    seed();
    return fixture;
  } finally {
    db.close();
  }
}

function cleanupFixture(fixture: SeededWebSearchFixture): void {
  const db = openDb();
  try {
    const removeMessages = db.prepare('DELETE FROM messages WHERE session_id = ?');
    const removeSession = db.prepare('DELETE FROM sessions WHERE id = ?');

    const cleanup = db.transaction(() => {
      removeMessages.run(fixture.sessionId);
      removeSession.run(fixture.sessionId);
    });

    cleanup();
  } finally {
    db.close();
  }
}

test.describe('REGRESSION: web_search tool result rendering', () => {
  let fixture: SeededWebSearchFixture | null = null;

  test.afterEach(() => {
    if (!fixture) return;
    cleanupFixture(fixture);
    fixture = null;
  });

  test('renders semantic web_search chunks with attached source links', async ({ page }, testInfo) => {
    const wipeResponse = await page.request.delete(`${API_BASE}/memory/web-search/dev-db`);
    expect(wipeResponse.ok()).toBeTruthy();

    fixture = seedWebSearchFixture();

    await page.goto('/');
    await page.getByTestId('nav-talk').click();

    const sessionItem = page.locator(`[data-testid="session-item"][data-session-id="${fixture.sessionId}"]`);
    await expect(sessionItem).toBeVisible({ timeout: 5_000 });
    await sessionItem.click();

    const toolBubble = page.locator('[data-testid="tool-call-bubble"][data-tool-name="web_search"]');
    await expect(toolBubble).toBeVisible({ timeout: 5_000 });
    await expect(toolBubble.getByTestId('web-search-result-renderer')).toBeVisible();
    await expect(toolBubble).toContainText('offline memory');
    await expect(toolBubble).toContainText('Chunk by paragraph boundaries instead of slicing in the middle of the text block.');
    await expect(toolBubble).toContainText('Release Notes > Implementation');
    await expect(toolBubble.locator('a[href="https://docs.example.com/chunking"]')).toHaveCount(2);
    await expect(toolBubble.locator('a[href="https://docs.example.com/citations"]')).toHaveCount(1);
    await expect(toolBubble).not.toContainText('"citationUrls"');

    await testInfo.attach('web-search-renderer', {
      body: await page.screenshot({ fullPage: true }),
      contentType: 'image/png',
    });
  });
});
