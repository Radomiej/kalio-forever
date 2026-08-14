import { expect, test, type APIRequestContext } from '@playwright/test';
import {
  API_BASE,
  deleteSessionIfExists,
  ensureEnvMockProvider,
  getJsonWithTransportRetry,
  selectArchitectureInComposer,
  sendMessageFromComposer,
} from './helpers/test-config';

type SessionListItem = {
  id: string;
  runtimeContext?: {
    architectureContext?: {
      architectureRunId?: string;
    };
  };
};

type ArchitectureGraphResponse = {
  status?: string;
  nodes?: Array<{
    id: string;
    kind: string;
    status?: string;
    errorCode?: string;
  }>;
};

async function architectureRunIdForHost(
  request: APIRequestContext,
  hostSessionId: string,
): Promise<string> {
  const readRunId = async () => {
    const response = await request.get(`${API_BASE}/sessions/${hostSessionId}/children`);
    if (!response.ok()) {
      return null;
    }
    const children = await response.json() as SessionListItem[];
    return children
      .map((session) => session.runtimeContext?.architectureContext?.architectureRunId)
      .find((runId): runId is string => typeof runId === 'string' && runId.length > 0) ?? null;
  };

  await expect.poll(readRunId, { timeout: 60_000 }).not.toBeNull();
  const runId = await readRunId();
  if (!runId) {
    throw new Error('Missing architecture run id after children poll.');
  }
  return runId;
}

test.describe('Architecture structured-output failure handling', () => {
  test('malformed router structured output becomes terminal failed graph state', async ({ page, request }) => {
    test.setTimeout(240_000);
    let hostSessionId: string | null = null;

    try {
      await ensureEnvMockProvider(request);
      await page.goto('/', { waitUntil: 'domcontentloaded' });
      await page.getByTestId('nav-talk').click();
      await page.getByTestId('new-session-btn').click();
      await expect(page.getByTestId('chat-session-title')).toHaveText('New Chat', { timeout: 30_000 });
      await expect
        .poll(
          () => page.evaluate(() => window.sessionStorage.getItem('kalio:last-active-session-id')),
          { timeout: 15_000 },
        )
        .not.toBeNull();
      hostSessionId = await page.evaluate(() => window.sessionStorage.getItem('kalio:last-active-session-id'));
      if (!hostSessionId) {
        throw new Error('Missing active host session id after creating a new chat.');
      }

      await selectArchitectureInComposer(page, 'strategic-decision-council');
      await sendMessageFromComposer(
        page,
        'Trigger malformed router structured output [[mock:architecture:router:malformed-output]]',
      );

      const timeline = page.getByTestId('architecture-run-timeline');
      await expect(timeline).toBeVisible({ timeout: 120_000 });
      await expect(timeline).toHaveAttribute('data-status', 'failed', { timeout: 120_000 });
      await expect(page.locator('[data-testid="architecture-route-router"][data-status="failed"]').first()).toBeVisible({ timeout: 30_000 });
      await expect(page.locator('[data-testid^="architecture-route-"][data-status="pending"]')).toHaveCount(0, { timeout: 30_000 });

      const runId = await architectureRunIdForHost(request, hostSessionId);
      const graph = await getJsonWithTransportRetry<ArchitectureGraphResponse>(
        request,
        `${API_BASE}/architecture-runs/${runId}/graph`,
      );
      const failedRouter = graph.nodes?.find((node) => node.kind === 'router' && node.status === 'failed');
      const finalizer = graph.nodes?.find((node) => node.id === 'final-artifact' || node.kind === 'artifact');

      expect(graph.status).toBe('failed');
      expect(failedRouter?.errorCode).toBe('CONTRACT_VIOLATION');
      expect(finalizer?.status).toBe('cancelled');
    } finally {
      if (hostSessionId) {
        await deleteSessionIfExists(request, hostSessionId);
      }
    }
  });
});
