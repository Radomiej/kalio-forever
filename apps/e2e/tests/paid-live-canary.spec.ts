import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import {
  API_BASE,
  deleteSessionIfExists,
  expectComposerEnabled,
  getJsonWithTransportRetry,
  selectArchitectureInComposer,
  selectSession,
  sendMessageFromComposer,
} from './helpers/test-config';

const PROCESS_ENV = (globalThis as {
  process?: { env?: Record<string, string | undefined> };
}).process?.env;

type SessionItem = {
  id: string;
  runtimeContext?: {
    architectureContext?: { architectureRunId?: string };
  };
};

type GraphSnapshot = {
  status?: string;
  edges?: unknown[];
  nodes?: Array<{ id: string; label: string; kind: string; status?: string }>;
};

type ArchitectureEvent = {
  type?: string;
  message?: string;
};

async function waitForRunId(request: APIRequestContext, sessionId: string): Promise<string> {
  let runId: string | null = null;
  await expect.poll(async () => {
    const children = await getJsonWithTransportRetry<SessionItem[]>(
      request,
      `${API_BASE}/sessions/${encodeURIComponent(sessionId)}/children`,
    );
    runId = children
      .map((child) => child.runtimeContext?.architectureContext?.architectureRunId)
      .find((candidate): candidate is string => typeof candidate === 'string' && candidate.length > 0) ?? null;
    return runId;
  }, { timeout: 60_000 }).not.toBeNull();

  if (!runId) throw new Error('Paid canary did not create an Architecture run');
  return runId;
}

async function waitForCompletedGraph(request: APIRequestContext, runId: string): Promise<GraphSnapshot> {
  let graph: GraphSnapshot = {};
  await expect.poll(async () => {
    graph = await getJsonWithTransportRetry<GraphSnapshot>(
      request,
      `${API_BASE}/architecture-runs/${encodeURIComponent(runId)}/graph`,
    );
    return graph.status;
  }, { timeout: 180_000 }).toBe('completed');
  return graph;
}

async function expectBrowserUsesTestApi(page: Page): Promise<void> {
  const expectedOrigin = PROCESS_ENV?.PLAYWRIGHT_API_ORIGIN;
  if (!expectedOrigin) throw new Error('PLAYWRIGHT_API_ORIGIN is required for the paid canary');
  await expect.poll(async () => page.evaluate(async () => {
    const runtime = (window as unknown as {
      __KALIO_RUNTIME_CONFIG__?: { apiUrl?: string };
    }).__KALIO_RUNTIME_CONFIG__;
    if (!runtime?.apiUrl) return 'missing runtime apiUrl';
    const response = await fetch(`${runtime.apiUrl}/api/llm/config`);
    return response.url;
  })).toContain(expectedOrigin);
}

test('runs a single-node no-tool canary from Talk and restores it after reload', async ({ page, request }) => {
  test.setTimeout(240_000);
  const llmConfig = await getJsonWithTransportRetry<{ provider?: string }>(request, `${API_BASE}/llm/config`);
  if (llmConfig.provider !== 'mock' && PROCESS_ENV?.KALIO_RUN_PAID_CANARY !== '1') {
    test.skip(true, 'A live provider requires explicit KALIO_RUN_PAID_CANARY=1 opt-in');
  }

  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const title = `Paid Canary ${suffix}`;
  const variantResponse = await request.post(
    `${API_BASE}/architecture-registry/schemas/strategic-decision-council/variants`,
    {
      data: {
        name: title,
        description: 'One-call provider and workflow lifecycle canary.',
        nodes: [{
          id: 'paid-canary',
          label: 'Paid Canary',
          kind: 'artifact',
          roleSlotId: 'finalizer',
          maxToolAttempts: 1,
          toolOverride: { allowedToolNames: [] },
          behavior: { mode: 'finalize', description: 'Return the one-call paid canary result.' },
        }],
        edges: [],
        contextPolicy: {
          includeUserTask: true,
          includeProjectMemory: false,
          includeBrowserSession: false,
          includePriorDecisions: false,
          includeOtherAgentOutputs: false,
        },
      },
    },
  );
  expect(variantResponse.ok()).toBeTruthy();
  const variant = await variantResponse.json() as { id: string };
  const sessionResponse = await request.post(`${API_BASE}/sessions`, {
    data: { title, personaId: 'default' },
  });
  expect(sessionResponse.ok()).toBeTruthy();
  const session = await sessionResponse.json() as { id: string };
  let completed = false;
  let hiddenTitleCalls = 0;

  await page.route('**/api/sessions/*/generate-title', async (route) => {
    hiddenTitleCalls += 1;
    await route.abort();
  });

  try {
    await page.goto('/');
    await expectBrowserUsesTestApi(page);
    await page.getByTestId('nav-talk').click();
    await selectSession(page, session.id, title);
    await selectArchitectureInComposer(page, variant.id);
    await sendMessageFromComposer(page, 'Reply briefly with CANARY_OK. Do not call tools.');

    await expect(page.getByTestId('architecture-run-timeline')).toBeVisible({ timeout: 90_000 });
    const runId = await waitForRunId(request, session.id);
    const graph = await waitForCompletedGraph(request, runId);
    await expectComposerEnabled(page, 180_000);

    expect(graph.nodes).toHaveLength(1);
    expect(graph.nodes?.[0]).toEqual(expect.objectContaining({
      id: 'paid-canary',
      kind: 'artifact',
      status: 'completed',
    }));
    expect(graph.edges ?? []).toHaveLength(0);
    expect(hiddenTitleCalls).toBe(0);
    const events = await getJsonWithTransportRetry<ArchitectureEvent[]>(
      request,
      `${API_BASE}/architecture-runs/${encodeURIComponent(runId)}/events`,
    );
    const finalArtifacts = events.filter((event) => event.type === 'final_artifact');
    expect(finalArtifacts).toHaveLength(1);
    const finalArtifactMessage = finalArtifacts[0]?.message?.trim();
    expect(finalArtifactMessage).toBeTruthy();
    await expect(page.getByTestId('message-list')).toContainText(finalArtifactMessage as string, { timeout: 30_000 });

    await page.reload();
    await page.getByTestId('nav-talk').click();
    await selectSession(page, session.id, title);
    await expect(page.getByTestId('architecture-run-timeline')).toHaveAttribute('data-status', 'completed', { timeout: 30_000 });
    await expect(page.getByTestId('message-list')).toContainText(finalArtifactMessage as string);
    await page.getByTestId('open-architecture-run-canvas').click();
    await expect(page.getByTestId('architecture-run-canvas-section')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId('architecture-run-canvas-section')).toContainText('Finalizer');
    completed = true;
  } finally {
    await request.delete(`${API_BASE}/architecture-registry/schemas/${variant.id}`, { timeout: 5000 }).catch(() => undefined);
    if (completed || llmConfig.provider === 'mock') {
      await deleteSessionIfExists(request, session.id);
    }
  }
});
