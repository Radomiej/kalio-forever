import { existsSync } from 'node:fs';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import {
  API_BASE,
  deleteSessionIfExists,
  getJsonWithTransportRetry,
  selectArchitectureInComposer,
  selectSession,
} from './helpers/test-config';

const projectPath = 'C:\\Projekty\\FamilyQuest';

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

type SessionMessageResponse = Array<{
  role?: string;
  content?: string;
}>;

function normalizedText(value: string | null | undefined): string {
  return (value ?? '').replace(/\s+/g, ' ').trim();
}

function descendantsOf(sessions: SessionListItem[], rootId: string): SessionListItem[] {
  const byId = new Map(sessions.map((session) => [session.id, session]));
  return sessions.filter((session) => {
    let parentId = session.parentSessionId;
    const seen = new Set<string>();
    while (parentId) {
      if (seen.has(parentId)) return false;
      if (parentId === rootId) return true;
      seen.add(parentId);
      parentId = byId.get(parentId)?.parentSessionId;
    }
    return false;
  });
}

async function waitForArchitectureRunCompleted(
  request: APIRequestContext,
  runId: string,
  timeoutMs = 360_000,
): Promise<void> {
  await expect
    .poll(async () => {
      const graph = await getJsonWithTransportRetry<ArchitectureGraphResponse>(
        request,
        `${API_BASE}/architecture-runs/${runId}/graph`,
      );
      const chat = await getJsonWithTransportRetry<ArchitectureChatResponse>(
        request,
        `${API_BASE}/architecture-runs/${runId}/chat`,
      );
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

async function assertWorkflowRehydratesAfterReload(
  page: Page,
  hostSessionId: string,
  branchSession: SessionListItem,
): Promise<void> {
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 30_000 });
  await page.getByTestId('nav-talk').click();
  await expect
    .poll(() => page.evaluate(() => window.sessionStorage.getItem('kalio:last-active-session-id')), { timeout: 30_000 })
    .toBe(hostSessionId);
  await expect(page.getByTestId('message-list')).not.toContainText('Waiting for the first persisted message');
  await expect(page.getByTestId('architecture-run-timeline')).toHaveAttribute('data-status', 'completed', { timeout: 30_000 });
  await expect(page.getByTestId('architecture-route-agent')).toHaveCount(5, { timeout: 30_000 });

  await page.getByTestId('open-architecture-run-canvas').click();
  await expect(page.getByTestId('architecture-run-canvas-section')).toBeVisible({ timeout: 10_000 });
  await page.getByTestId(`architecture-open-branch-${branchSession.id}`).first().click();
  await page.getByTestId(`canvas-focus-open-session-${branchSession.id}`).click();
  await expect
    .poll(() => page.evaluate(() => window.sessionStorage.getItem('kalio:last-active-session-id')), { timeout: 10_000 })
    .toBe(branchSession.id);
  await expect(page.getByTestId('message-list')).not.toContainText('Waiting for the first persisted message');
  await expect(page.getByTestId('message-list')).not.toContainText('ACCESS_DENIED');
  await expect
    .poll(async () => {
      const text = await page.getByTestId('message-list').textContent();
      return (text ?? '').trim().length;
    }, { timeout: 15_000 })
    .toBeGreaterThan(80);
}

test.describe('FamilyQuest live proof', () => {
  test.skip(!existsSync(projectPath), `Missing local project path: ${projectPath}`);

  test('workflow completes on FamilyQuest and rehydrates after refresh', async ({ page, request }) => {
    test.setTimeout(480_000);
    let hostSessionId: string | null = null;
    let hostTitle = '';

    try {
      await page.goto('/');
      await page.getByTestId('nav-talk').click();
      await page.getByTestId('new-session-btn').click();
      await expect(page.getByTestId('welcome-screen')).toBeVisible({ timeout: 15_000 });

      await selectArchitectureInComposer(page, 'strategic-decision-council');
      await page.getByTestId('welcome-project-path-input').fill(projectPath);
      await page.getByTestId('welcome-prompt-input').fill('Oceń architekturę projektu');
      await page.getByTestId('welcome-run-prompt').click();

      await expect
        .poll(() => page.evaluate(() => window.sessionStorage.getItem('kalio:last-active-session-id')), { timeout: 30_000 })
        .not.toBeNull();
      hostSessionId = await page.evaluate(() => window.sessionStorage.getItem('kalio:last-active-session-id'));
      if (!hostSessionId) {
        throw new Error('Missing FamilyQuest workflow host session');
      }

      hostTitle = (await page.getByTestId('chat-session-title').textContent())?.trim() ?? '';
      expect(hostTitle.length).toBeGreaterThan(0);

      const sessionsResponse = await request.get(`${API_BASE}/sessions`);
      expect(sessionsResponse.ok()).toBeTruthy();
      const sessions = await sessionsResponse.json() as SessionListItem[];
      const hostSession = sessions.find((candidate) => candidate.id === hostSessionId);
      expect(hostSession?.runtimeContext?.architectureContext?.projectPath).toBe(projectPath);

      const workflowSessions = descendantsOf(sessions, hostSessionId);
      const runId = workflowSessions
        .map((candidate) => candidate.runtimeContext?.architectureContext?.architectureRunId)
        .find((candidate): candidate is string => typeof candidate === 'string' && candidate.length > 0);
      expect(runId).toBeTruthy();
      if (!runId) {
        throw new Error('Missing FamilyQuest architecture run id');
      }

      await waitForArchitectureRunCompleted(request, runId);
      await selectSession(page, hostSessionId, hostTitle);
      await expect(page.getByTestId('architecture-run-timeline')).toHaveAttribute('data-status', 'completed', { timeout: 30_000 });
      await expect(page.getByTestId('architecture-route-agent')).toHaveCount(5, { timeout: 30_000 });

      const branchSessions = workflowSessions.filter((candidate) => /: (Pragmatist|User Advocate|Innovator|Analyst|Shadow)$/i.test(candidate.title));
      const technicalSessions = workflowSessions.filter((candidate) => /: (Router|Finalizer)$/i.test(candidate.title));
      expect(branchSessions.length).toBe(5);
      expect(technicalSessions.length).toBeGreaterThanOrEqual(2);

      for (const branchSession of branchSessions) {
        await selectSession(page, hostSessionId, hostTitle);
        await page.getByTestId('open-architecture-run-canvas').click();
        await expect(page.getByTestId('architecture-run-canvas-section')).toBeVisible({ timeout: 10_000 });
        await page.getByTestId(`architecture-open-branch-${branchSession.id}`).first().click();
        await page.getByTestId(`canvas-focus-open-session-${branchSession.id}`).click();
        await expect
          .poll(() => page.evaluate(() => window.sessionStorage.getItem('kalio:last-active-session-id')), { timeout: 10_000 })
          .toBe(branchSession.id);
        await expect(page.getByTestId('message-list')).not.toContainText('Waiting for the first persisted message');
        await expect(page.getByTestId('message-list')).not.toContainText('ACCESS_DENIED');
        await expect
          .poll(async () => {
            const text = await page.getByTestId('message-list').textContent();
            return (text ?? '').trim().length;
          }, { timeout: 15_000 })
          .toBeGreaterThan(80);
      }

      for (const technicalSession of technicalSessions) {
        await selectSession(page, hostSessionId, hostTitle);
        await page.getByTestId('open-architecture-run-canvas').click();
        await expect(page.getByTestId('architecture-run-canvas-section')).toBeVisible({ timeout: 10_000 });
        await page.getByTestId(`architecture-open-branch-${technicalSession.id}`).first().click();
        await page.getByTestId(`canvas-focus-open-session-${technicalSession.id}`).click();
        await expect
          .poll(() => page.evaluate(() => window.sessionStorage.getItem('kalio:last-active-session-id')), { timeout: 10_000 })
          .toBe(technicalSession.id);
        await expect(page.getByTestId('message-list')).not.toContainText('Waiting for the first persisted message');
        await expect(page.getByTestId('message-list')).toContainText(/Architecture: Strategic Decision Council v0.1.0|Status: completed|Status: running/);
      }

      await selectSession(page, hostSessionId, hostTitle);
      await assertWorkflowRehydratesAfterReload(page, hostSessionId, branchSessions[0]);
    } finally {
      if (hostSessionId) {
        await deleteSessionIfExists(request, hostSessionId);
      }
    }
  });

  test('normal chat streams on FamilyQuest with the live model', async ({ page, request }) => {
    test.setTimeout(240_000);
    let hostSessionId: string | null = null;

    try {
      await page.goto('/');
      await page.getByTestId('nav-talk').click();
      await page.getByTestId('new-session-btn').click();
      await expect(page.getByTestId('welcome-screen')).toBeVisible({ timeout: 15_000 });

      const chatModeButton = page.getByTestId('welcome-mode-chat');
      if (await chatModeButton.isVisible().catch(() => false)) {
        await chatModeButton.click();
      }
      await page.getByTestId('welcome-project-path-input').fill(projectPath);
      await page.getByTestId('welcome-prompt-input').fill('Przeanalizuj projekt FamilyQuest i wypisz główne moduły lub katalogi wraz z krótkim opisem, po polsku. Odpowiedz pełnymi zdaniami i dodaj po 1 krótkim uzasadnieniu dla każdego punktu.');
      await page.getByTestId('welcome-run-prompt').click();

      await expect
        .poll(() => page.evaluate(() => window.sessionStorage.getItem('kalio:last-active-session-id')), { timeout: 30_000 })
        .not.toBeNull();
      hostSessionId = await page.evaluate(() => window.sessionStorage.getItem('kalio:last-active-session-id'));
      if (!hostSessionId) {
        throw new Error('Missing FamilyQuest chat host session');
      }

      await expect
        .poll(async () => {
          const pendingVisible = await page.getByTestId('pending-agent-bubble').isVisible().catch(() => false);
          const agentVisible = await page.getByTestId('agent-turn-bubble').last().isVisible().catch(() => false);
          return pendingVisible || agentVisible;
        }, { timeout: 20_000 })
        .toBe(true);

      const samples: number[] = [];
      const startedAt = Date.now();
      let finalAssistantText = '';
      while (Date.now() - startedAt < 90_000) {
        const textLength = normalizedText(await page.getByTestId('agent-turn-bubble').last().textContent().catch(() => '')).length;
        if (textLength > 0) {
          samples.push(textLength);
        }
        const stopVisible = await page.getByTestId('chat-stop-btn').isVisible().catch(() => false);
        const messagesResponse = await request.get(`${API_BASE}/sessions/${hostSessionId}/messages`);
        const sessionMessages = messagesResponse.ok()
          ? await messagesResponse.json() as SessionMessageResponse
          : [];
        finalAssistantText = sessionMessages
          .filter((message) => message.role === 'assistant')
          .map((message) => normalizedText(message.content))
          .find((content) => content.length > 80) ?? '';
        if (!stopVisible && finalAssistantText.length > 80) {
          break;
        }
        await page.waitForTimeout(500);
      }

      await expect(page.getByTestId('chat-stop-btn')).toHaveCount(0, { timeout: 60_000 });
      await expect
        .poll(async () => {
          const messagesResponse = await request.get(`${API_BASE}/sessions/${hostSessionId}/messages`);
          if (!messagesResponse.ok()) {
            return 0;
          }
          const sessionMessages = await messagesResponse.json() as SessionMessageResponse;
          return sessionMessages
            .filter((message) => message.role === 'assistant')
            .map((message) => normalizedText(message.content).length)
            .find((length) => length > 80) ?? 0;
        }, { timeout: 90_000 })
        .toBeGreaterThan(80);

      const finalText = normalizedText(await page.getByTestId('agent-turn-bubble').last().textContent().catch(() => ''));
      const positiveLengths = samples.filter((value) => value > 0);

      expect(finalAssistantText.length).toBeGreaterThan(80);
      expect(finalText.length).toBeGreaterThan(80);
      expect(positiveLengths.length).toBeGreaterThanOrEqual(1);
    } finally {
      if (hostSessionId) {
        await deleteSessionIfExists(request, hostSessionId);
      }
    }
  });
});
