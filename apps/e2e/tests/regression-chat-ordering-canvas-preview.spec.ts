import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

type SeedStatement = {
  run: (...params: unknown[]) => unknown;
};

type SeedDb = {
  pragma: (sql: string) => unknown;
  prepare: (sql: string) => SeedStatement;
  transaction: (fn: () => void) => () => void;
  close: () => void;
};

interface SeededOrderingFixture {
  masterSessionId: string;
  masterTitle: string;
  olderChildSessionId: string;
  olderChildTitle: string;
  newerChildSessionId: string;
  newerChildTitle: string;
  newerChildPrompt: string;
  newerChildReply: string;
}

const requireBackend = createRequire(resolve(__dirname, '../../kalio-api/package.json'));
const BetterSqlite3 = requireBackend('better-sqlite3') as new (path: string) => SeedDb;
const PROCESS_ENV = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env;
const DB_PATH = PROCESS_ENV?.DATABASE_PATH?.trim()
  ? resolve(PROCESS_ENV.DATABASE_PATH)
  : resolve(__dirname, '../../kalio-api/data/kalio.db');

function openDb(): SeedDb {
  const db = new BetterSqlite3(DB_PATH);
  db.pragma('foreign_keys = ON');
  return db;
}

function seedOrderingFixture(): SeededOrderingFixture {
  const stamp = Date.now();
  const fixture: SeededOrderingFixture = {
    masterSessionId: `e2e-master-ordering-${stamp}`,
    masterTitle: `E2E ordering master ${stamp}`,
    olderChildSessionId: `e2e-subagent-older-${stamp}`,
    olderChildTitle: `Sub-agent: older preview ${stamp}`,
    newerChildSessionId: `e2e-subagent-newer-${stamp}`,
    newerChildTitle: `Sub-agent: newer preview ${stamp}`,
    newerChildPrompt: `Read the file at /tmp/design-${stamp}.txt`,
    newerChildReply: `Read summary for design ${stamp}`,
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
      insertSession.run(
        fixture.masterSessionId,
        'default',
        fixture.masterTitle,
        'chat',
        null,
        null,
        null,
        stamp,
        stamp + 800,
      );
      insertSession.run(
        fixture.olderChildSessionId,
        'default',
        fixture.olderChildTitle,
        'subagent',
        fixture.masterSessionId,
        null,
        null,
        stamp + 100,
        stamp + 200,
      );
      insertSession.run(
        fixture.newerChildSessionId,
        'default',
        fixture.newerChildTitle,
        'subagent',
        fixture.masterSessionId,
        null,
        null,
        stamp + 300,
        stamp + 400,
      );

      insertMessage.run(
        `master-user-1-${stamp}`,
        fixture.masterSessionId,
        'user',
        'Create a one-page coffee landing page for Kalio Cafe.',
        null,
        null,
        null,
        null,
        stamp + 10,
      );
      insertMessage.run(
        `master-assistant-1-${stamp}`,
        fixture.masterSessionId,
        'assistant',
        'Built the coffee landing page.',
        null,
        null,
        null,
        null,
        stamp + 20,
      );
      insertMessage.run(
        `master-tool-1-${stamp}`,
        fixture.masterSessionId,
        'tool_result',
        JSON.stringify({
          childSessionId: fixture.olderChildSessionId,
          result: 'Older preview summary',
          copiedFiles: [],
        }),
        null,
        null,
        null,
        null,
        stamp + 30,
      );
      insertMessage.run(
        `master-user-2-${stamp}`,
        fixture.masterSessionId,
        'user',
        'dodaj obrazek to designu',
        null,
        null,
        null,
        null,
        stamp + 40,
      );
      insertMessage.run(
        `master-user-3-${stamp}`,
        fixture.masterSessionId,
        'user',
        'dodaj obrazek do designu',
        null,
        null,
        null,
        null,
        stamp + 50,
      );
      insertMessage.run(
        `master-assistant-2-${stamp}`,
        fixture.masterSessionId,
        'assistant',
        'Dodalem obrazek do designu.',
        null,
        null,
        null,
        null,
        stamp + 60,
      );
      insertMessage.run(
        `master-tool-2-${stamp}`,
        fixture.masterSessionId,
        'tool_result',
        JSON.stringify({
          childSessionId: fixture.newerChildSessionId,
          result: 'Newer preview summary',
          copiedFiles: [],
        }),
        null,
        null,
        null,
        null,
        stamp + 70,
      );

      insertMessage.run(
        `older-child-user-${stamp}`,
        fixture.olderChildSessionId,
        'user',
        'Create a single-page coffee landing page with warm colors.',
        null,
        null,
        null,
        null,
        stamp + 110,
      );
      insertMessage.run(
        `older-child-assistant-${stamp}`,
        fixture.olderChildSessionId,
        'assistant',
        'Created the landing page draft.',
        null,
        null,
        null,
        null,
        stamp + 120,
      );

      insertMessage.run(
        `newer-child-user-${stamp}`,
        fixture.newerChildSessionId,
        'user',
        fixture.newerChildPrompt,
        null,
        null,
        null,
        null,
        stamp + 310,
      );
      insertMessage.run(
        `newer-child-assistant-${stamp}`,
        fixture.newerChildSessionId,
        'assistant',
        fixture.newerChildReply,
        null,
        null,
        null,
        null,
        stamp + 320,
      );
    });

    seed();
    return fixture;
  } finally {
    db.close();
  }
}

