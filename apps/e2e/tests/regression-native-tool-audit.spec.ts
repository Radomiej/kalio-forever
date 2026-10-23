import { expect, test } from '@playwright/test';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { API_BASE, selectSession } from './helpers/test-config';

type SeedDb = { prepare: (sql: string) => { run: (...args: unknown[]) => unknown }; close: () => void };
const requireBackend = createRequire(resolve(__dirname, '../../kalio-api/package.json'));
const Database = requireBackend('better-sqlite3') as new (path: string) => SeedDb;

test('native audit reads a real scoped SQLite snapshot and survives F5', async ({ page, request }, testInfo) => {
  const configured = process.env['DATABASE_PATH'];
  if (!configured || !configured.replaceAll('\\', '/').includes('playwright-stack/')) {
    throw new Error('Native audit fixture requires the isolated Playwright database');
  }
  const db = new Database(resolve(__dirname, '../../kalio-api', configured));
  const stamp = Date.now();
  const session = `native-audit-${stamp}`;
  const turn = `native-turn-${stamp}`;
  const prompt = `native-prompt-${stamp}`;
  const title = `Native audit fixture ${stamp}`;
  try {
    db.prepare('INSERT INTO sessions (id, persona_id, title, kind, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(session, 'default', title, 'chat', stamp, stamp);
    const message = db.prepare('INSERT INTO messages (id, session_id, role, content, turn_id, prompt_message_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)');
    message.run(prompt, session, 'user', 'Inspect native audit fixture', null, null, stamp);
    message.run(`answer-${stamp}`, session, 'assistant', 'Stored fixture answer', turn, prompt, stamp + 1);
    // Provider provenance belongs to this exact durable turn, not persona defaults.
    db.prepare('INSERT INTO chat_runs (id, session_id, turn_id, phase, status, provider, model, runtime_kind, started_at, updated_at, last_heartbeat_at, completed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(`run-${stamp}`, session, turn, 'completed', 'completed', 'devin-cli-acp', 'swe-2', 'chat', stamp, stamp + 1, stamp + 1, stamp + 1);
    const audit = db.prepare('INSERT INTO audit_log (id, session_id, type, label, data, created_at) VALUES (?, ?, ?, ?, ?, ?)');
    const scope = { turnId: turn, processEpoch: 'fixture-epoch' };
    audit.run(`blocked-${stamp}`, session, 'runtime_event', 'devin-cli-acp.native_approval', JSON.stringify({ ...scope, toolCallId: 'blocked', toolCallName: 'Read blocked fixture', decision: 'decline', decisionSource: 'policy' }), stamp + 2);
    audit.run(`approved-${stamp}`, session, 'runtime_event', 'devin-cli-acp.native_approval', JSON.stringify({ ...scope, toolCallId: 'approved', toolCallName: 'Read approved fixture', decision: 'accept' }), stamp + 3);
    audit.run(`excluded-${stamp}`, session, 'runtime_event', 'devin-cli-acp.native_approval', JSON.stringify({ ...scope, turnId: 'other-turn', toolCallId: 'other', toolCallName: 'Wrong turn fixture', decision: 'decline' }), stamp + 4);
  } finally { db.close(); }
  try {
    const response = await request.get(`${API_BASE}/audit-log?sessionId=${session}&turnId=${turn}&source=all&type=runtime_event`);
    expect(response.ok()).toBeTruthy();
    expect(await response.json()).toHaveLength(2);
    await page.goto('/');
    await page.getByTestId('nav-talk').click();
    await selectSession(page, session, title);
    const open = async () => {
      await page.getByRole('button', { name: 'Devin tool permissions', exact: true }).click();
      await expect(page.getByText(/Read blocked fixture.*Native Devin.*blocked by policy/)).toBeVisible();
      await expect(page.getByText(/Read approved fixture.*Native Devin.*approved/)).toBeVisible();
      await expect(page.getByText('Wrong turn fixture')).toHaveCount(0);
    };
    await open();
    await page.reload();
    await open();
    const hide = page.getByRole('button', { name: 'Hide conversations', exact: true });
    await hide.click();
    await expect(page.getByRole('button', { name: 'Show conversations', exact: true })).toBeVisible();
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.getByText(/Read blocked fixture.*Native Devin.*blocked by policy/)).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath('native-audit-fixture-390.png'), fullPage: true });
  } finally {
    const cleanup = await request.delete(`${API_BASE}/sessions/${session}`);
    expect(cleanup.ok()).toBeTruthy();
  }
});
