import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { API_BASE, deleteSessionIfExists, isMockLlm, selectSession, selectSessionOriginFilter, sendMessageFromComposer } from './helpers/test-config';

type SeedStatement = {
  run: (...params: unknown[]) => unknown;
};

type SeedDb = {
  pragma: (sql: string) => unknown;
  prepare: (sql: string) => SeedStatement;
  transaction: (fn: () => void) => () => void;
  close: () => void;
};

type AgentFlowRunSnapshot = {
  run: {
    id: string;
    childSessionId?: string;
    status: string;
  };
  result?: {
    status?: string;
    childSessionId?: string;
    openChatSessionId?: string;
    openGraphRunId?: string;
  };
  events?: unknown;
};

const GOAL_FLOW_ROOT_LABEL = /Goal Guard|Architecture|Goal Master Delivery Loop/i;

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

function seedParentAgentFlowBubbleFixture(): { sessionId: string; childSessionId: string; runId: string; title: string } {
  const stamp = Date.now();
  const sessionId = `e2e-agentflow-parent-${stamp}`;
  const childSessionId = `e2e-agentflow-child-${stamp}`;
  const runId = `e2e-agentflow-run-${stamp}`;
  const title = `AgentFlow parent bubble ${stamp}`;
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
      insertSession.run(sessionId, 'default', title, 'chat', null, null, null, stamp, stamp + 100);
      insertSession.run(
        childSessionId,
        'default',
        `Architecture: Goal Guard child ${stamp}`,
        'agent-flow',
        sessionId,
        null,
        'call-agentflow',
        stamp + 10,
        stamp + 90,
      );
      insertMessage.run(
        `msg-user-${stamp}`,
        sessionId,
        'user',
        'Run the two-agent Goal Guard delivery loop.',
        null,
        null,
        null,
        null,
        stamp + 20,
      );
      insertMessage.run(
        `msg-assistant-${stamp}`,
        sessionId,
        'assistant',
        'Starting the Goal Guard delivery loop.',
        null,
        JSON.stringify([{
          id: 'call-agentflow',
          name: 'run_sub_agentflow',
          args: {
            flowId: 'goal_guard_delivery_loop',
            goal: 'Run Implementer and Goal Guard until QA evidence is accepted.',
          },
        }]),
        null,
        null,
        stamp + 30,
      );
      insertMessage.run(
        `msg-tool-${stamp}`,
        sessionId,
        'tool_result',
        JSON.stringify({
          flowRunId: runId,
          childSessionId,
          status: 'waiting_on_orchestrator',
          summary: 'Goal Guard is waiting for external QA evidence before accepting delivery.',
          decisions: ['route_to(implementer, add missing QA evidence)'],
          nextActions: ['Resume with manual QA evidence from the parent conversation.'],
          artifacts: ['qa/checklist.md'],
          returnToOrchestratorCount: 1,
          openChatSessionId: childSessionId,
          openGraphRunId: runId,
          tracePreview: [
            {
              id: `event-${stamp}`,
              sequence: 1,
              type: 'qa_gate_waiting',
              message: 'Goal Guard paused at the QA gate.',
              nodeId: 'goal-master',
              createdAt: stamp + 40,
            },
          ],
        }),
        null,
        null,
        'call-agentflow',
        null,
        stamp + 40,
      );
    });

    seed();
    return { sessionId, childSessionId, runId, title };
  } finally {
    db.close();
  }
}