function cleanupFixture(fixture: SeededOrderingFixture): void {
  const db = openDb();

  try {
    const removeMessages = db.prepare('DELETE FROM messages WHERE session_id = ?');
    const removeSession = db.prepare('DELETE FROM sessions WHERE id = ?');

    const cleanup = db.transaction(() => {
      removeMessages.run(fixture.masterSessionId);
      removeMessages.run(fixture.olderChildSessionId);
      removeMessages.run(fixture.newerChildSessionId);
      removeSession.run(fixture.olderChildSessionId);
      removeSession.run(fixture.newerChildSessionId);
      removeSession.run(fixture.masterSessionId);
    });

    cleanup();
  } finally {
    db.close();
  }
}

test.describe('REGRESSION: chat ordering and canvas previews', () => {
  let fixture: SeededOrderingFixture | null = null;

  test.afterEach(() => {
    if (!fixture) return;
    cleanupFixture(fixture);
    fixture = null;
  });

  test('keeps later agent turns under the correct prompt and keeps newer subagent previews at the bottom', async ({ page }) => {
    fixture = seedOrderingFixture();

    await page.goto('/');
    await page.getByTestId('nav-talk').click();

    const masterSession = page.getByTestId('session-item').filter({ hasText: fixture.masterTitle }).first();
    await expect(masterSession).toBeVisible({ timeout: 5000 });

    const sidebarOrder = await page.getByTestId('session-item').evaluateAll((nodes) =>
      nodes.map((node) => (node.textContent ?? '').replace(/\s+/g, ' ').trim()),
    );
    const masterIndex = sidebarOrder.findIndex((text) => text.includes(fixture.masterTitle));
    const olderChildIndex = sidebarOrder.findIndex((text) => text.includes(fixture.olderChildTitle));
    const newerChildIndex = sidebarOrder.findIndex((text) => text.includes(fixture.newerChildTitle));

    expect(masterIndex).toBeGreaterThanOrEqual(0);
    expect(olderChildIndex).toBe(masterIndex + 1);
    expect(newerChildIndex).toBe(olderChildIndex + 1);

    await masterSession.click();

    await expect(page.getByTestId('chat-interface')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('[data-testid="message-bubble"][data-role="user"]')).toHaveCount(3, { timeout: 5000 });
    await expect(page.getByTestId('agent-turn-bubble')).toHaveCount(2, { timeout: 5000 });

    const mainOrder = await page.getByTestId('message-list')
      .locator('[data-testid="message-bubble"], [data-testid="agent-turn-bubble"]')
      .evaluateAll((nodes) => nodes.map((node) => {
        const testId = node.getAttribute('data-testid');
        const text = node.textContent?.replace(/\s+/g, ' ').trim() ?? '';
        return testId === 'agent-turn-bubble' ? `agent:${text}` : `user:${text}`;
      }));

    expect(mainOrder).toHaveLength(5);
    expect(mainOrder[0]).toContain('Create a one-page coffee landing page for Kalio Cafe.');
    expect(mainOrder[1]).toContain('Built the coffee landing page.');
    expect(mainOrder[2]).toContain('dodaj obrazek to designu');
    expect(mainOrder[3]).toContain('dodaj obrazek do designu');
    expect(mainOrder[4]).toContain('Dodalem obrazek do designu.');

    const canvasToggle = page.getByTestId('canvas-toggle');
    await expect(canvasToggle).toBeVisible({ timeout: 5000 });
    await canvasToggle.click();
    await expect(page.getByTestId('canvas-panel')).toBeVisible({ timeout: 5000 });

    const olderPreviewTitle = page.getByTestId('canvas-panel').getByText(fixture.olderChildTitle);
    const newerPreviewTitle = page.getByTestId('canvas-panel').getByText(fixture.newerChildTitle);
    await expect(olderPreviewTitle).toBeVisible({ timeout: 5000 });
    await expect(newerPreviewTitle).toBeVisible({ timeout: 5000 });

    const olderTop = await olderPreviewTitle.evaluate((node) => node.getBoundingClientRect().top);
    const newerTop = await newerPreviewTitle.evaluate((node) => node.getBoundingClientRect().top);
    expect(olderTop).toBeLessThan(newerTop);

    const openButtons = page.getByTestId('canvas-panel').getByRole('button', { name: 'Open sub-agent chat' });
    await expect(openButtons).toHaveCount(2, { timeout: 5000 });
    await openButtons.nth(1).click();

    await expect(page.locator('[data-testid="message-bubble"][data-role="user"]')).toHaveCount(1, { timeout: 5000 });
    await expect(page.getByTestId('agent-turn-bubble')).toHaveCount(1, { timeout: 5000 });

    const childOrder = await page.getByTestId('message-list')
      .locator('[data-testid="message-bubble"], [data-testid="agent-turn-bubble"]')
      .evaluateAll((nodes) => nodes.map((node) => {
        const testId = node.getAttribute('data-testid');
        const text = node.textContent?.replace(/\s+/g, ' ').trim() ?? '';
        return testId === 'agent-turn-bubble' ? `agent:${text}` : `user:${text}`;
      }));

    expect(childOrder).toHaveLength(2);
    expect(childOrder[0]).toContain(fixture.newerChildPrompt);
    expect(childOrder[1]).toContain(fixture.newerChildReply);
  });
});