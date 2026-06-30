import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

type SeedStatement = {
  run: (...params: unknown[]) => unknown;
};

type SeedDb = {
  pragma: (sql: string) => unknown;
  prepare: (sql: string) => SeedStatement;
  transaction: (fn: () => void) => () => void;
  close: () => void;
};

interface SeededCliChildFixture {
  masterSessionId: string;
  masterTitle: string;
  cliChildSessionId: string;
  cliChildTitle: string;
  cliOutput: string;
  parentToolCallId: string;
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

function seedCliChildFixture(): SeededCliChildFixture {
  const stamp = Date.now();
  const fixture: SeededCliChildFixture = {
    masterSessionId: `e2e-cli-master-${stamp}`,
    masterTitle: `E2E CLI child canvas ${stamp}`,
    cliChildSessionId: `e2e-cli-child-${stamp}`,
    cliChildTitle: `codex CLI ${stamp}`,
    cliOutput: `Seeded CLI output ${stamp}`,
    parentToolCallId: `call-cli-${stamp}`,
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
        stamp + 500,
      );
      insertSession.run(
        fixture.cliChildSessionId,
        'default',
        fixture.cliChildTitle,
        'cli-agent',
        fixture.masterSessionId,
        null,
        fixture.parentToolCallId,
        stamp + 100,
        stamp + 200,
      );

      insertMessage.run(
        `master-user-${stamp}`,
        fixture.masterSessionId,
        'user',
        'Run the CLI child to inspect the repository.',
        null,
        null,
        null,
        null,
        stamp + 10,
      );
      insertMessage.run(
        `master-assistant-${stamp}`,
        fixture.masterSessionId,
        'assistant',
        'Spawning a CLI child session.',
        null,
        JSON.stringify([
          {
            id: fixture.parentToolCallId,
            name: 'spawn_cli_agent',
            args: { agentId: 'codex', prompt: 'Inspect repository', workdir: 'C:/repo' },
          },
        ]),
        null,
        null,
        stamp + 20,
      );
      insertMessage.run(
        `master-tool-${stamp}`,
        fixture.masterSessionId,
        'tool_result',
        JSON.stringify({
          childSessionId: fixture.cliChildSessionId,
          parentSessionId: fixture.masterSessionId,
          agentId: 'codex',
          workdir: 'C:/repo',
          status: 'stopped',
          lastPrompt: 'Inspect repository',
          updatedAt: stamp + 300,
          lastOutput: fixture.cliOutput,
        }),
        null,
        null,
        fixture.parentToolCallId,
        null,
        stamp + 30,
      );
    });

    seed();
    return fixture;
  } finally {
    db.close();
  }
}

function cleanupFixture(fixture: SeededCliChildFixture): void {
  const db = openDb();

  try {
    const removeMessages = db.prepare('DELETE FROM messages WHERE session_id = ?');
    const removeSession = db.prepare('DELETE FROM sessions WHERE id = ?');

    const cleanup = db.transaction(() => {
      removeMessages.run(fixture.masterSessionId);
      removeMessages.run(fixture.cliChildSessionId);
      removeSession.run(fixture.cliChildSessionId);
      removeSession.run(fixture.masterSessionId);
    });

    cleanup();
  } finally {
    db.close();
  }
}

test.describe('REGRESSION: CLI child canvas preview', () => {
  let fixture: SeededCliChildFixture | null = null;

  test.afterEach(() => {
    if (!fixture) return;
    cleanupFixture(fixture);
    fixture = null;
  });

  test('shows stopped CLI child card in canvas after seeded history reload', async ({ page }) => {
    fixture = seedCliChildFixture();

    await page.goto('/');
    await page.getByTestId('nav-talk').click();

    const masterSession = page.getByTestId('session-item').filter({ hasText: fixture.masterTitle }).first();
    await expect(masterSession).toBeVisible({ timeout: 10_000 });
    await masterSession.click();

    await expect(page.getByTestId('chat-interface')).toBeVisible({ timeout: 10_000 });

    const chatCliCard = page.getByTestId('agent-turn-bubble').getByTestId('cli-child-card-' + fixture.cliChildSessionId);
    await expect(chatCliCard).toBeVisible({ timeout: 10_000 });
    await expect(chatCliCard.getByTestId('cli-child-status-' + fixture.cliChildSessionId)).toHaveText('stopped');
    await expect(chatCliCard.getByTestId('cli-child-output-' + fixture.cliChildSessionId)).toContainText(fixture.cliOutput);

    const canvasToggle = page.getByTestId('canvas-toggle');
    await expect(canvasToggle).toBeVisible({ timeout: 10_000 });
    await canvasToggle.click();
    await expect(page.getByTestId('canvas-panel')).toBeVisible({ timeout: 10_000 });

    const canvasCliSection = page.getByTestId('canvas-cli-children-section');
    await expect(canvasCliSection).toBeVisible({ timeout: 10_000 });
    const canvasCliCard = canvasCliSection.getByTestId('cli-child-card-' + fixture.cliChildSessionId);
    await expect(canvasCliCard).toBeVisible();
    await expect(canvasCliCard.getByTestId('cli-child-status-' + fixture.cliChildSessionId)).toHaveText('stopped');
    await expect(canvasCliCard.getByTestId('cli-child-output-' + fixture.cliChildSessionId)).toContainText(fixture.cliOutput);

    await page.reload();
    await page.getByTestId('nav-talk').click();

    const reloadedMasterSession = page.locator(`[data-testid="session-item"][data-session-id="${fixture.masterSessionId}"]`);
    await expect(reloadedMasterSession).toBeVisible({ timeout: 10_000 });
    await reloadedMasterSession.click();

    await page.getByTestId('talk-sidebar-graph-entry').click();
    await expect(page.getByTestId('execution-graph-view')).toBeVisible({ timeout: 10_000 });

    const cliGraphNode = page.getByTestId(`graph-node-cli-agent:${fixture.cliChildSessionId}`);
    await expect(cliGraphNode).toBeVisible({ timeout: 10_000 });
    await cliGraphNode.click();

    const inspector = page.getByTestId('execution-graph-inspector');
    await expect(inspector).toContainText('CLI child details');
    await expect(inspector).toContainText(fixture.cliOutput);
    await expect(inspector.getByRole('button', { name: 'Open child chat' })).toBeVisible();
    await expect(inspector.getByRole('button', { name: 'Send follow-up' })).toHaveCount(0);
    await expect(inspector.getByRole('button', { name: 'Stop run' })).toHaveCount(0);
  });
});
