import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { API_BASE, deleteSessionIfExists, selectSession, selectSessionOriginFilter } from './helpers/test-config';

type SeedStatement = {
  get?: (...params: unknown[]) => unknown;
  run: (...params: unknown[]) => unknown;
};

type SeedDb = {
  pragma: (sql: string) => unknown;
  prepare: (sql: string) => SeedStatement;
  transaction: (fn: () => void) => () => void;
  close: () => void;
};

interface SeededRuntimeAttentionFixture {
  timeoutHostSessionId: string;
  timeoutSessionId: string;
  timeoutTitle: string;
  budgetHostSessionId: string;
  budgetSessionId: string;
  budgetTitle: string;
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

function sessionExistsInDb(sessionId: string): boolean {
  const db = openDb();
  try {
    return Boolean(db.prepare('SELECT id FROM sessions WHERE id = ?').get?.(sessionId));
  } finally {
    db.close();
  }
}

function seedRuntimeAttentionMessages(fixture: SeededRuntimeAttentionFixture): void {
  const stamp = Date.now();
  const db = openDb();

  try {
    const insertMessage = db.prepare(
      `INSERT INTO messages (
        id, session_id, role, content, thinking, tool_calls, tool_call_id, attachments, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );

    const seed = db.transaction(() => {
      insertMessage.run(
        `timeout-user-${stamp}`,
        fixture.timeoutSessionId,
        'user',
        'Inspect the architecture branch and continue only with visible evidence.',
        null,
        null,
        null,
        null,
        stamp + 10,
      );
      insertMessage.run(
        `timeout-assistant-${stamp}`,
        fixture.timeoutSessionId,
        'assistant',
        'Sub-agent failed: Sub-agent timed out after 300000ms.',
        null,
        null,
        null,
        null,
        stamp + 20,
      );
      insertMessage.run(
        `timeout-tool-result-${stamp}`,
        fixture.timeoutSessionId,
        'tool_result',
        JSON.stringify({
          status: 'failed',
          toolResultErrorCode: 'SUBAGENT_TIMEOUT',
          toolResultErrorMessage: 'Sub-agent timed out after 300000ms.',
        }),
        null,
        null,
        'timeout-tool-call',
        null,
        stamp + 30,
      );

      insertMessage.run(
        `budget-user-${stamp}`,
        fixture.budgetSessionId,
        'user',
        'Keep reviewing until the branch can justify a release decision.',
        null,
        null,
        null,
        null,
        stamp + 210,
      );
      insertMessage.run(
        `budget-assistant-${stamp}`,
        fixture.budgetSessionId,
        'assistant',
        'Risk: the slot did not produce a full narrative before the tool budget ended.',
        null,
        null,
        null,
        null,
        stamp + 220,
      );
      insertMessage.run(
        `budget-tool-result-${stamp}`,
        fixture.budgetSessionId,
        'tool_result',
        JSON.stringify({
          status: 'failed',
          toolResultErrorCode: 'MAX_TOOL_CALLS_REACHED',
          toolResultErrorMessage: 'Tool budget reached before the branch could finish.',
        }),
        null,
        null,
        'budget-tool-call',
        null,
        stamp + 230,
      );
    });

    seed();
  } finally {
    db.close();
  }
}

function cleanupFixture(fixture: SeededRuntimeAttentionFixture): void {
  const db = openDb();

  try {
    const removeMessages = db.prepare('DELETE FROM messages WHERE session_id = ?');
    const removeSession = db.prepare('DELETE FROM sessions WHERE id = ?');

    const cleanup = db.transaction(() => {
      removeMessages.run(fixture.timeoutSessionId);
      removeMessages.run(fixture.budgetSessionId);
      removeSession.run(fixture.timeoutSessionId);
      removeSession.run(fixture.budgetSessionId);
      removeSession.run(fixture.timeoutHostSessionId);
      removeSession.run(fixture.budgetHostSessionId);
    });

    cleanup();
  } finally {
    db.close();
  }
}

test.describe('REGRESSION: runtime attention panel', () => {
  let fixture: SeededRuntimeAttentionFixture | null = null;

  test.afterEach(() => {
    if (!fixture) {
      return;
    }
    cleanupFixture(fixture);
    fixture = null;
  });

  test('surfaces timeout and tool-budget runtime issues in Active without treating them as HITL', async ({ page, request }, testInfo) => {
    const stamp = Date.now();
    const timeoutTitle = `E2E Runtime Timeout ${stamp}`;
    const budgetTitle = `E2E Runtime Budget ${stamp}`;
    const timeoutHostResponse = await request.post(`${API_BASE}/sessions`, {
      data: { personaId: 'default', title: `Host ${timeoutTitle}` },
    });
    expect(timeoutHostResponse.ok()).toBeTruthy();
    const timeoutHost = await timeoutHostResponse.json() as { id: string };

    const timeoutSessionResponse = await request.post(`${API_BASE}/sessions`, {
      data: { personaId: 'default', title: timeoutTitle, kind: 'subagent', parentSessionId: timeoutHost.id },
    });
    expect(timeoutSessionResponse.ok()).toBeTruthy();
    const timeoutSession = await timeoutSessionResponse.json() as { id: string };

    const budgetHostResponse = await request.post(`${API_BASE}/sessions`, {
      data: { personaId: 'default', title: `Host ${budgetTitle}` },
    });
    expect(budgetHostResponse.ok()).toBeTruthy();
    const budgetHost = await budgetHostResponse.json() as { id: string };

    const budgetSessionResponse = await request.post(`${API_BASE}/sessions`, {
      data: { personaId: 'default', title: budgetTitle, kind: 'subagent', parentSessionId: budgetHost.id },
    });
    expect(budgetSessionResponse.ok()).toBeTruthy();
    const budgetSession = await budgetSessionResponse.json() as { id: string };

    fixture = {
      timeoutHostSessionId: timeoutHost.id,
      timeoutSessionId: timeoutSession.id,
      timeoutTitle,
      budgetHostSessionId: budgetHost.id,
      budgetSessionId: budgetSession.id,
      budgetTitle,
    };

    await expect.poll(() => sessionExistsInDb(fixture!.timeoutSessionId), {
      timeout: 5_000,
      message: `Expected timeout session ${fixture.timeoutSessionId} to persist in ${DB_PATH}`,
    }).toBe(true);
    await expect.poll(() => sessionExistsInDb(fixture!.budgetSessionId), {
      timeout: 5_000,
      message: `Expected budget session ${fixture.budgetSessionId} to persist in ${DB_PATH}`,
    }).toBe(true);

    seedRuntimeAttentionMessages(fixture);

    await page.goto('/');
    await page.getByTestId('nav-talk').click();
    await selectSessionOriginFilter(page, 'agent');

    await selectSession(page, fixture.timeoutSessionId, fixture.timeoutTitle);
    await expect(page.getByTestId('message-list')).toContainText('Sub-agent timed out after 300000ms.', { timeout: 10_000 });
    await expect(page.getByTestId('active-tab-pending-dot')).toBeVisible();

    await page.getByTestId('talk-tab-agents').click();
    await expect(page.getByTestId(`runtime-attention-${fixture.timeoutSessionId}`)).toContainText('Sub-agent timed out');

    await page.getByTestId('talk-tab-conversations').click();
    await selectSessionOriginFilter(page, 'agent');
    await selectSession(page, fixture.budgetSessionId, fixture.budgetTitle);
    await expect(page.getByTestId('message-list')).toContainText('tool budget ended', { timeout: 10_000 });

    await page.getByTestId('talk-tab-agents').click();
    await expect(page.getByTestId('active-tab-pending-dot')).toBeVisible();
    await expect(page.getByTestId(`runtime-attention-${fixture.timeoutSessionId}`)).toContainText(fixture.timeoutTitle);
    await expect(page.getByTestId(`runtime-attention-${fixture.budgetSessionId}`)).toContainText('Tool budget reached before the branch could finish.');
    await expect(page.getByTestId('confirmation-confirm-btn')).toHaveCount(0);

    await page.reload();
    await page.getByTestId('nav-talk').click();
    await page.getByTestId('talk-tab-agents').click();
    await expect(page.getByTestId('active-tab-pending-dot')).toBeVisible();
    await expect(page.getByTestId(`runtime-attention-${fixture.timeoutSessionId}`)).toContainText('Sub-agent timed out');
    await expect(page.getByTestId(`runtime-attention-${fixture.budgetSessionId}`)).toContainText('Tool budget reached before the branch could finish.');
    await expect(page.getByTestId('confirmation-confirm-btn')).toHaveCount(0);

    await page.getByTestId(`runtime-attention-${fixture.budgetSessionId}`).click();
    await expect(page.getByTestId('chat-interface')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId('message-list')).toContainText('tool budget ended');

    await testInfo.attach('runtime-attention-panel-proof', {
      body: await page.screenshot({ fullPage: true }),
      contentType: 'image/png',
    });

    await deleteSessionIfExists(request, fixture.timeoutSessionId);
    await deleteSessionIfExists(request, fixture.budgetSessionId);
    await deleteSessionIfExists(request, fixture.timeoutHostSessionId);
    await deleteSessionIfExists(request, fixture.budgetHostSessionId);
    fixture = null;
  });
});
