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

interface SeededChatGraphFixture {
  sessionId: string;
  title: string;
  uxChildSessionId: string;
  flowChildSessionId: string;
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

function seedChatGraphFixture(): SeededChatGraphFixture {
  const stamp = Date.now();
  const fixture: SeededChatGraphFixture = {
    sessionId: `e2e-graph-states-${stamp}`,
    title: `E2E seeded chat graph states ${stamp}`,
    uxChildSessionId: `e2e-ux-child-${stamp}`,
    flowChildSessionId: `e2e-flow-child-${stamp}`,
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

    const subagentResult = {
      childSessionId: fixture.uxChildSessionId,
      parentSessionId: fixture.sessionId,
      vfsMode: 'shared',
      vfsSessionId: fixture.sessionId,
      copiedFiles: [
        {
          fromPath: 'analysis/ux-findings.md',
          toPath: 'sub-agents/ux-findings.md',
          sizeBytes: 1240,
        },
      ],
      result: 'UX branch completed: tighten graph copy, keep details collapsed, preserve tool evidence in the side canvas.',
      taskId: `ux-task-${stamp}`,
      durationMs: 840,
    };
    const agentFlowResult = {
      flowRunId: `flow-${stamp}`,
      status: 'done',
      summary: 'Goal Guard accepted the seeded workflow after one implementation pass and one review pass.',
      childSessionId: fixture.flowChildSessionId,
      openChatSessionId: fixture.flowChildSessionId,
      openGraphRunId: `graph-${stamp}`,
      returnToOrchestratorCount: 1,
      decisions: ['Keep workflow details collapsed by default.'],
      nextActions: ['Use this fixture for visual regression checks before MVP demo.'],
      artifacts: ['qa/seeded-chat-graph.png'],
      tracePreview: [
        {
          id: `trace-router-${stamp}`,
          sequence: 1,
          type: 'router_decision',
          nodeId: 'orchestrator',
          message: 'Route to implementer.',
          createdAt: stamp + 25,
        },
        {
          id: `trace-guard-${stamp}`,
          sequence: 2,
          type: 'goal_guard:accept',
          nodeId: 'goal-guard',
          message: 'Evidence accepted.',
          createdAt: stamp + 26,
        },
      ],
    };

    const seed = db.transaction(() => {
      insertSession.run(fixture.sessionId, 'default', fixture.title, 'chat', null, null, null, stamp, stamp + 900);
      insertSession.run(
        fixture.uxChildSessionId,
        'default',
        `UX Designer child ${stamp}`,
        'subagent',
        fixture.sessionId,
        null,
        'call-ux',
        stamp + 100,
        stamp + 200,
      );
      insertSession.run(
        fixture.flowChildSessionId,
        'default',
        `Goal Guard child ${stamp}`,
        'subagent',
        fixture.sessionId,
        null,
        'call-flow',
        stamp + 300,
        stamp + 400,
      );

      insertMessage.run(
        `main-user-${stamp}`,
        fixture.sessionId,
        'user',
        'Seed a UI review workflow with tool calls, routing, and a final compact decision.',
        null,
        null,
        null,
        null,
        stamp + 10,
      );
      insertMessage.run(
        `main-assistant-tools-${stamp}`,
        fixture.sessionId,
        'assistant',
        'Workflow started. The graph should show tools and branches without dumping raw execution prose.',
        'Plan: run a UX branch, write one fixture file, then ask Goal Guard for a concise review.',
        JSON.stringify([
          {
            id: 'call-ux',
            name: 'run_subagent',
            args: {
              persona: 'UX Designer',
              inputPrompt: 'Review graph/chat visual states and report only compact findings.',
            },
          },
          {
            id: 'call-write',
            name: 'vfs_write',
            args: {
              path: 'qa/seeded-chat-graph.md',
              content: 'Seeded QA state for Playwright visual checks.',
            },
          },
          {
            id: 'call-flow',
            name: 'run_sub_agentflow',
            args: {
              schemaId: 'goal-master-delivery-loop',
              inputPrompt: 'Validate the seeded UI state and route back only if evidence is missing.',
            },
          },
        ]),
        null,
        null,
        stamp + 20,
      );
      insertMessage.run(
        `main-result-ux-${stamp}`,
        fixture.sessionId,
        'tool_result',
        JSON.stringify(subagentResult),
        null,
        null,
        'call-ux',
        null,
        stamp + 30,
      );
      insertMessage.run(
        `main-result-write-${stamp}`,
        fixture.sessionId,
        'tool_result',
        JSON.stringify({ path: 'qa/seeded-chat-graph.md', bytesWritten: 49 }),
        null,
        null,
        'call-write',
        null,
        stamp + 40,
      );
      insertMessage.run(
        `main-result-flow-${stamp}`,
        fixture.sessionId,
        'tool_result',
        JSON.stringify(agentFlowResult),
        null,
        null,
        'call-flow',
        null,
        stamp + 50,
      );
      insertMessage.run(
        `main-final-${stamp}`,
        fixture.sessionId,
        'assistant',
        'Seeded workflow complete: UX branch finished, VFS evidence stored, and Goal Guard accepted the review.',
        null,
        null,
        null,
        null,
        stamp + 60,
      );

      insertMessage.run(
        `ux-user-${stamp}`,
        fixture.uxChildSessionId,
        'user',
        'Review graph/chat visual states and report only compact findings.',
        null,
        null,
        null,
        null,
        stamp + 110,
      );
      insertMessage.run(
        `ux-assistant-${stamp}`,
        fixture.uxChildSessionId,
        'assistant',
        'Compact UX finding: details belong in expandable panels; graph nodes should carry short status summaries.',
        null,
        null,
        null,
        null,
        stamp + 120,
      );
      insertMessage.run(
        `flow-user-${stamp}`,
        fixture.flowChildSessionId,
        'user',
        'Validate seeded UI state.',
        null,
        null,
        null,
        null,
        stamp + 310,
      );
      insertMessage.run(
        `flow-assistant-${stamp}`,
        fixture.flowChildSessionId,
        'assistant',
        'Goal Guard accepted visual evidence and kept raw details behind disclosure.',
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

function cleanupFixture(fixture: SeededChatGraphFixture): void {
  const db = openDb();

  try {
    const removeMessages = db.prepare('DELETE FROM messages WHERE session_id = ?');
    const removeSession = db.prepare('DELETE FROM sessions WHERE id = ?');

    const cleanup = db.transaction(() => {
      removeMessages.run(fixture.sessionId);
      removeMessages.run(fixture.uxChildSessionId);
      removeMessages.run(fixture.flowChildSessionId);
      removeSession.run(fixture.uxChildSessionId);
      removeSession.run(fixture.flowChildSessionId);
      removeSession.run(fixture.sessionId);
    });

    cleanup();
  } finally {
    db.close();
  }
}

test.describe('REGRESSION: seeded chat and graph visual states', () => {
  let fixture: SeededChatGraphFixture | null = null;

  test.afterEach(() => {
    if (!fixture) return;
    cleanupFixture(fixture);
    fixture = null;
  });

  test('renders tool calls, workflow routing, and graph nodes from a deterministic seed', async ({ page }, testInfo) => {
    fixture = seedChatGraphFixture();

    await page.goto('/');
    await page.getByTestId('nav-talk').click();

    const sessionItem = page.locator(`[data-testid="session-item"][data-session-id="${fixture.sessionId}"]`);
    await expect(sessionItem).toBeVisible({ timeout: 5000 });
    await sessionItem.click();

    await expect(page.getByTestId('chat-interface')).toBeVisible({ timeout: 5000 });
    await expect(page.getByTestId('agent-turn-bubble')).toHaveCount(1, { timeout: 5000 });
    await expect(page.locator('[data-testid="tool-call-bubble"][data-tool-name="run_subagent"]')).toBeVisible();
    await expect(page.locator('[data-testid="tool-call-bubble"][data-tool-name="vfs_write"]')).toBeVisible();
    await expect(page.locator('[data-testid="tool-call-bubble"][data-tool-name="run_sub_agentflow"]')).toBeVisible();
    await expect(page.getByTestId('agent-turn-bubble')).toContainText('Seeded workflow complete');
    await expect(page.getByTestId('agent-turn-bubble')).not.toContainText('Execution trace:');
    await expect(page.getByTestId('agent-turn-bubble')).not.toContainText('Incoming graph outputs:');
    await testInfo.attach('seeded-chat-states', {
      body: await page.screenshot({ fullPage: true }),
      contentType: 'image/png',
    });

    await page.getByTestId('talk-sidebar-graph-entry').click();
    await expect(page.getByTestId('execution-graph-view')).toBeVisible({ timeout: 5000 });
    await expect(page.getByRole('heading', { name: 'Execution Graph' })).toBeVisible();
    await expect(page.locator('[data-testid^="graph-node-subagent:"]').first()).toBeVisible({ timeout: 5000 });
    await expect(page.locator('[data-testid^="graph-node-agent-flow:"]').first()).toBeVisible({ timeout: 5000 });
    await expect(page.locator('[data-testid^="graph-node-tool-group:"]').first()).toBeVisible({ timeout: 5000 });
    await expect(page.getByTestId('execution-graph-view')).toContainText('Sub AgentFlow');
    await expect(page.getByTestId('execution-graph-view')).toContainText('3 calls collapsed');
    await expect(page.getByTestId('execution-graph-view')).not.toContainText('UX branch completed');
    await expect(page.getByTestId('execution-graph-view')).not.toContainText('Goal Guard accepted the seeded workflow');
    await expect(page.getByTestId('execution-graph-view')).not.toContainText('Prompts, turns, tools, subagents, artifacts and final responses.');
    await testInfo.attach('seeded-execution-graph-states', {
      body: await page.screenshot({ fullPage: true }),
      contentType: 'image/png',
    });
  });
});