function seedSyntheticParentAgentFlowFixture(): { rootSessionId: string; childSessionId: string; title: string } {
  const stamp = Date.now();
  const rootSessionId = `arch-e2e-synthetic-${stamp}-root`;
  const childSessionId = `arch-e2e-synthetic-${stamp}-implementer`;
  const title = `Architecture: E2E synthetic parent ${stamp}`;
  const db = openDb();

  try {
    const insertSession = db.prepare(
      `INSERT INTO sessions (
        id, persona_id, title, kind, parent_session_id, parent_turn_id, parent_tool_call_id, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );

    const seed = db.transaction(() => {
      insertSession.run(
        rootSessionId,
        'default',
        title,
        'agent-flow',
        'architect-ui',
        null,
        null,
        stamp,
        stamp + 100,
      );
      insertSession.run(
        childSessionId,
        'default',
        `Goal Guard Delivery Loop: Implementer ${stamp}`,
        'subagent',
        rootSessionId,
        null,
        null,
        stamp + 10,
        stamp + 90,
      );
    });

    seed();
    return { rootSessionId, childSessionId, title };
  } finally {
    db.close();
  }
}

async function waitForAgentFlow(
  request: APIRequestContext,
  runId: string,
  terminal: (status: string) => boolean,
  attempts = 80,
) {
  let snapshot: {
    run: { status: string };
    result?: { status: string; summary?: string };
  } | null = null;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const response = await request.get(`${API_BASE}/agent-flows/runs/${runId}`);
    expect(response.ok()).toBeTruthy();
    snapshot = await response.json();
    if (terminal(snapshot.run.status)) {
      return snapshot;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`AgentFlow ${runId} did not reach expected terminal state; last=${snapshot?.run.status ?? 'missing'}`);
}

async function waitForParentAgentFlowRun(
  request: APIRequestContext,
  parentSessionId: string,
  terminal: (snapshot: AgentFlowRunSnapshot) => boolean,
  attempts = 90,
) {
  let snapshot: AgentFlowRunSnapshot | undefined;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const response = await request.get(`${API_BASE}/agent-flows/runs?parentSessionId=${encodeURIComponent(parentSessionId)}`);
    expect(response.ok()).toBeTruthy();
    const runs = await response.json() as AgentFlowRunSnapshot[];
    const match = runs.find((entry) => terminal(entry));
    if (match) {
      return match;
    }
    snapshot = runs.at(-1) ?? runs[0];
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`AgentFlow run for parent session ${parentSessionId} did not reach expected terminal state; last=${snapshot?.run.status ?? 'missing'}`);
}

async function waitForAuditEntry(
  request: APIRequestContext,
  predicate: (entry: { data?: unknown; type?: string; label?: string }) => boolean,
) {
  let rows: Array<{ data?: unknown; type?: string; label?: string }> = [];
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const response = await request.get(`${API_BASE}/audit-log?limit=500&type=architecture_event&sessionId=architect-ui`);
    expect(response.ok()).toBeTruthy();
    rows = await response.json();
    const match = rows.find(predicate);
    if (match) {
      return match;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Expected architecture audit entry was not recorded; rows=${rows.length}`);
}

async function createParentSession(request: APIRequestContext, title: string): Promise<string> {
  const response = await request.post(`${API_BASE}/sessions`, {
    data: { title, personaId: 'default' },
  });
  expect(response.ok()).toBeTruthy();
  const session = await response.json();
  expect(session.id).toBeTruthy();
  return session.id;
}

async function openArchitectRunModal(page: Page) {
  await page.getByTestId('architect-run-modal-open').click();
  await expect(page.getByTestId('architect-run-modal')).toBeVisible({ timeout: 10_000 });
}

async function startGoalGuardFromArchitectModal(page: Page) {
  await page.getByTestId('architect-start-goal-guard-flow').evaluate((node) => {
    if (!(node instanceof HTMLElement)) {
      throw new Error('Goal Guard start button is not clickable');
    }
    node.click();
  });
}

async function openDetailedExecutionGraph(page: Page) {
  await expect(page.getByTestId('execution-graph-view')).toBeVisible({ timeout: 10_000 });
  await page.getByRole('button', { name: 'More graph controls' }).click();
  await expect(page.getByTestId('graph-card-density-detailed')).toBeVisible({ timeout: 10_000 });
  await page.getByTestId('graph-card-density-detailed').click();
}

test.describe('Goal Guard AgentFlow from Architect UI', () => {
  test('shows AgentFlow roots with synthetic Architect parent in Conversations', async ({ page, request }) => {
    const fixture = seedSyntheticParentAgentFlowFixture();

    try {
      await page.goto('/');
      await page.getByTestId('nav-talk').click();
      await selectSessionOriginFilter(page, 'agent');
      const root = page.locator(`[data-testid="session-tree-root"][data-session-id="${fixture.rootSessionId}"]`);
      await expect(root).toBeVisible({ timeout: 10_000 });
      await expect(root).toContainText(fixture.title);
      await expect(page.locator(`[data-testid="session-item"][data-session-id="${fixture.childSessionId}"]`)).toBeVisible({ timeout: 10_000 });
    } finally {
      await deleteSessionIfExists(request, fixture.childSessionId);
      await deleteSessionIfExists(request, fixture.rootSessionId);
    }
  });

  test('renders parent run_sub_agentflow history bubble and QA waiting state in Talk', async ({ page, request }) => {
    test.setTimeout(90_000);
    const fixture = seedParentAgentFlowBubbleFixture();

    try {
      await page.goto('/');
      await page.getByTestId('nav-talk').click();
      await selectSession(page, fixture.sessionId, fixture.title);

      const agentFlowCall = page.locator('[data-testid="tool-call-bubble"][data-tool-name="run_sub_agentflow"]');
      await expect(agentFlowCall).toBeVisible({ timeout: 10_000 });
      await expect(agentFlowCall.getByTestId('sub-agentflow-result')).toContainText('waiting_on_orchestrator');
      await expect(agentFlowCall.getByTestId('sub-agentflow-result')).toContainText('Waiting on orchestrator');
      await expect(agentFlowCall.getByTestId('sub-agentflow-result')).toContainText('handoffs');
      await expect(agentFlowCall.getByTestId('sub-agentflow-result')).toContainText('1');
      await expect(agentFlowCall.getByTestId('sub-agentflow-result')).toContainText('Goal Guard is waiting for external QA evidence');
      await expect(agentFlowCall.getByTestId(`resume-agentflow-${fixture.runId}`)).toContainText('Resume AgentFlow');
      await agentFlowCall.getByRole('button', { name: /toggle agentflow details/i }).click();
      await expect(agentFlowCall.getByTestId('sub-agentflow-result')).toContainText('Resume with manual QA evidence');
      await expect(agentFlowCall.getByTestId('open-agentflow-canvas')).toBeVisible();
      await agentFlowCall.getByTestId('open-agentflow-canvas').click();
      await expect(page.getByTestId('agentflow-canvas-section')).toBeVisible({ timeout: 10_000 });
      await expect(page.getByTestId('agentflow-canvas-section')).toContainText('waiting_on_orchestrator');
      await expect(page.getByTestId('agentflow-canvas-section')).toContainText('Waiting on orchestrator');
      await expect(page.getByTestId('agentflow-canvas-section')).toContainText('Goal Guard is waiting for external QA evidence');
      await expect(page.getByTestId('agentflow-canvas-section').getByText('Resume AgentFlow')).toBeVisible();

      await page.getByTestId('talk-sidebar-graph-entry').click();
      await expect(page.getByTestId('execution-graph-view')).toBeVisible({ timeout: 10_000 });
      await expect(page.getByTestId('execution-graph-view')).toContainText('Goal Guard');
      await expect(page.getByTestId('execution-graph-view')).toContainText('waiting_on_orchestrator');

      await page.reload();
      await page.getByTestId('nav-talk').click();
      await selectSession(page, fixture.sessionId, fixture.title);

      const reloadedAgentFlowCall = page.locator('[data-testid="tool-call-bubble"][data-tool-name="run_sub_agentflow"]');
      await expect(reloadedAgentFlowCall).toBeVisible({ timeout: 10_000 });
      await expect(reloadedAgentFlowCall.getByTestId('sub-agentflow-result')).toContainText('waiting_on_orchestrator');
      await expect(reloadedAgentFlowCall.getByTestId('sub-agentflow-result')).toContainText('Waiting on orchestrator');
      await expect(reloadedAgentFlowCall.getByTestId('sub-agentflow-result')).toContainText('Goal Guard is waiting for external QA evidence');
      await expect(reloadedAgentFlowCall.getByTestId(`resume-agentflow-${fixture.runId}`)).toContainText('Resume AgentFlow');

      await reloadedAgentFlowCall.getByTestId('open-agentflow-canvas').click();
      await expect(page.getByTestId('agentflow-canvas-section')).toBeVisible({ timeout: 10_000 });
      await expect(page.getByTestId('agentflow-canvas-section')).toContainText('waiting_on_orchestrator');
      await expect(page.getByTestId('agentflow-canvas-section').getByText('Resume AgentFlow')).toBeVisible();

      await page.getByTestId('talk-sidebar-graph-entry').click();
      await expect(page.getByTestId('execution-graph-view')).toBeVisible({ timeout: 10_000 });
      await expect(page.getByTestId('execution-graph-view')).toContainText('Goal Guard');
      await expect(page.getByTestId('execution-graph-view')).toContainText('waiting_on_orchestrator');
    } finally {
      await deleteSessionIfExists(request, fixture.sessionId);
      await deleteSessionIfExists(request, fixture.childSessionId);
    }
  });

  test('starts a two-agent Goal Guard AgentFlow from Talk and opens its parent result graph', async ({ page, request }) => {
    test.setTimeout(180_000);
    test.skip(!(await isMockLlm(request)), 'Goal Guard AgentFlow E2E requires the mock LLM stack.');

    const title = `Talk-started AgentFlow ${Date.now()}`;
    const sessionId = await createParentSession(request, title);
    let childSessionId: string | undefined;

    try {
      await page.goto('/');
      await page.getByTestId('nav-talk').click();
      await selectSession(page, sessionId, title);

      await sendMessageFromComposer(page, [
        'Start the required Dev/Implementer <-> Goal Guard architecture from Talk.',
        'Use the native child AgentFlow tool, not the legacy council flow.',
        '[[mock:tool:run_sub_agentflow]]',
        '[[mock:goal-guard-vfs-success]]',
      ].join('\n'));

      const liveBubble = page.getByTestId('agent-turn-bubble').first();
      await expect(liveBubble).toBeVisible({ timeout: 10_000 });
      await expect(liveBubble.getByTestId('confirmation-confirm-btn')).toBeVisible({ timeout: 20_000 });
      await liveBubble.getByTestId('confirmation-confirm-btn').click();

      const parentResult = page.locator('[data-testid="tool-call-bubble"][data-tool-name="run_sub_agentflow"]').last();
      await expect(parentResult).toBeVisible({ timeout: 150_000 });

      const run = await waitForParentAgentFlowRun(request, sessionId, (snapshot) => (
        snapshot.run.status === 'done'
        || snapshot.run.status === 'waiting_on_orchestrator'
        || snapshot.result?.status === 'done'
        || snapshot.result?.status === 'waiting_on_orchestrator'
      ));
      childSessionId = run.result?.openChatSessionId ?? run.result?.childSessionId ?? run.run.childSessionId;
      expect(childSessionId).toBeTruthy();

      const parentTimeline = page.getByTestId('architecture-run-timeline').last();
      await expect(parentTimeline).toBeVisible({ timeout: 150_000 });
      await expect(parentTimeline).toContainText(/Goal Master Delivery Loop|Goal Guard|Architecture/i);
      await expect(parentTimeline).not.toContainText('Five Minds');

      await parentTimeline.getByTestId('open-architecture-run-canvas').click();
      await expect(page.getByTestId('architecture-run-canvas-section')).toBeVisible({ timeout: 10_000 });
      await expect(page.getByTestId('architecture-run-canvas-section')).toContainText(/Goal Master Delivery Loop|Goal Guard|Architecture/i);

      await page.getByTestId('talk-sidebar-graph-entry').click();
      await expect(page.getByTestId('execution-graph-view')).toBeVisible({ timeout: 10_000 });
      await expect(page.getByTestId('execution-graph-view')).toContainText(/Goal Guard|AgentFlow/i);
      await expect(page.getByTestId('execution-graph-view')).not.toContainText('Five Minds');
    } finally {
      await deleteSessionIfExists(request, sessionId);
      if (childSessionId) {
        await deleteSessionIfExists(request, childSessionId);
      }
    }
  });

  test('keeps a Talk-started durable AgentFlow result fresh after child completion and reload', async ({ page, request }) => {
    test.setTimeout(180_000);
    test.skip(!(await isMockLlm(request)), 'Goal Guard AgentFlow E2E requires the mock LLM stack.');

    const title = `Talk durable Goal Guard reload ${Date.now()}`;
    const sessionId = await createParentSession(request, title);
    let childSessionId: string | undefined;
    let runId: string | undefined;

    try {
      await page.goto('/');
      await page.getByTestId('nav-talk').click();
      await selectSession(page, sessionId, title);

      await sendMessageFromComposer(page, [
        'Run Goal Guard from Talk as a durable child flow and complete it without manual intervention.',
        'Use the native child AgentFlow tool, not the legacy council flow.',
        '[[mock:tool:run_sub_agentflow]]',
        '[[mock:goal-guard-vfs-success]]',
      ].join('\n'));

      const liveBubble = page.getByTestId('agent-turn-bubble').first();
      await expect(liveBubble).toBeVisible({ timeout: 10_000 });
      await expect(liveBubble.getByTestId('confirmation-confirm-btn')).toBeVisible({ timeout: 20_000 });
      await liveBubble.getByTestId('confirmation-confirm-btn').click();

      const parentResult = page.locator('[data-testid="tool-call-bubble"][data-tool-name="run_sub_agentflow"]').last();
      await expect(parentResult).toBeVisible({ timeout: 150_000 });
      const parentTimeline = page.getByTestId('architecture-run-timeline').last();
      await expect(parentTimeline).toBeVisible({ timeout: 150_000 });
      await expect(parentTimeline).toContainText(/Goal Master Delivery Loop|Goal Guard|Architecture/i);

      const snapshot = await waitForParentAgentFlowRun(request, sessionId, (run) => run.run.status === 'done' || run.result?.status === 'done');
      runId = snapshot.run.id;
      childSessionId = snapshot.result?.openChatSessionId
        ?? snapshot.result?.childSessionId
        ?? snapshot.run.childSessionId;
      expect(runId).toBeTruthy();

      await expect(parentTimeline).toContainText(/completed|done/i, { timeout: 45_000 });
      await expect(parentTimeline).not.toContainText('waiting_on_orchestrator');

      await page.getByTestId('talk-sidebar-graph-entry').click();
      await expect(page.getByTestId('execution-graph-view')).toBeVisible({ timeout: 10_000 });
      await expect(page.getByTestId('execution-graph-view')).toContainText('Goal Master Delivery Loop / completed', { timeout: 30_000 });
      await expect(page.getByTestId('execution-graph-view')).toContainText('Final response', { timeout: 30_000 });
      await expect(page.getByTestId('execution-graph-view')).not.toContainText('running');

      await page.reload();

      await page.getByTestId('nav-talk').click();
      await selectSession(page, sessionId, title);
      await page.getByTestId('talk-sidebar-conversation-entry').click();
      const timelineAfterReload = page.getByTestId('architecture-run-timeline').last();
      await expect(timelineAfterReload).toBeVisible({ timeout: 20_000 });
      await expect(timelineAfterReload).toContainText(/completed|done/i);
      await expect(timelineAfterReload).not.toContainText('waiting_on_orchestrator');
      await expect(timelineAfterReload).not.toContainText('Five Minds');

      await page.getByTestId('talk-sidebar-graph-entry').click();
      await expect(page.getByTestId('execution-graph-view')).toBeVisible({ timeout: 10_000 });
      await expect(page.getByTestId('execution-graph-view')).toContainText('Goal Master Delivery Loop / completed', { timeout: 20_000 });
      await expect(page.getByTestId('execution-graph-view')).toContainText('Final response', { timeout: 20_000 });
    } finally {
      await deleteSessionIfExists(request, sessionId);
      if (childSessionId) {
        await deleteSessionIfExists(request, childSessionId);
      }
    }
  });

  test('starts the two-agent delivery loop, writes Implementer VFS evidence, and renders graph state', async ({ page, request }, testInfo) => {
    test.setTimeout(180_000);
    test.skip(!(await isMockLlm(request)), 'Goal Guard AgentFlow E2E requires the mock LLM stack.');

    const marker = `e2e-${Date.now()}`;
    const task = [
      `Create deterministic VFS proof for ${marker}.`,
      'Use the Goal Guard delivery loop and accept only if evidence exists.',
      '[[mock:goal-guard-vfs-success]]',
      '[[mock:script]]',
      'when("Slot: Orchestrator") return("route_to(implementer, plan one implementation pass and one guard pass)")',
      'when("Slot: Tester") return("Regression check passed after reading Implementer write evidence.")',
      'when("Slot: Finalizer") return("Goal Guard accepted deterministic VFS evidence for the requested task.")',
      '[[/mock:script]]',
    ].join('\n');

    await page.goto('/');
    await page.getByTestId('nav-architect').click();
    await expect(page.getByTestId('architect-page')).toBeVisible();
    await openArchitectRunModal(page);
    await page.getByTestId('architect-goal-master-loop-proof').check();
    await page.getByTestId('architect-implementer-write-proof').check();
    await page.getByTestId('architect-task-input').fill(task);
    await startGoalGuardFromArchitectModal(page);

    await expect(page.getByText('Run in progress')).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('.badge').filter({ hasText: /completed|done/i }).first()).toBeVisible({ timeout: 150_000 });

    await page.getByTestId('architect-projection-graph').click();
    await expect(page.getByTestId('architect-graph-status')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId('architect-graph-status')).toContainText('Implementer');
    await expect(page.getByTestId('architect-graph-status')).toContainText('Goal Master');
    await expect(page.getByTestId('architect-graph-status')).not.toContainText('Five Minds');
    await expect(page.getByTestId('architect-executed-route')).toBeVisible({ timeout: 10_000 });

    const graphScreenshot = await page.screenshot({ fullPage: true });
    await testInfo.attach('goal-guard-agentflow-graph', {
      body: graphScreenshot,
      contentType: 'image/png',
    });

    await page.getByTestId('architect-projection-chat').click();
    await expect(
      page.getByTestId('architect-chat-message')
        .filter({ hasText: 'Goal Guard accepted deterministic VFS evidence' })
        .last(),
    ).toBeVisible({ timeout: 30_000 });

    const chatScreenshot = await page.screenshot({ fullPage: true });
    await testInfo.attach('goal-guard-agentflow-chat', {
      body: chatScreenshot,
      contentType: 'image/png',
    });
  });

  test('starts strict two-agent proof from the FE and requires Implementer write evidence', async ({ page, request }) => {
    test.setTimeout(180_000);
    test.skip(!(await isMockLlm(request)), 'Goal Guard AgentFlow E2E requires the mock LLM stack.');

    await page.setViewportSize({ width: 1600, height: 900 });
    const marker = `strict-impl-e2e-${Date.now()}`;
    const expectedMaxSteps = 64;
    const expectedMaxNodeVisits = 4;
    const task = [
      `Create strict Implementer-owned VFS proof for ${marker}.`,
      'Goal Guard must accept only after the Implementer itself has visible write evidence.',
      '[[mock:goal-guard-vfs-success]]',
      '[[mock:script]]',
      'when("Slot: Orchestrator") return("route_to(implementer, require Implementer-owned write proof before Goal Guard review)")',
      'when("Slot: Tester") return("Regression check passed after reading Implementer-owned evidence.")',
      'when("Slot: Finalizer") return("Goal Guard accepted strict Implementer-owned VFS evidence.")',
      '[[/mock:script]]',
    ].join('\n');

    await page.goto('/');
    await page.getByTestId('nav-architect').click();
    await expect(page.getByTestId('architect-page')).toBeVisible();
    await openArchitectRunModal(page);
    await page.getByTestId('architect-goal-master-loop-proof').check();
    await page.getByTestId('architect-implementer-write-proof').check();
    await page.getByTestId('architect-max-steps').fill(String(expectedMaxSteps));
    await page.getByTestId('architect-max-node-visits').fill(String(expectedMaxNodeVisits));
    await page.getByTestId('architect-task-input').fill(task);
    const startRequestPromise = page.waitForRequest((req) =>
      req.method() === 'POST' && req.url().includes('/api/agent-flows/runs'));
    await startGoalGuardFromArchitectModal(page);
    const startRequest = await startRequestPromise;
    const startPayload = startRequest.postDataJSON() as {
      flowId?: string;
      parentSessionId?: string;
      startMode?: string;
      returnMode?: string;
      maxSteps?: number;
      context?: {
        maxArchitectureSteps?: number;
        maxArchitectureNodeVisits?: number;
        requireGoalMasterLoopProof?: boolean;
        requireImplementerWriteProof?: boolean;
      };
    };
    expect(startPayload.flowId).toBe('goal_guard_delivery_loop');
    expect(startPayload.parentSessionId).toBe('architect-ui');
    expect(startPayload.startMode).toBe('durable');
    expect(startPayload.returnMode).toBe('summary');
    expect(startPayload.maxSteps).toBe(expectedMaxSteps);
    expect(startPayload.context).toEqual(expect.objectContaining({
      maxArchitectureSteps: expectedMaxSteps,
      maxArchitectureNodeVisits: expectedMaxNodeVisits,
      requireGoalMasterLoopProof: true,
      requireImplementerWriteProof: true,
    }));

    await expect(page.locator('.badge').filter({ hasText: /completed|done/i }).first()).toBeVisible({ timeout: 150_000 });

    const runsResponse = await request.get(`${API_BASE}/agent-flows/runs?parentSessionId=architect-ui`);
    expect(runsResponse.ok()).toBeTruthy();
    const runs = await runsResponse.json();
    const runId = runs.find((snapshot: { run?: { checkpoint?: { goal?: string }; id?: string } }) =>
      snapshot.run?.checkpoint?.goal?.includes(marker))?.run?.id;
    expect(runId).toBeTruthy();
    const matchingRun = runs.find((snapshot: {
      run?: {
        checkpoint?: { goal?: string };
        openChatSessionId?: string;
        childSessionId?: string;
      };
      result?: { openChatSessionId?: string };
    }) => snapshot.run?.checkpoint?.goal?.includes(marker));
    const rootSessionId = matchingRun?.run?.openChatSessionId
      ?? matchingRun?.result?.openChatSessionId
      ?? matchingRun?.run?.childSessionId;
    expect(rootSessionId).toBeTruthy();

    const eventsResponse = await request.get(`${API_BASE}/agent-flows/runs/${runId}/events`);
    expect(eventsResponse.ok()).toBeTruthy();
    const events = await eventsResponse.json();
    const implementerOutput = events.find((event: {
      roleSlotId?: string;
      type?: string;
      data?: { sourceEventType?: string; toolEvidence?: { successfulToolNames?: string[] } };
    }) => (
      event.type === 'flow:node_result'
      && event.data?.sourceEventType === 'participant_output'
      && event.roleSlotId === 'implementer'
      && event.data?.toolEvidence?.successfulToolNames?.includes('vfs_write')
    ));
    expect(implementerOutput).toBeTruthy();
    expect(events.some((event: { roleSlotId?: string; type?: string; data?: { sourceEventType?: string }; route?: { nextNodeId?: string } }) =>
      event.type === 'flow:guard_result'
      && event.data?.sourceEventType === 'router_decision'
      && event.roleSlotId === 'goal_master'
      && event.route?.nextNodeId)).toBeTruthy();
    expect(JSON.stringify(events)).not.toContain('five-minds');

    await waitForAuditEntry(request, (entry) => {
      const data = entry.data as { runId?: string; eventType?: string; roleSlotId?: string; toolEvidence?: { successfulToolNames?: string[] } } | undefined;
      return data?.runId === runId
        && data.eventType === 'participant_output'
        && data.roleSlotId === 'implementer'
        && data.toolEvidence?.successfulToolNames?.includes('vfs_write') === true;
    });

    await page.getByTestId('architect-projection-graph').click();
    await expect(page.getByTestId('architect-graph-status')).toContainText('Implementer');
    await expect(page.getByTestId('architect-graph-status')).toContainText('Goal Master');
    await expect(page.getByTestId('architect-graph-status')).not.toContainText('Five Minds');
    const talkRootLocator = page.locator(`[data-testid="session-tree-root"][data-session-id="${rootSessionId}"]`);

    await page.getByTestId('nav-talk').click();
    await selectSessionOriginFilter(page, 'agent');
    await expect(talkRootLocator).toBeVisible({ timeout: 10_000 });
    await expect(talkRootLocator).toContainText(GOAL_FLOW_ROOT_LABEL);
    await expect(talkRootLocator).not.toContainText(/Five Minds/i);
    await talkRootLocator.click();
    await page.getByTestId('talk-sidebar-graph-entry').click();
    await openDetailedExecutionGraph(page);
    await expect(page.getByTestId('execution-graph-view')).toContainText('Implementer', { timeout: 10_000 });
    await expect(page.getByTestId('execution-graph-view')).toContainText('Goal Guard accepted strict Implementer-owned VFS evidence', { timeout: 10_000 });
    await expect(page.getByTestId('execution-graph-view')).toContainText('Goal Master Delivery Loop', { timeout: 10_000 });
    await expect(page.getByTestId('execution-graph-view')).not.toContainText(/Five Minds/i);
  });

  test('does not accept Goal Guard AgentFlow when Implementer write evidence is missing', async ({ request }) => {
    test.setTimeout(90_000);
    test.skip(!(await isMockLlm(request)), 'Goal Guard AgentFlow E2E requires the mock LLM stack.');

    const parentSessionId = await createParentSession(request, 'E2E missing Implementer write parent');
    const response = await request.post(`${API_BASE}/agent-flows/runs`, {
      data: {
        flowId: 'goal_guard_delivery_loop',
        goal: [
          'Try to accept a delivery without Implementer-written files.',
          'Goal Master must not accept prose-only completion.',
          '[[mock:script]]',
          'when("Slot: Orchestrator") return("route_to(implementer, plan one implementation pass)")',
          'when("Slot: Implementer") return("Implementation complete in prose only.")',
          'when("Slot: Goal Master") return("Goal Master accepts prose-only work. route_to(final-artifact, accepted)")',
          '[[/mock:script]]',
        ].join('\n'),
        parentSessionId,
        startMode: 'durable',
        returnMode: 'summary',
        maxSteps: 12,
        context: {
          maxArchitectureSteps: 12,
          maxArchitectureNodeVisits: 1,
          requireGoalMasterLoopProof: true,
          requireImplementerWriteProof: true,
        },
      },
    });
    expect(response.ok()).toBeTruthy();
    const started = await response.json();

    const snapshot = await waitForAgentFlow(
      request,
      started.run.id,
      (status) => status === 'failed' || status === 'waiting_on_orchestrator' || status === 'blocked',
    );

    expect(snapshot.run.status).not.toBe('done');
    expect(snapshot.result?.status).not.toBe('done');
    expect(JSON.stringify(snapshot)).toContain('Architecture tool executor implementer completed without required tool evidence: implementer did not produce a successful write result');
  });

  test('rejects unknown AgentFlow schemas without creating a durable run', async ({ request }) => {
    test.setTimeout(30_000);
    test.skip(!(await isMockLlm(request)), 'Goal Guard AgentFlow E2E requires the mock LLM stack.');

    const parentSessionId = await createParentSession(request, 'E2E invalid AgentFlow schema parent');
    const beforeResponse = await request.get(`${API_BASE}/agent-flows/runs`);
    expect(beforeResponse.ok()).toBeTruthy();
    const beforeRuns = await beforeResponse.json();

    const response = await request.post(`${API_BASE}/agent-flows/runs`, {
      data: {
        flowId: 'unknown_goal_guard_schema',
        goal: 'This run must fail before any durable AgentFlow state is created.',
        parentSessionId,
        startMode: 'durable',
        returnMode: 'summary',
        maxSteps: 4,
      },
    });

    expect(response.status()).toBe(404);
    const body = await response.text();
    expect(body).toContain('Architecture schema unknown_goal_guard_schema not found');

    const afterResponse = await request.get(`${API_BASE}/agent-flows/runs`);
    expect(afterResponse.ok()).toBeTruthy();
    const afterRuns = await afterResponse.json();
    expect(afterRuns).toHaveLength(beforeRuns.length);
    expect(JSON.stringify(afterRuns)).not.toContain('unknown_goal_guard_schema');
  });

  test('resumes a bounded waiting AgentFlow and reaches completion', async ({ request }) => {
    test.setTimeout(120_000);
    test.skip(!(await isMockLlm(request)), 'Goal Guard AgentFlow E2E requires the mock LLM stack.');

    const marker = `resume-e2e-${Date.now()}`;
    const parentSessionId = await createParentSession(request, 'E2E resumable AgentFlow parent');
    const startResponse = await request.post(`${API_BASE}/agent-flows/runs`, {
      data: {
        flowId: 'goal_guard_delivery_loop',
        goal: [
          `Create resumable deterministic VFS proof for ${marker}.`,
          'Pause is expected on the first bounded pass; completion is expected only after resume.',
          '[[mock:goal-guard-vfs-success]]',
          '[[mock:script]]',
          'when("Slot: Orchestrator") return("route_to(implementer, plan one implementation pass and one guard pass)")',
          'when("Slot: Tester") return("Regression check passed after reading Implementer write evidence.")',
          'when("Slot: Finalizer") return("Goal Guard accepted resumable deterministic VFS evidence.")',
          '[[/mock:script]]',
        ].join('\n'),
        parentSessionId,
        startMode: 'durable',
        returnMode: 'summary',
        maxSteps: 2,
        context: {
          maxArchitectureSteps: 2,
          maxArchitectureNodeVisits: 2,
          requireGoalMasterLoopProof: true,
          requireImplementerWriteProof: true,
        },
      },
    });
    expect(startResponse.ok()).toBeTruthy();
    const started = await startResponse.json();

    const waiting = await waitForAgentFlow(
      request,
      started.run.id,
      (status) => status === 'waiting_on_orchestrator',
    );
    expect(waiting.run.checkpoint?.continuation).toBeTruthy();

    const resumeResponse = await request.post(`${API_BASE}/agent-flows/runs/${started.run.id}/resume`, {
      data: {
        input: 'Continue the Goal Guard loop and finish only with Implementer write evidence.',
        maxSteps: 20,
        context: {
          maxArchitectureSteps: 20,
          maxArchitectureNodeVisits: 4,
          requireImplementerWriteProof: true,
        },
      },
    });
    expect(resumeResponse.ok()).toBeTruthy();

    const completed = await waitForAgentFlow(
      request,
      started.run.id,
      (status) => status === 'done',
    );

    expect(completed.result?.status).toBe('done');
    expect(completed.events.some((event) => event.type === 'flow:waiting_on_orchestrator')).toBeTruthy();
    expect(completed.events.some((event) => event.type === 'flow:resume_input')).toBeTruthy();
    expect(completed.result?.flowDefinitionId).toBe('goal_guard_delivery_loop');
  });

  test('resumes a bounded waiting AgentFlow from the FE and records passing QA evidence', async ({ page, request }) => {
    test.setTimeout(180_000);
    test.skip(!(await isMockLlm(request)), 'Goal Guard AgentFlow E2E requires the mock LLM stack.');

    await page.setViewportSize({ width: 1600, height: 900 });
    const marker = `fe-resume-pass-e2e-${Date.now()}`;
    const task = [
      `Create FE-resumable deterministic VFS proof for ${marker}.`,
      'The first bounded pass should pause before completion.',
      'After passing Playwright QA evidence from the FE, Goal Guard may accept.',
      '[[mock:goal-guard-vfs-success]]',
      '[[mock:script]]',
      'when("Slot: Orchestrator") return("route_to(implementer, plan one implementation pass and one guard pass)")',
      'when("Slot: Tester") return("Regression check passed after reading Implementer write evidence.")',
      'when("Slot: Finalizer") return("Goal Guard accepted FE-resumed deterministic VFS evidence.")',
      '[[/mock:script]]',
    ].join('\n');

    await page.goto('/');
    await page.getByTestId('nav-architect').click();
    await expect(page.getByTestId('architect-page')).toBeVisible();
    await openArchitectRunModal(page);
    await page.getByTestId('architect-max-steps').fill('2');
    await page.getByTestId('architect-max-node-visits').fill('4');
    await page.getByTestId('architect-goal-master-loop-proof').check();
    await page.getByTestId('architect-implementer-write-proof').check();
    await page.getByTestId('architect-task-input').fill(task);
    await startGoalGuardFromArchitectModal(page);

    await expect(page.getByRole('button', { name: /Resume with QA evidence/i })).toBeVisible({ timeout: 120_000 });

    const runsResponse = await request.get(`${API_BASE}/agent-flows/runs?parentSessionId=architect-ui`);
    expect(runsResponse.ok()).toBeTruthy();
    const runs = await runsResponse.json();
    const runId = runs.find((snapshot: { run?: { checkpoint?: { goal?: string }; status?: string } }) =>
      snapshot.run?.checkpoint?.goal?.includes(marker))?.run?.id;
    expect(runId).toBeTruthy();

    await openArchitectRunModal(page);
    await page.getByTestId('architect-max-steps').fill('20');
    await page.getByTestId('architect-run-modal-close').click();
    await page.getByRole('button', { name: /Resume with QA evidence/i }).click();
    await page.getByTestId('agentflow-qa-summary').fill('Playwright Orchestrator passed focus, layout, and build gates.');
    await page.getByTestId('agentflow-qa-high-findings').fill('0');
    await page.getByTestId('agentflow-qa-artifact').fill('C:\\qa\\passed-focus.png');
    await page.getByTestId('agentflow-resume-with-qa').click();

    const resumed = await waitForAgentFlow(
      request,
      runId,
      (status) => status === 'running' || status === 'waiting_on_orchestrator' || status === 'done',
    );

    expect(resumed.run.status).not.toBe('failed');
    expect(resumed.run.status).not.toBe('blocked');
    expect(resumed.events.some((event) => event.type === 'flow:waiting_on_orchestrator')).toBeTruthy();
    expect(resumed.events.some((event) => event.type === 'flow:resume_input')).toBeTruthy();
    expect(JSON.stringify(resumed.run.checkpoint?.resumeContext ?? {})).toContain('Playwright Orchestrator passed');
    expect(JSON.stringify(resumed.events)).toContain('Implementer wrote e2e/goal-guard-proof.json');
    await page.getByTestId('architect-projection-graph').click();
    await expect(page.getByTestId('architect-graph-status')).toContainText('Goal Master');
    await expect(page.getByTestId('architect-graph-status')).not.toContainText('Five Minds');
    const stopButton = page.getByRole('button', { name: /^Stop$/ });
    if (await stopButton.isVisible().catch(() => false)) {
      await stopButton.click();
    }
  });

  test('keeps a FE-started Goal Guard run visible in Talk and Execution Graph after failing structured QA evidence', async ({ page, request }) => {
    test.setTimeout(180_000);
    test.skip(!(await isMockLlm(request)), 'Goal Guard AgentFlow E2E requires the mock LLM stack.');

    await page.setViewportSize({ width: 1600, height: 900 });
    const marker = `qa-gate-e2e-${Date.now()}`;
    const task = [
      `Create deterministic VFS proof for ${marker}.`,
      'The first bounded pass should pause before completion.',
      'After resume, external Playwright QA evidence must route back instead of accepting.',
      '[[mock:goal-guard-vfs-success]]',
      '[[mock:script]]',
      'when("Slot: Orchestrator") return("route_to(implementer, plan one implementation pass and one guard pass)")',
      'when("Slot: Tester") return("Regression check passed after reading Implementer write evidence.")',
      'when("Slot: Finalizer") return("Goal Guard accepted QA-gated deterministic VFS evidence.")',
      '[[/mock:script]]',
    ].join('\n');

    await page.goto('/');
    await page.getByTestId('nav-architect').click();
    await expect(page.getByTestId('architect-page')).toBeVisible();
    await openArchitectRunModal(page);
    await page.getByTestId('architect-max-steps').fill('2');
    await page.getByTestId('architect-max-node-visits').fill('4');
    await page.getByTestId('architect-goal-master-loop-proof').check();
    await page.getByTestId('architect-implementer-write-proof').check();
    await page.getByTestId('architect-task-input').fill(task);
    await startGoalGuardFromArchitectModal(page);

    await expect(page.getByRole('button', { name: /Resume with QA evidence/i })).toBeVisible({ timeout: 120_000 });

    const runsResponse = await request.get(`${API_BASE}/agent-flows/runs?parentSessionId=architect-ui`);
    expect(runsResponse.ok()).toBeTruthy();
    const runs = await runsResponse.json() as Array<{
      run?: {
        id?: string;
        status?: string;
        checkpoint?: { goal?: string };
        childSessionId?: string;
        openChatSessionId?: string;
      };
      result?: {
        status?: string;
        childSessionId?: string;
        openChatSessionId?: string;
      };
    }>;
    const matchingRun = runs.find((snapshot) => snapshot.run?.checkpoint?.goal?.includes(marker));
    const runId = matchingRun?.run?.id;
    const rootSessionId = matchingRun?.run?.openChatSessionId
      ?? matchingRun?.result?.openChatSessionId
      ?? matchingRun?.run?.childSessionId
      ?? matchingRun?.result?.childSessionId;
    expect(runId).toBeTruthy();
    expect(rootSessionId).toBeTruthy();

    await page.getByTestId('architect-projection-graph').click();
    await expect(page.getByTestId('architect-graph-status')).toContainText(/Implementer/i);
    await expect(page.getByTestId('architect-graph-status')).toContainText(/Goal Guard|Goal Master/i);
    await expect(page.getByTestId('architect-graph-status')).not.toContainText('Five Minds');

    await page.getByRole('button', { name: /Resume with QA evidence/i }).click();
    await page.getByTestId('agentflow-qa-summary').fill('Fake final QA claim: focus audit still finds offscreen footer links.');
    await page.getByTestId('agentflow-qa-high-findings').fill('3');
    await page.getByTestId('agentflow-qa-artifact').fill('C:\\qa\\focus.png');
    await page.getByTestId('agentflow-resume-with-qa').click();

    const resumed = await waitForAgentFlow(
      request,
      runId,
      (status) => status === 'waiting_on_orchestrator' || status === 'failed' || status === 'blocked',
    );

    expect(resumed.run.status).not.toBe('done');
    expect(resumed.result?.status).not.toBe('done');
    expect(resumed.events.some((event) => event.type === 'flow:waiting_on_orchestrator')).toBeTruthy();
    expect(resumed.events.some((event) => event.type === 'flow:resume_input')).toBeTruthy();
    expect(JSON.stringify(resumed.run.checkpoint?.resumeContext ?? {})).toContain('Fake final QA claim');
    expect(JSON.stringify(resumed.run.checkpoint?.resumeContext ?? {})).toContain('focus audit still finds offscreen footer links');
    expect(JSON.stringify(resumed.run.checkpoint?.resumeContext ?? {})).toContain('"highFindings":3');
    expect(JSON.stringify(resumed.events)).toContain('playwright');
    await expect(page.locator('.badge').filter({ hasText: /completed|done/i }).first()).not.toBeVisible();
    await expect(page.getByRole('button', { name: /Resume with QA evidence/i })).toBeVisible({ timeout: 30_000 });

    await page.getByTestId('nav-talk').click();
    await selectSessionOriginFilter(page, 'agent');
    const talkRootLocator = page.locator(`[data-testid="session-tree-root"][data-session-id="${rootSessionId}"]`);
    await expect(talkRootLocator).toBeVisible({ timeout: 10_000 });
    await expect(talkRootLocator).toContainText(GOAL_FLOW_ROOT_LABEL);
    await expect(talkRootLocator).not.toContainText(/Five Minds/i);
    await talkRootLocator.click();
    await page.getByTestId('talk-sidebar-graph-entry').click();
    await openDetailedExecutionGraph(page);
    await expect(page.getByTestId('execution-graph-view')).toContainText('Implementer', { timeout: 10_000 });
    await expect(page.getByTestId('execution-graph-view')).toContainText('Goal Master Delivery Loop', { timeout: 10_000 });
    await expect(page.getByTestId('execution-graph-view')).not.toContainText(/Five Minds/i);
  });
});

