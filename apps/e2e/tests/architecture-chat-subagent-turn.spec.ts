import { expect, test, type APIRequestContext } from '@playwright/test';
import {
  API_BASE,
  deleteSessionIfExists,
  selectArchitectureInComposer,
  selectSession,
  selectSessionOriginFilter,
  sendMessageFromComposer,
} from './helpers/test-config';

type ArchitectureSessionListItem = {
  id: string;
  parentSessionId?: string;
  title: string;
  runtimeContext?: {
    architectureContext?: {
      architectureRunId?: string;
      projectPath?: string;
    };
  };
};

type ArchitectureGraphResponse = {
  status?: string;
  nodes?: Array<{
    id: string;
    kind: string;
    status?: string;
  }>;
};

type ArchitectureChatResponse = {
  messages?: Array<{
    speaker?: string;
    content?: string;
  }>;
};

function isRetryableApiTransportError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /ECONNRESET|ECONNREFUSED|socket hang up|ERR_CONNECTION_RESET/i.test(message);
}

async function delay(ms: number): Promise<void> {
  await new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function getJsonWithTransportRetry<T>(
  request: APIRequestContext,
  url: string,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await request.get(url, { timeout: 15_000 });
      expect(response.ok()).toBeTruthy();
      return await response.json() as T;
    } catch (error) {
      lastError = error;
      if (!isRetryableApiTransportError(error) || attempt === 2) {
        throw error;
      }
      await delay(250 * (attempt + 1));
    }
  }

  throw lastError;
}

async function waitForArchitectureRunCompleted(
  request: APIRequestContext,
  runId: string,
  timeoutMs = 180_000,
): Promise<void> {
  await expect
    .poll(async () => {
      const graphResponse = await request.get(`${API_BASE}/architecture-runs/${runId}/graph`);
      const chatResponse = await request.get(`${API_BASE}/architecture-runs/${runId}/chat`);
      if (!graphResponse.ok() || !chatResponse.ok()) {
        return `http:${graphResponse.status()}:${chatResponse.status()}`;
      }

      const graph = await graphResponse.json() as ArchitectureGraphResponse;
      const chat = await chatResponse.json() as ArchitectureChatResponse;
      const finalizerNode = graph.nodes?.find((node) => node.id === 'final-artifact' || node.kind === 'artifact');
      const hasFinalizerMessage = chat.messages?.some((message) => (
        message.speaker === 'finalizer'
        && typeof message.content === 'string'
        && message.content.trim().length > 0
      )) ?? false;

      return `${graph.status ?? 'missing'}:${finalizerNode?.status ?? 'missing'}:${hasFinalizerMessage ? 'finalizer-message' : 'missing-finalizer-message'}`;
    }, { timeout: timeoutMs })
    .toBe('completed:completed:finalizer-message');
}

async function getSession(
  request: APIRequestContext,
  sessionId: string,
): Promise<ArchitectureSessionListItem> {
  return getJsonWithTransportRetry<ArchitectureSessionListItem>(
    request,
    `${API_BASE}/sessions/${encodeURIComponent(sessionId)}`,
  );
}

async function getSessionDescendants(
  request: APIRequestContext,
  rootSessionId: string,
): Promise<ArchitectureSessionListItem[]> {
  const descendants: ArchitectureSessionListItem[] = [];
  const seen = new Set<string>();
  const queue = [rootSessionId];

  while (queue.length > 0) {
    const parentSessionId = queue.shift();
    if (!parentSessionId) {
      continue;
    }

    const children = await getJsonWithTransportRetry<ArchitectureSessionListItem[]>(
      request,
      `${API_BASE}/sessions/${encodeURIComponent(parentSessionId)}/children`,
    );
    for (const child of children) {
      if (seen.has(child.id)) {
        continue;
      }
      seen.add(child.id);
      descendants.push(child);
      queue.push(child.id);
    }
  }

  return descendants;
}

