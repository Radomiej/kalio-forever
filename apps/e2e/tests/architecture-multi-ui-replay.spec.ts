import { existsSync, statSync } from 'node:fs';
import { expect, test, type APIRequestContext, type Browser } from '@playwright/test';
import {
  API_BASE,
  deleteSessionIfExists,
  ensureProjectForPath,
  selectArchitectureInComposer,
  selectProjectInWelcome,
  selectSession,
  selectSessionOriginFilter,
} from './helpers/test-config';

const PROCESS_ENV = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env;

function requireProjectPath(): string {
  const projectPath = PROCESS_ENV?.KALIO_E2E_PROJECT_PATH?.trim();
  if (!projectPath) {
    throw new Error('KALIO_E2E_PROJECT_PATH must point to an existing project directory.');
  }
  if (!existsSync(projectPath) || !statSync(projectPath).isDirectory()) {
    throw new Error(`KALIO_E2E_PROJECT_PATH is not an existing project directory: ${projectPath}`);
  }
  return projectPath;
}

const projectPath = requireProjectPath();

type SessionListItem = {
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

async function waitForArchitectureRunCompleted(
  request: APIRequestContext,
  runId: string,
  timeoutMs = 360_000,
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

function isWorkflowDescendant(
  sessionById: Map<string, SessionListItem>,
  hostSessionId: string,
  candidate: SessionListItem,
): boolean {
  let currentParentId = candidate.parentSessionId;
  const visited = new Set<string>();
  while (currentParentId) {
    if (visited.has(currentParentId)) return false;
    if (currentParentId === hostSessionId) return true;
    visited.add(currentParentId);
    currentParentId = sessionById.get(currentParentId)?.parentSessionId;
  }
  return false;
}

async function openTalkAndSelectHost(browser: Browser, hostSessionId: string, hostTitle: string) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto('/');
  await page.getByTestId('nav-talk').click();
  await selectSession(page, hostSessionId, hostTitle);
  return { context, page };
}

test.describe('Architecture workflow replay across a new UI session', () => {
  test('a second browser session restores host state, child transcripts, and technical node notes', async ({ page, request, browser }, testInfo) => {
    test.setTimeout(420_000);
    let hostSessionId: string | null = null;
    let hostTitle = '';

    try {
      await ensureProjectForPath(request, projectPath);
      await page.goto('/');
      await page.getByTestId('nav-talk').click();
      await page.getByTestId('new-session-btn').click();
      await expect(page.getByTestId('welcome-screen')).toBeVisible({ timeout: 15_000 });

      await selectArchitectureInComposer(page, 'strategic-decision-council');
      await selectProjectInWelcome(page, projectPath);
      await page.getByTestId('welcome-prompt-input').fill('Oceń architekturę projektu');
      await page.getByTestId('welcome-run-prompt').click();
      await expect
        .poll(() => page.evaluate(() => window.sessionStorage.getItem('kalio:last-active-session-id')), { timeout: 30_000 })
        .not.toBeNull();
      hostSessionId = await page.evaluate(() => window.sessionStorage.getItem('kalio:last-active-session-id'));
      if (!hostSessionId) {
        throw new Error('Missing host session id after workflow launch');
      }

      await expect
        .poll(async () => {
          const sessionsResponse = await request.get(`${API_BASE}/sessions`);
          if (!sessionsResponse.ok()) {
            return null;
          }
          const sessions = await sessionsResponse.json() as SessionListItem[];
          return sessions.find((candidate) => candidate.id === hostSessionId) ?? null;
        }, { timeout: 60_000 })
        .not.toBeNull();

      hostTitle = (await page.getByTestId('chat-session-title').textContent())?.trim() ?? '';
      if (!hostTitle) {
        const refreshedSessionsResponse = await request.get(`${API_BASE}/sessions`);
        expect(refreshedSessionsResponse.ok()).toBeTruthy();
        const refreshedSessions = await refreshedSessionsResponse.json() as SessionListItem[];
        hostTitle = refreshedSessions.find((candidate) => candidate.id === hostSessionId)?.title ?? '';
      }
      expect(hostTitle.length).toBeGreaterThan(0);

      const sessionsResponse = await request.get(`${API_BASE}/sessions`);
      expect(sessionsResponse.ok()).toBeTruthy();
      const persistedSessions = await sessionsResponse.json() as SessionListItem[];
      const hostSession = persistedSessions.find((candidate) => candidate.id === hostSessionId);
      expect(hostSession?.runtimeContext?.architectureContext?.projectPath).toBe(projectPath.replaceAll('\\', '/'));

      const sessionById = new Map(persistedSessions.map((candidate) => [candidate.id, candidate]));
      const workflowSessions = persistedSessions.filter((candidate) => isWorkflowDescendant(sessionById, hostSessionId!, candidate));
      const architectureRunId = workflowSessions
        .map((candidate) => candidate.runtimeContext?.architectureContext?.architectureRunId)
        .find((candidate): candidate is string => typeof candidate === 'string' && candidate.length > 0);
      expect(architectureRunId).toBeTruthy();
      if (!architectureRunId) {
        throw new Error('Missing architecture run id for multi-session replay proof');
      }

      await waitForArchitectureRunCompleted(request, architectureRunId);
      await selectSession(page, hostSessionId, hostTitle);
      await expect(page.getByTestId('architecture-run-timeline')).toHaveAttribute('data-status', 'completed', { timeout: 30_000 });

      const branchSessions = workflowSessions.filter((candidate) => /: (Pragmatist|User Advocate|Innovator|Analyst|Shadow)$/i.test(candidate.title));
      const technicalSessions = workflowSessions.filter((candidate) => /: (Router|Finalizer)$/i.test(candidate.title));
      expect(branchSessions.length).toBe(5);
      expect(technicalSessions.length).toBeGreaterThanOrEqual(2);

      const secondUi = await openTalkAndSelectHost(browser, hostSessionId, hostTitle);
      try {
        await expect(secondUi.page.getByTestId('architecture-run-timeline')).toBeVisible({ timeout: 30_000 });
        await expect(secondUi.page.getByTestId('architecture-run-timeline')).toHaveAttribute('data-status', 'completed', { timeout: 30_000 });
        await expect(secondUi.page.getByTestId('architecture-route-agent')).toHaveCount(5, { timeout: 30_000 });
        await expect(secondUi.page.getByTestId('architecture-route-router').first()).toBeVisible({ timeout: 30_000 });
        await expect(secondUi.page.getByTestId('architecture-route-finalizer')).toHaveCount(1, { timeout: 30_000 });

        for (const routerCard of await secondUi.page.getByTestId('architecture-route-router').all()) {
          await expect(routerCard).toHaveAttribute('data-status', 'completed');
          await expect(routerCard).toContainText(/Parallel Deliberation|Router completed synthesis|Route: router ->/);
        }
        for (const agentCard of await secondUi.page.getByTestId('architecture-route-agent').all()) {
          await expect(agentCard).toHaveAttribute('data-status', 'completed');
          await expect(agentCard).toContainText('Branch completed its role-specific response.');
        }
        await expect(secondUi.page.getByTestId('architecture-route-finalizer')).toHaveAttribute('data-status', 'completed');
        await expect(secondUi.page.getByTestId('architecture-final-answer')).toBeVisible();

        await selectSessionOriginFilter(secondUi.page, 'agent');
        for (const branchSession of branchSessions) {
          await expect(secondUi.page.locator(`[data-testid="session-item"][data-session-id="${branchSession.id}"]`)).toBeVisible();
        }
        for (const technicalSession of technicalSessions) {
          await expect(secondUi.page.locator(`[data-testid="session-item"][data-session-id="${technicalSession.id}"]`)).toBeVisible();
        }

        const firstBranch = branchSessions[0];
        const firstTechnical = technicalSessions[0];
        if (!firstBranch || !firstTechnical) {
          throw new Error('Missing workflow child sessions for multi-session replay proof');
        }

        await selectSession(secondUi.page, firstBranch.id, firstBranch.title);
        await expect(secondUi.page.getByTestId('message-list')).not.toContainText('Waiting for the first persisted message');
        await expect(secondUi.page.getByTestId('message-list')).toContainText('Architecture: Strategic Decision Council v0.1.0');
        await expect(secondUi.page.getByTestId('message-list')).toContainText(/Pragmatist|User Advocate|Innovator|Analyst|Shadow/);

        await selectSession(secondUi.page, hostSessionId, hostTitle);
        await selectSession(secondUi.page, firstTechnical.id, firstTechnical.title);
        await expect(secondUi.page.getByTestId('message-list')).not.toContainText('Waiting for the first persisted message');
        await expect(secondUi.page.getByTestId('message-list')).toContainText(/Architecture: Strategic Decision Council v0.1.0|Status: completed|Status: running/);
        await expect(secondUi.page.getByTestId('message-list')).toContainText(/Router|Finalizer/);

        const screenshotPath = testInfo.outputPath('architecture-multi-ui-replay-proof.png');
        await secondUi.page.screenshot({ path: screenshotPath, fullPage: true });
      } finally {
        await secondUi.context.close();
      }
    } finally {
      if (hostSessionId) {
        await deleteSessionIfExists(request, hostSessionId);
      }
    }
  });
});