test.describe('AgentFlow allowance inheritance API', () => {
  test('inherits parent session projectPath when child AgentFlow starts without explicit context', async ({ request }) => {
    const stamp = Date.now();
    const parentTitle = `Allowance parent ${stamp}`;
    const parentResponse = await request.post(`${API_BASE}/sessions`, {
      data: {
        title: parentTitle,
        personaId: 'default',
        runtimeContext: {
          runtimeKind: 'agent-flow-branch',
          architectureContext: {
            projectPath: 'C:\\Projekty\\kalio-forever',
            executionCwd: 'C:\\Projekty\\kalio-forever',
          },
        },
      },
    });
    expect(parentResponse.ok()).toBeTruthy();
    const parent = await parentResponse.json() as { id: string };

    try {
      const startResponse = await request.post(`${API_BASE}/agent-flows/runs`, {
        data: {
          flowId: 'goal_guard_delivery_loop',
          goal: `Inherit allowance ${stamp}`,
          parentSessionId: parent.id,
        },
      });
      expect(startResponse.ok()).toBeTruthy();
      const started = await startResponse.json() as {
        run: {
          id: string;
          checkpoint?: { context?: Record<string, unknown> };
        };
      };

      expect(started.run.checkpoint?.context).toMatchObject({
        projectPath: 'C:\\Projekty\\kalio-forever',
        executionCwd: 'C:\\Projekty\\kalio-forever',
      });

      const refreshResponse = await request.get(`${API_BASE}/agent-flows/runs/${started.run.id}`);
      expect(refreshResponse.ok()).toBeTruthy();
      const refreshed = await refreshResponse.json() as {
        run: { checkpoint?: { context?: Record<string, unknown> } };
      };
      expect(refreshed.run.checkpoint?.context).toMatchObject({
        projectPath: 'C:\\Projekty\\kalio-forever',
        executionCwd: 'C:\\Projekty\\kalio-forever',
      });
    } finally {
      await deleteSessionIfExists(request, parent.id);
    }
  });

  test('keeps orchestrator scope restriction marker in checkpoint after refresh', async ({ request }) => {
    const stamp = Date.now();
    const parentResponse = await request.post(`${API_BASE}/sessions`, {
      data: {
        title: `Restricted parent ${stamp}`,
        personaId: 'default',
      },
    });
    expect(parentResponse.ok()).toBeTruthy();
    const parent = await parentResponse.json() as { id: string };

    try {
      const startResponse = await request.post(`${API_BASE}/agent-flows/runs`, {
        data: {
          flowId: 'goal_guard_delivery_loop',
          goal: `Restricted allowance ${stamp}`,
          parentSessionId: parent.id,
          context: {
            orchestratorScopeRestriction: { reason: 'folder scoped run' },
            projectPath: 'C:\\Projekty\\kalio-forever\\sub',
            executionCwd: 'C:\\Projekty\\kalio-forever\\sub',
          },
        },
      });
      expect(startResponse.ok()).toBeTruthy();
      const started = await startResponse.json() as {
        run: {
          id: string;
          checkpoint?: { context?: Record<string, unknown> };
        };
      };

      expect(started.run.checkpoint?.context).toMatchObject({
        orchestratorScopeRestriction: { reason: 'folder scoped run' },
        projectPath: 'C:\\Projekty\\kalio-forever\\sub',
        executionCwd: 'C:\\Projekty\\kalio-forever\\sub',
      });

      const refreshResponse = await request.get(`${API_BASE}/agent-flows/runs/${started.run.id}`);
      expect(refreshResponse.ok()).toBeTruthy();
      const refreshed = await refreshResponse.json() as {
        run: { checkpoint?: { context?: Record<string, unknown> } };
      };
      expect(refreshed.run.checkpoint?.context).toMatchObject({
        orchestratorScopeRestriction: { reason: 'folder scoped run' },
        projectPath: 'C:\\Projekty\\kalio-forever\\sub',
      });
    } finally {
      await deleteSessionIfExists(request, parent.id);
    }
  });
});