test.describe('Architecture chat turn projection', () => {
  test('renders a sequential router chain without collapsing it into a parallel council', async ({ page, request }) => {
    test.setTimeout(120_000);
    const title = `Architecture Sequential E2E ${Date.now()}`;
    const schemaName = `Sequential Router Chain ${Date.now()}`;
    const variantResponse = await request.post(`${API_BASE}/architecture-registry/schemas/strategic-decision-council/variants`, {
      data: {
        name: schemaName,
        description: 'E2E sequential router chain variant.',
        nodes: [
          {
            id: 'router-entry',
            label: 'Router Entry',
            kind: 'router',
            roleSlotId: 'router',
            behavior: {
              mode: 'choose_one',
              fanOut: 'sequential',
            },
          },
          { id: 'pragmatist', label: 'Pragmatist', kind: 'role', roleSlotId: 'pragmatist' },
          {
            id: 'router-check',
            label: 'Router Check',
            kind: 'router',
            roleSlotId: 'router',
            behavior: {
              mode: 'choose_one',
              fanOut: 'sequential',
            },
          },
          { id: 'innovator', label: 'Innovator', kind: 'role', roleSlotId: 'innovator' },
          {
            id: 'router-final',
            label: 'Router Final',
            kind: 'router',
            roleSlotId: 'router',
            behavior: {
              mode: 'rank_then_merge',
              fanOut: 'sequential',
            },
          },
          {
            id: 'final-artifact',
            label: 'Final Artifact',
            kind: 'artifact',
            roleSlotId: 'finalizer',
            behavior: { mode: 'finalize' },
          },
        ],
        edges: [
          { id: 'router-entry-pragmatist', fromNodeId: 'router-entry', toNodeId: 'pragmatist' },
          { id: 'pragmatist-router-check', fromNodeId: 'pragmatist', toNodeId: 'router-check' },
          { id: 'router-check-innovator', fromNodeId: 'router-check', toNodeId: 'innovator' },
          { id: 'innovator-router-final', fromNodeId: 'innovator', toNodeId: 'router-final' },
          { id: 'router-final-final-artifact', fromNodeId: 'router-final', toNodeId: 'final-artifact', selection: 'converge' },
        ],
        contextPolicy: {
          includeUserTask: true,
          includeProjectMemory: false,
          includeBrowserSession: false,
          includePriorDecisions: false,
          includeOtherAgentOutputs: true,
        },
      },
    });
    expect(variantResponse.ok()).toBeTruthy();
    const variant = await variantResponse.json() as { id: string };

    const response = await request.post(`${API_BASE}/sessions`, {
      data: { title, personaId: 'default' },
    });
    expect(response.ok()).toBeTruthy();
    const session = await response.json() as { id: string };

    try {
      await page.goto('/');
      await page.getByTestId('nav-talk').click();
      await selectSession(page, session.id, title);

      await selectArchitectureInComposer(page, variant.id);
      await sendMessageFromComposer(page, 'Route this through the sequential chain.');

      await expect(page.getByTestId('agent-turn-bubble')).toHaveCount(1, { timeout: 90_000 });
      await expect(page.getByTestId('architecture-run-timeline')).toBeVisible({ timeout: 90_000 });
      await expect(page.getByTestId('agent-turn-bubble')).toContainText('Router -> Pragmatist -> Router -> Innovator -> Router -> Finalizer', { timeout: 90_000 });
      await expect(page.getByTestId('architecture-route-parallel-agents')).toHaveCount(0);
      await expect(page.getByTestId('architecture-route-agent')).toHaveCount(2);
      await expect(page.getByTestId('architecture-route-router')).toHaveCount(3);
      await expect(page.getByTestId('agent-turn-bubble')).not.toContainText('Execution trace:');

      await page.getByTestId('open-architecture-run-canvas').click();
      await expect(page.getByTestId('architecture-run-canvas-section')).toBeVisible({ timeout: 10_000 });
      await expect(page.getByTestId('architecture-run-routing')).toContainText('Router -> Pragmatist -> Router -> Innovator -> Router -> Finalizer');
      await expect(page.getByTestId('architecture-run-sequential-parallel-stage')).toHaveCount(0);
      await expect(page.getByTestId('architecture-run-sequential-step')).toHaveCount(6);

      await page.reload();
      await page.getByTestId('nav-talk').click();
      await selectSession(page, session.id, title);
      await expect(page.getByTestId('agent-turn-bubble')).toHaveCount(1, { timeout: 30_000 });
      await expect(page.getByTestId('architecture-route-parallel-agents')).toHaveCount(0);
      await expect(page.getByTestId('architecture-route-agent')).toHaveCount(2);
      await expect(page.getByTestId('architecture-route-router')).toHaveCount(3);
      await expect(page.getByTestId('agent-turn-bubble')).toContainText('Router -> Pragmatist -> Router -> Innovator -> Router -> Finalizer');
    } finally {
      await deleteSessionIfExists(request, session.id);
      await request.delete(`${API_BASE}/architecture-registry/schemas/${variant.id}`, { timeout: 5000 }).catch(() => undefined);
    }
  });

  test('renders council branches as sub-agent chips and restores them after reload', async ({ page, request }, testInfo) => {
    test.setTimeout(240_000);
    const title = `Architecture E2E ${Date.now()}`;
    const response = await request.post(`${API_BASE}/sessions`, {
      data: { title, personaId: 'default' },
    });
    expect(response.ok()).toBeTruthy();
    const session = await response.json() as { id: string };

    try {
      await page.goto('/');
      await page.getByTestId('nav-talk').click();
      await selectSession(page, session.id, title);

      await selectArchitectureInComposer(page, 'strategic-decision-council');
      await sendMessageFromComposer(page, 'Oceń architekturę projektu');

      await expect(page.getByTestId('agent-turn-bubble')).toHaveCount(1, { timeout: 90_000 });
      await expect(page.getByTestId('architecture-route-agent')).toHaveCount(5, { timeout: 30_000 });
      await expect(page.getByTestId('agent-turn-bubble')).toContainText('Router', { timeout: 90_000 });
      await expect(page.getByTestId('agent-turn-bubble')).toContainText('Finalizer', { timeout: 90_000 });
      await expect(page.getByTestId('architecture-run-timeline')).toBeVisible({ timeout: 90_000 });
      await expect(page.getByTestId('architecture-route-parallel-agents')).toContainText('Pragmatist');
      await expect(page.getByTestId('architecture-route-parallel-agents')).toContainText('User Advocate');
      await expect(page.getByTestId('architecture-route-parallel-agents')).toContainText('Innovator');
      await expect(page.getByTestId('architecture-route-parallel-agents')).toContainText('Analyst');
      await expect(page.getByTestId('architecture-route-parallel-agents')).toContainText('Shadow');
      await expect(page.getByTestId('agent-turn-bubble')).not.toContainText('Execution trace:');
      await expect(page.getByTestId('agent-turn-bubble')).not.toContainText('Stream: completed /');
      await expect(page.getByTestId('agent-turn-bubble')).not.toContainText('Incoming graph outputs:');
      await expect(page.getByTestId('agent-turn-bubble')).not.toContainText('Available next nodes:');
      await expect(page.getByTestId('agent-turn-bubble')).not.toContainText('Act as a graph router.');
      const expectedBranchLabels = ['Pragmatist', 'User Advocate', 'Innovator', 'Analyst', 'Shadow'];
      const branchSessionProofs = await page.locator('[data-testid="architecture-route-agent"][data-session-id]').evaluateAll((elements, labels) => (
        elements
          .map((element) => {
            const sessionId = element.getAttribute('data-session-id');
            const text = element.textContent ?? '';
            const label = (labels as string[]).find((candidate) => text.includes(candidate)) ?? null;
            return sessionId && label ? { sessionId, label } : null;
          })
          .filter((entry): entry is { sessionId: string; label: string } => entry !== null)
      ), expectedBranchLabels);
      const branchSessionIds = branchSessionProofs.map((proof) => proof.sessionId);
      expect(new Set(branchSessionIds).size).toBe(5);
      expect(new Set(branchSessionProofs.map((proof) => proof.label))).toEqual(new Set(expectedBranchLabels));
      const currentWorkflowSessions = await getSessionDescendants(request, session.id);
      const architectureRunId = currentWorkflowSessions
        .map((candidate) => candidate.runtimeContext?.architectureContext?.architectureRunId)
        .find((candidate): candidate is string => typeof candidate === 'string' && candidate.length > 0);
      expect(architectureRunId).toBeTruthy();
      if (!architectureRunId) {
        throw new Error('Missing architecture run id for workflow completion proof');
      }

      await waitForArchitectureRunCompleted(request, architectureRunId);
      await expect(page.getByTestId('architecture-run-timeline')).toHaveAttribute('data-status', 'completed', { timeout: 30_000 });
      for (const routerCard of await page.getByTestId('architecture-route-router').all()) {
        await expect(routerCard).toHaveAttribute('data-status', 'completed', { timeout: 30_000 });
        await expect(routerCard).toContainText(/Parallel Deliberation|Router completed synthesis|Route: router ->/, { timeout: 30_000 });
      }
      await expect(page.getByTestId('architecture-route-finalizer')).toHaveAttribute('data-status', 'completed', { timeout: 30_000 });
      await expect(page.getByTestId('architecture-route-finalizer')).toContainText('Final answer produced from the routed graph outputs.', { timeout: 30_000 });
      for (const agentCard of await page.getByTestId('architecture-route-agent').all()) {
        await expect(agentCard).toHaveAttribute('data-status', 'completed', { timeout: 30_000 });
        await expect(agentCard).toContainText('Branch completed its role-specific response.', { timeout: 30_000 });
      }
      await expect(page.getByTestId('architecture-final-answer')).toBeVisible({ timeout: 30_000 });

      const currentWorkflowTechnicalSessions = currentWorkflowSessions
        .filter((candidate) => /: (router|finalizer)$/i.test(candidate.title));
      const currentWorkflowTechnicalSessionIds = currentWorkflowTechnicalSessions.map((candidate) => candidate.id);
      const currentWorkflowTechnicalSessionProofs = currentWorkflowTechnicalSessions.map((candidate) => ({
        sessionId: candidate.id,
        label: /: finalizer$/i.test(candidate.title) ? 'Finalizer' : 'Router',
      }));
      const routerSessionId = currentWorkflowTechnicalSessions.find((candidate) => /: router$/i.test(candidate.title))?.id;
      const finalizerSessionId = currentWorkflowTechnicalSessions.find((candidate) => /: finalizer$/i.test(candidate.title))?.id;

      expect(currentWorkflowTechnicalSessionIds.length).toBeGreaterThanOrEqual(2);
      expect(routerSessionId).toBeTruthy();
      expect(finalizerSessionId).toBeTruthy();
      if (!routerSessionId || !finalizerSessionId) {
        throw new Error('Missing router or finalizer technical session for workflow proof');
      }

      const sessionPanel = page.getByTestId('session-panel');
      await expect
        .poll(async () => {
          let visibleBranchRows = 0;
          for (const branchSessionId of branchSessionIds) {
            if (await sessionPanel.locator(`[data-testid="session-item"][data-session-id="${branchSessionId}"]`).count() > 0) {
              visibleBranchRows += 1;
            }
          }
          return visibleBranchRows;
        }, { timeout: 30_000 })
        .toBeGreaterThan(0);

      const childToggle = page.getByTestId(`toggle-session-children-${session.id}`);
      if (await childToggle.count() > 0) {
        const visibleSessionCountBeforeExpand = await page.getByTestId('session-item').count();
        const alreadyExpanded = visibleSessionCountBeforeExpand > 1;
        if (!alreadyExpanded) {
          await childToggle.click();
          await expect
            .poll(async () => page.getByTestId('session-item').count(), { timeout: 10_000 })
            .toBeGreaterThanOrEqual(visibleSessionCountBeforeExpand + 1);
        }
      }

      await page.getByTestId('session-origin-filter-trigger').click();
      await page.getByTestId('session-origin-filter-agent').click();
      for (const branchSessionId of branchSessionIds) {
        await expect(sessionPanel.locator(`[data-testid="session-item"][data-session-id="${branchSessionId}"]`)).toBeVisible();
      }
      for (const technicalSessionId of currentWorkflowTechnicalSessionIds) {
        await expect(sessionPanel.locator(`[data-testid="session-item"][data-session-id="${technicalSessionId}"]`)).toBeVisible();
      }

      const agentFilterScreenshotPath = testInfo.outputPath('architecture-agent-filter-proof.png');
      await page.screenshot({ path: agentFilterScreenshotPath, fullPage: true });

      await page.getByTestId('session-origin-filter-trigger').click();
      await page.getByTestId('session-origin-filter-all').click();

      await page.getByTestId('open-architecture-run-canvas').click();
      await expect(page.getByTestId('canvas-panel')).toBeVisible({ timeout: 10_000 });
      await expect(page.getByTestId('architecture-run-canvas-section')).toBeVisible({ timeout: 10_000 });
      await expect(page.getByTestId('architecture-run-branches')).toContainText('Pragmatist');
      await expect(page.getByTestId('architecture-run-routing')).toContainText('Router');

      for (const { sessionId: technicalTimelineSessionId, label } of currentWorkflowTechnicalSessionProofs) {
        await page.getByTestId(`architecture-open-branch-${technicalTimelineSessionId}`).first().click();
        await expect(page.getByTestId('canvas-focus-section')).toBeVisible({ timeout: 10_000 });
        await expect(page.getByTestId('canvas-focus-section')).toContainText(technicalTimelineSessionId);
        await page.getByTestId(`canvas-focus-open-session-${technicalTimelineSessionId}`).click();
        await expect
          .poll(() => page.evaluate(() => window.sessionStorage.getItem('kalio:last-active-session-id')), { timeout: 10_000 })
          .toBe(technicalTimelineSessionId);
        await expect(page.getByTestId('message-list')).not.toContainText('Waiting for the first persisted message');
        await expect
          .poll(async () => {
            const text = await page.getByTestId('message-list').textContent();
            return Boolean(
              text?.includes('Architecture: Strategic Decision Council v0.1.0')
              || text?.includes('Status: completed')
              || text?.includes('Status: running'),
            );
          }, { timeout: 10_000 })
          .toBe(true);
        await expect(page.getByTestId('message-list')).toContainText(label);
        await selectSession(page, session.id, title);
        await page.getByTestId('open-architecture-run-canvas').click();
        await expect(page.getByTestId('architecture-run-canvas-section')).toBeVisible({ timeout: 10_000 });
      }

      const screenshotPath = testInfo.outputPath('architecture-sidebar-children-proof.png');
      await page.screenshot({ path: screenshotPath, fullPage: true });

      for (const { sessionId: timelineChildSessionId, label } of branchSessionProofs) {
        const openCanvasButton = page.getByTestId('open-architecture-run-canvas');
        if (await openCanvasButton.isVisible().catch(() => false)) {
          await openCanvasButton.click();
        }
        await expect(page.getByTestId('architecture-run-canvas-section')).toBeVisible({ timeout: 10_000 });
        await page.getByTestId(`architecture-open-branch-${timelineChildSessionId}`).first().click();
        await expect(page.getByTestId('canvas-focus-section')).toBeVisible({ timeout: 10_000 });
        await expect(page.getByTestId('canvas-focus-section')).toContainText(timelineChildSessionId);
        await expect(page.getByTestId('canvas-focus-section')).toContainText('Architecture: Strategic Decision Council v0.1.0', { timeout: 10_000 });
        await expect
          .poll(() => page.evaluate(() => window.sessionStorage.getItem('kalio:last-active-session-id')), { timeout: 10_000 })
          .toBe(session.id);
        await page.getByTestId(`canvas-focus-open-session-${timelineChildSessionId}`).click();
        await expect
          .poll(() => page.evaluate(() => window.sessionStorage.getItem('kalio:last-active-session-id')), { timeout: 10_000 })
          .toBe(timelineChildSessionId);
        await expect(page.getByTestId('message-list')).not.toContainText('Waiting for the first persisted message');
        await expect(page.getByTestId('message-list')).toContainText('Architecture: Strategic Decision Council v0.1.0');
        await expect(page.getByTestId('message-list')).toContainText(label);
        await expect
          .poll(async () => {
            const text = await page.getByTestId('message-list').textContent();
            return (text ?? '').trim().length;
          }, { timeout: 10_000 })
          .toBeGreaterThan(120);
        await selectSession(page, session.id, title);
      }

      await page.getByTestId('open-architecture-run-canvas').click();
      await expect(page.getByTestId('canvas-panel')).toBeVisible({ timeout: 10_000 });
      await expect(page.getByTestId('architecture-run-canvas-section')).toBeVisible({ timeout: 10_000 });
      await expect(page.getByTestId('canvas-focus-section')).toBeHidden();
      await expect(page.getByTestId('canvas-subagents-section')).toHaveCount(0);
      await selectSession(page, session.id, title);

      await page.reload();
      await page.getByTestId('nav-talk').click();
      await selectSession(page, session.id, title);

      await expect(page.getByTestId('agent-turn-bubble')).toHaveCount(1, { timeout: 30_000 });
      await expect(page.getByTestId('architecture-route-agent')).toHaveCount(5, { timeout: 30_000 });
      await expect(page.getByTestId('agent-turn-bubble')).toContainText('Router');
      await expect(page.getByTestId('agent-turn-bubble')).toContainText('Finalizer');
      await expect(page.getByTestId('architecture-run-timeline')).toBeVisible();
      await expect(page.getByTestId('architecture-run-timeline')).toHaveAttribute('data-status', 'completed');
      for (const routerCard of await page.getByTestId('architecture-route-router').all()) {
        await expect(routerCard).toHaveAttribute('data-status', 'completed');
        await expect(routerCard).toContainText(/Parallel Deliberation|Router completed synthesis|Route: router ->/);
      }
      await expect(page.getByTestId('architecture-route-finalizer')).toHaveAttribute('data-status', 'completed');
      await expect(page.getByTestId('architecture-route-finalizer')).toContainText('Final answer produced from the routed graph outputs.');
      for (const agentCard of await page.getByTestId('architecture-route-agent').all()) {
        await expect(agentCard).toHaveAttribute('data-status', 'completed');
        await expect(agentCard).toContainText('Branch completed its role-specific response.');
      }
      await expect(page.getByTestId('architecture-final-answer')).toBeVisible();
      await expect(page.getByTestId('architecture-route-parallel-agents')).toContainText('Pragmatist');
      await expect(page.getByTestId('architecture-route-parallel-agents')).toContainText('User Advocate');
      await expect(page.getByTestId('architecture-route-parallel-agents')).toContainText('Innovator');
      await expect(page.getByTestId('architecture-route-parallel-agents')).toContainText('Analyst');
      await expect(page.getByTestId('architecture-route-parallel-agents')).toContainText('Shadow');
      await expect(page.getByTestId('agent-turn-bubble')).not.toContainText('Execution trace:');
      await expect(page.getByTestId('agent-turn-bubble')).not.toContainText('Stream: completed /');
      await expect(page.getByTestId('agent-turn-bubble')).not.toContainText('Incoming graph outputs:');
      await expect(page.getByTestId('agent-turn-bubble')).not.toContainText('Available next nodes:');
      await expect(page.getByTestId('agent-turn-bubble')).not.toContainText('Act as a graph router.');

      await page.getByTestId('open-architecture-run-canvas').click();
      await expect(page.getByTestId('architecture-run-canvas-section')).toBeVisible({ timeout: 10_000 });
      await expect(page.getByTestId('architecture-run-branches')).toContainText('Pragmatist');

      for (const { sessionId: technicalTimelineSessionId, label } of currentWorkflowTechnicalSessionProofs) {
        await page.getByTestId(`architecture-open-branch-${technicalTimelineSessionId}`).first().click();
        await expect(page.getByTestId('canvas-focus-section')).toBeVisible({ timeout: 10_000 });
        await expect(page.getByTestId('canvas-focus-section')).toContainText(technicalTimelineSessionId);
        await page.getByTestId(`canvas-focus-open-session-${technicalTimelineSessionId}`).click();
        await expect
          .poll(() => page.evaluate(() => window.sessionStorage.getItem('kalio:last-active-session-id')), { timeout: 10_000 })
          .toBe(technicalTimelineSessionId);
        await expect(page.getByTestId('message-list')).not.toContainText('Waiting for the first persisted message');
        await expect
          .poll(async () => {
            const text = await page.getByTestId('message-list').textContent();
            return Boolean(
              text?.includes('Architecture: Strategic Decision Council v0.1.0')
              || text?.includes('Status: completed'),
            );
          }, { timeout: 10_000 })
          .toBe(true);
        await expect(page.getByTestId('message-list')).toContainText(label);
        await selectSession(page, session.id, title);
        await page.getByTestId('open-architecture-run-canvas').click();
        await expect(page.getByTestId('architecture-run-canvas-section')).toBeVisible({ timeout: 10_000 });
      }

      await expect(page.getByTestId('canvas-panel')).toBeVisible({ timeout: 10_000 });
      await expect(page.getByTestId('canvas-subagents-section')).toHaveCount(0);

      await page.getByTestId('talk-sidebar-graph-entry').click();
      await expect(page.getByTestId('execution-graph-view')).toBeVisible({ timeout: 10_000 });
      await expect(page.getByTestId('execution-graph-view')).toContainText('Strategic Decision Council', { timeout: 10_000 });
      await expect(page.getByTestId('execution-graph-view')).toContainText('Router', { timeout: 10_000 });
      await expect(page.getByTestId('execution-graph-view')).toContainText('Final Artifact', { timeout: 10_000 });
      await expect(page.getByTestId('execution-graph-view')).toContainText('Final response', { timeout: 10_000 });
      const graphNodeCards = page.locator('[data-graph-node-card="true"]');
      await expect(graphNodeCards.filter({ hasText: 'Router' }).first().locator('[aria-label="Status: ready"]')).toBeVisible({ timeout: 10_000 });
      await expect(graphNodeCards.filter({ hasText: 'Final Artifact' }).first().locator('[aria-label="Status: ready"]')).toBeVisible({ timeout: 10_000 });
      for (const { sessionId: branchSessionId, label } of branchSessionProofs) {
        const graphBranchCard = graphNodeCards.filter({ hasText: label }).first();
        await expect(graphBranchCard).toBeVisible({ timeout: 10_000 });
        await expect(graphBranchCard.locator('[aria-label="Status: ready"]')).toBeVisible({ timeout: 10_000 });
        await graphBranchCard.click();
        await expect(page.getByTestId('execution-graph-inspector')).toContainText(label, { timeout: 10_000 });
        await page.getByRole('button', { name: 'Open child chat' }).click();
        await expect
          .poll(() => page.evaluate(() => window.sessionStorage.getItem('kalio:last-active-session-id')), { timeout: 10_000 })
          .toBe(branchSessionId);
        await expect(page.getByTestId('message-list')).toContainText(label);
        await selectSession(page, session.id, title);
        await page.getByTestId('talk-sidebar-graph-entry').click();
        await expect(page.getByTestId('execution-graph-view')).toBeVisible({ timeout: 10_000 });
      }
    } finally {
      await deleteSessionIfExists(request, session.id);
    }
  });

  test('restores a persisted architecture envelope selection back to the host conversation', async ({ page, request }, testInfo) => {
    test.setTimeout(120_000);
    const title = `Architecture Restore E2E ${Date.now()}`;
    const response = await request.post(`${API_BASE}/sessions`, {
      data: { title, personaId: 'default' },
    });
    expect(response.ok()).toBeTruthy();
    const session = await response.json() as { id: string };

    try {
      await page.goto('/');
      await page.getByTestId('nav-talk').click();
      await selectSession(page, session.id, title);

      await selectArchitectureInComposer(page, 'strategic-decision-council');
      await sendMessageFromComposer(page, 'Assess this repository.');

      await expect(page.getByTestId('architecture-run-timeline')).toBeVisible({ timeout: 90_000 });

      const sessions = await getSessionDescendants(request, session.id);
      const envelopeSession = sessions.find((candidate) => (
        candidate.parentSessionId === session.id
        && typeof candidate.runtimeContext?.architectureContext?.architectureRunId === 'string'
        && typeof candidate.runtimeContext?.architectureSlotId !== 'string'
      ));
      expect(envelopeSession).toBeTruthy();
      if (!envelopeSession) {
        throw new Error('Missing architecture envelope session');
      }

      await page.evaluate((sessionId) => {
        window.sessionStorage.setItem('kalio:last-active-session-id', sessionId);
      }, envelopeSession.id);
      await page.reload();
      await expect(page.getByTestId('session-panel')).toBeVisible({ timeout: 30_000 });

      await expect(page.getByTestId('chat-session-title')).toHaveText(title, { timeout: 30_000 });
      await expect(page.getByTestId('architecture-run-timeline')).toBeVisible({ timeout: 30_000 });

      const screenshotPath = testInfo.outputPath('architecture-envelope-restore-proof.png');
      await page.screenshot({ path: screenshotPath, fullPage: true });
    } finally {
      await deleteSessionIfExists(request, session.id);
    }
  });

  test('launches Architecture Debate from the welcome screen with projectPath and keeps child transcripts repo-scoped after reload', async ({ page, request }) => {
    test.setTimeout(420_000);
    const projectPath = 'C:\\Projekty\\kalio-forever';
    let sessionId: string | null = null;
    let title = '';

    try {
      await page.goto('/');
      await page.getByTestId('nav-talk').click();
      await page.getByTestId('new-session-btn').click();
      await expect(page.getByTestId('welcome-screen')).toBeVisible({ timeout: 15_000 });

      await selectArchitectureInComposer(page, 'strategic-decision-council');
      await page.getByTestId('welcome-project-path-input').fill(projectPath);
      await page.getByTestId('welcome-prompt-input').fill('Oceń architekturę projektu');
      await page.getByTestId('welcome-run-prompt').click();

      await expect(page.getByTestId('architecture-run-timeline')).toBeVisible({ timeout: 90_000 });
      await expect
        .poll(() => page.evaluate(() => window.sessionStorage.getItem('kalio:last-active-session-id')), { timeout: 15_000 })
        .not.toBeNull();
      sessionId = await page.evaluate(() => window.sessionStorage.getItem('kalio:last-active-session-id'));
      if (!sessionId) {
        throw new Error('Missing host session id after welcome-screen workflow launch');
      }

      title = (await page.getByTestId('chat-session-title').textContent())?.trim() ?? '';
      expect(title.length).toBeGreaterThan(0);

      const rootSession = await getSession(request, sessionId);
      expect(rootSession?.runtimeContext?.architectureContext?.projectPath).toBe(projectPath);

      const currentWorkflowSessions = await getSessionDescendants(request, sessionId);
      const architectureRunId = currentWorkflowSessions
        .map((candidate) => candidate.runtimeContext?.architectureContext?.architectureRunId)
        .find((candidate): candidate is string => typeof candidate === 'string' && candidate.length > 0);
      expect(architectureRunId).toBeTruthy();
      if (!architectureRunId) {
        throw new Error('Missing architecture run id for projectPath workflow proof');
      }

      await waitForArchitectureRunCompleted(request, architectureRunId, 360_000);
      await expect(page.getByTestId('architecture-run-timeline')).toHaveAttribute('data-status', 'completed', { timeout: 30_000 });

      const branchSessions = currentWorkflowSessions.filter((candidate) => /: (Pragmatist|User Advocate|Innovator|Analyst|Shadow)$/i.test(candidate.title));
      expect(branchSessions.length).toBe(5);

      for (const branchSession of branchSessions) {
        const branchMessagesResponse = await request.get(`${API_BASE}/sessions/${branchSession.id}/messages`);
        expect(branchMessagesResponse.ok()).toBeTruthy();
        const branchMessages = await branchMessagesResponse.json() as Array<{ content?: string }>;
        const serialized = JSON.stringify(branchMessages);
        expect(serialized).not.toContain('ACCESS_DENIED');
        expect(serialized.length).toBeGreaterThan(120);
      }

      await page.reload();
      await page.getByTestId('nav-talk').click();
      await selectSession(page, sessionId, title);
      await expect(page.getByTestId('architecture-run-timeline')).toHaveAttribute('data-status', 'completed', { timeout: 30_000 });

      const firstBranchSession = branchSessions[0];
      if (!firstBranchSession) {
        throw new Error('Missing branch session for projectPath transcript proof');
      }
      await selectSessionOriginFilter(page, 'agent');
      await selectSession(page, firstBranchSession.id, firstBranchSession.title);
      await expect(page.getByTestId('message-list')).not.toContainText('Waiting for the first persisted message');
      await expect(page.getByTestId('message-list')).not.toContainText('ACCESS_DENIED');

      await selectSessionOriginFilter(page, 'all');
      await selectSession(page, sessionId, title);
    } finally {
      if (sessionId) {
        await deleteSessionIfExists(request, sessionId);
      }
    }
  });
});
