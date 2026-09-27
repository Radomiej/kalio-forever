import { expect, test, type APIRequestContext } from '@playwright/test';
import {
  API_BASE,
  deleteSessionIfExists,
  ensureEnvMockProvider,
  getActiveCredentialId,
  restoreActiveCredential,
  selectArchitectureInComposer,
  selectSession,
  selectSessionOriginFilter,
  sendMessageFromComposer,
} from './helpers/test-config';

type SessionItem = {
  id: string;
  title: string;
  runtimeContext?: {
    architectureContext?: {
      architectureRunId?: string;
    };
  };
};

type ArchitectureGraph = {
  status?: string;
  nodes?: Array<{
    id: string;
    kind: string;
    status?: string;
    sessionId?: string;
  }>;
  routeHops?: Array<{
    fromNodeId: string;
    toNodeId: string;
    selectedEdgeId?: string;
    source?: string;
    decisionReason?: string;
    confidence?: number;
  }>;
};

type HitlConfig = Record<string, unknown>;

async function getHitlConfig(request: APIRequestContext): Promise<HitlConfig> {
  const response = await request.get(`${API_BASE}/hitl/config`);
  expect(response.ok()).toBeTruthy();
  return await response.json() as HitlConfig;
}

async function putHitlConfig(request: APIRequestContext, config: HitlConfig): Promise<void> {
  const response = await request.put(`${API_BASE}/hitl/config`, { data: config });
  expect(response.ok()).toBeTruthy();
}

async function findRunId(request: APIRequestContext, hostSessionId: string): Promise<string> {
  let runId: string | null = null;
  await expect.poll(async () => {
    const visited = new Set<string>();
    const queue = [hostSessionId];
    while (queue.length > 0) {
      const parentId = queue.shift();
      if (!parentId || visited.has(parentId)) continue;
      visited.add(parentId);
      const response = await request.get(`${API_BASE}/sessions/${encodeURIComponent(parentId)}/children`);
      if (!response.ok()) continue;
      const children = await response.json() as SessionItem[];
      for (const child of children) {
        queue.push(child.id);
        runId ??= child.runtimeContext?.architectureContext?.architectureRunId ?? null;
      }
    }
    return runId;
  }, { timeout: 60_000 }).not.toBeNull();

  if (!runId) throw new Error('Auto-routing run did not appear in scoped session descendants.');
  return runId;
}

async function getCompletedGraph(request: APIRequestContext, runId: string): Promise<ArchitectureGraph> {
  let graph: ArchitectureGraph | null = null;
  await expect.poll(async () => {
    const response = await request.get(`${API_BASE}/architecture-runs/${runId}/graph`);
    if (!response.ok()) return `http:${response.status()}`;
    graph = await response.json() as ArchitectureGraph;
    const autoRoute = graph.nodes?.find((node) => node.id === 'auto-route');
    const finalArtifact = graph.nodes?.find((node) => node.id === 'final-artifact');
    return `${graph.status ?? 'missing'}:${autoRoute?.status ?? 'missing'}:${finalArtifact?.status ?? 'missing'}`;
  }, { timeout: 180_000 }).toBe('completed:completed:completed');

  if (!graph) throw new Error('Completed Auto-routing graph was not returned.');
  return graph;
}

async function getSessionDescendants(request: APIRequestContext, rootId: string): Promise<SessionItem[]> {
  const result: SessionItem[] = [];
  const seen = new Set<string>();
  const queue = [rootId];
  while (queue.length > 0) {
    const parentId = queue.shift();
    if (!parentId) continue;
    const response = await request.get(`${API_BASE}/sessions/${encodeURIComponent(parentId)}/children`);
    expect(response.ok()).toBeTruthy();
    const children = await response.json() as SessionItem[];
    for (const child of children) {
      if (seen.has(child.id)) continue;
      seen.add(child.id);
      result.push(child);
      queue.push(child.id);
    }
  }
  return result;
}

test('Jev Auto-routing falls back durably and stays visible across Architect, Talk, Canvas, graph, and F5', async ({ page, request }, testInfo) => {
  test.setTimeout(300_000);
  const title = `Jev Auto-routing E2E ${Date.now()}`;
  const variantName = `Jev Auto-routing E2E ${Date.now()}`;
  let variantId: string | null = null;
  let savedVariantId: string | null = null;
  let sessionId: string | null = null;
  let originalHitlConfig: HitlConfig | null = null;
  const activeCredentialId = await getActiveCredentialId(request);

  try {
    await ensureEnvMockProvider(request);
    originalHitlConfig = await getHitlConfig(request);
    await putHitlConfig(request, {
      ...originalHitlConfig,
      mode: 'manual',
      jevCredentialId: null,
      jevApprovalThreshold: 0.9,
    });

    await page.goto('/');
    await page.getByTestId('nav-settings').click();
    await expect(page.getByTestId('settings-modal')).toBeVisible();
    await page.getByTestId('settings-tab-hitl').click();
    await expect(page.getByTestId('hitl-settings-panel')).toBeVisible();
    await page.getByRole('radio', { name: 'Jev' }).check();
    await expect(page.getByLabel('Jev OpenRouter credential')).toBeVisible();
    await expect(page.getByLabel('Jev approval threshold')).toHaveValue('0.9');
    await expect(page.getByLabel('Jev approval instructions')).toBeVisible();
    await page.getByTestId('settings-close').click();

    const variantResponse = await request.post(`${API_BASE}/architecture-registry/schemas/strategic-decision-council/variants`, {
      data: {
        name: variantName,
        description: 'E2E graph with Jev choice and a safe default agent.',
        nodes: [
          {
            id: 'auto-route',
            label: 'Choose reviewer',
            kind: 'auto_router',
            autoRouting: { confidenceThreshold: 0.8, instructions: 'Choose the best reviewer.' },
            x: 420,
            y: 80,
          },
          { id: 'pragmatist', label: 'Pragmatist', kind: 'role', roleSlotId: 'pragmatist', x: 220, y: 260 },
          { id: 'innovator', label: 'Innovator', kind: 'role', roleSlotId: 'innovator', x: 620, y: 260 },
          { id: 'final-artifact', label: 'Final Artifact', kind: 'artifact', roleSlotId: 'finalizer', x: 420, y: 440 },
        ],
        edges: [
          { id: 'auto-route-choice', fromNodeId: 'auto-route', toNodeId: 'pragmatist', selection: 'choice', label: 'Prioritize practical delivery risk.' },
          { id: 'auto-route-default', fromNodeId: 'auto-route', toNodeId: 'innovator', selection: 'default' },
          { id: 'pragmatist-final', fromNodeId: 'pragmatist', toNodeId: 'final-artifact' },
          { id: 'innovator-final', fromNodeId: 'innovator', toNodeId: 'final-artifact' },
        ],
      },
    });
    expect(variantResponse.ok()).toBeTruthy();
    const variant = await variantResponse.json() as { id: string };
    variantId = variant.id;

    await page.getByTestId('nav-architect').click();
    await expect(page.getByTestId('architect-page')).toBeVisible();
    await page.getByTestId('architect-registry-search').fill(variantName);
    await page.getByTestId(`architect-schema-${variant.id}`).click();
    await page.getByTestId('architect-node-auto-route').click();
    await page.getByTestId('architect-node-properties-open').click();
    await expect(page.getByTestId('architect-auto-routing-config')).toBeVisible();
    await page.getByTestId('architect-auto-routing-confidence').fill('0.76');
    await page.getByTestId('architect-auto-routing-instructions').fill('Prefer explicit evidence; otherwise use the safe default.');
    await page.getByTestId('architect-edge-label-auto-route-choice').fill('Choose Pragmatist only with concrete delivery evidence.');
    await page.getByTestId('architect-node-properties-close').click();
    await page.getByTestId('architect-save-variant').click();
    await page.getByTestId('architect-variant-name-input').fill(`${variantName} edited`);
    await page.getByTestId('architect-confirm-save-variant').click();

    await expect.poll(async () => {
      const response = await request.get(`${API_BASE}/architecture-registry/schemas`);
      if (!response.ok()) return null;
      const schemas = await response.json() as Array<{ id: string; name: string }>;
      return schemas.find((schema) => schema.name === `${variantName} edited`)?.id ?? null;
    }, { timeout: 30_000 }).not.toBeNull();
    const schemasResponse = await request.get(`${API_BASE}/architecture-registry/schemas`);
    expect(schemasResponse.ok()).toBeTruthy();
    const schemas = await schemasResponse.json() as Array<{
      id: string;
      name: string;
      nodes?: Array<{ id: string; autoRouting?: { confidenceThreshold?: number; instructions?: string } }>;
      edges?: Array<{ id: string; label?: string }>;
    }>;
    const savedVariant = schemas.find((schema) => schema.name === `${variantName} edited`);
    expect(savedVariant).toBeTruthy();
    if (!savedVariant) throw new Error('Architect did not persist the edited Auto-routing variant.');
    savedVariantId = savedVariant.id;
    expect(savedVariant.nodes?.find((node) => node.id === 'auto-route')?.autoRouting).toEqual({
      confidenceThreshold: 0.76,
      instructions: 'Prefer explicit evidence; otherwise use the safe default.',
    });
    expect(savedVariant.edges?.find((edge) => edge.id === 'auto-route-choice')?.label)
      .toBe('Choose Pragmatist only with concrete delivery evidence.');

    const sessionResponse = await request.post(`${API_BASE}/sessions`, {
      data: { title, personaId: 'default' },
    });
    expect(sessionResponse.ok()).toBeTruthy();
    const session = await sessionResponse.json() as { id: string };
    sessionId = session.id;

    await page.getByTestId('nav-talk').click();
    await selectSession(page, session.id, title);
    await selectArchitectureInComposer(page, savedVariant.id);
    await expect(page.getByTestId('welcome-architecture-select').locator(`option[value="${savedVariant.id}"]`)).toHaveCount(1);
    await sendMessageFromComposer(page, 'Route this review to the appropriate reviewer and produce a concise final result.');

    await expect(page.getByTestId('architecture-run-timeline')).toBeVisible({ timeout: 90_000 });
    const runId = await findRunId(request, session.id);
    const graph = await getCompletedGraph(request, runId);
    const autoRoute = graph.nodes?.find((node) => node.id === 'auto-route');
    const fallbackAgent = graph.nodes?.find((node) => node.id === 'innovator');
    const autoRouteHop = graph.routeHops?.find((hop) => hop.fromNodeId === 'auto-route');
    expect(autoRoute?.kind).toBe('auto_router');
    expect(autoRouteHop).toMatchObject({
      toNodeId: 'innovator',
      selectedEdgeId: 'auto-route-default',
      source: 'runtime_fallback',
      decisionReason: 'credential_missing',
    });
    expect(fallbackAgent?.status).toBe('completed');
    expect(fallbackAgent?.sessionId).toBeTruthy();

    const routeCard = page.getByTestId('architecture-route-auto-routing');
    await expect(routeCard).toContainText('Choose reviewer');
    await expect(routeCard).toContainText('auto-route-default');
    await expect(routeCard).toContainText('credential_missing');

    await selectSessionOriginFilter(page, 'agent');
    await expect(page.locator(`[data-testid="session-item"][data-session-id="${fallbackAgent?.sessionId}"]`)).toBeVisible({ timeout: 30_000 });
    await selectSession(page, session.id, title);

    await page.getByTestId('open-architecture-run-canvas').click();
    const canvas = page.getByTestId('architecture-run-canvas-section');
    await expect(canvas).toBeVisible();
    await expect(canvas).toContainText('Auto-routing');
    await expect(canvas).toContainText('auto-route-default');

    await page.getByTestId('talk-graph-switcher').click();
    const routerGraphNode = page.locator('[data-testid^="graph-node-architecture-route:"]').first();
    await expect(routerGraphNode).toBeVisible({ timeout: 30_000 });
    await expect(routerGraphNode).toContainText('Auto-routing');
    await routerGraphNode.click();
    const graphInspector = page.getByTestId('execution-graph-inspector');
    await expect(graphInspector).toContainText('auto-route-default');
    await expect(graphInspector).toContainText('credential_missing');

    await page.reload();
    await page.getByTestId('nav-talk').click();
    await selectSession(page, session.id, title);
    await page.getByTestId('execution-graph-view').getByTestId('talk-conversation-switcher').click();
    await expect(page.getByTestId('architecture-run-timeline')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('architecture-route-auto-routing')).toContainText('auto-route-default');

    await selectSessionOriginFilter(page, 'agent');
    await expect(page.locator(`[data-testid="session-item"][data-session-id="${fallbackAgent?.sessionId}"]`)).toBeVisible({ timeout: 30_000 });
    await selectSession(page, session.id, title);
    await page.getByTestId('open-architecture-run-canvas').click();
    await expect(page.getByTestId('architecture-run-canvas-section')).toContainText('auto-route-default');

    await page.getByTestId('chat-interface').getByTestId('talk-graph-switcher').click();
    const replayedRouterNode = page.locator('[data-testid^="graph-node-architecture-route:"]').first();
    await expect(replayedRouterNode).toContainText('Auto-routing');
    await replayedRouterNode.click();
    await expect(page.getByTestId('execution-graph-inspector')).toContainText('auto-route-default');
    await expect(page.getByTestId('execution-graph-inspector')).toContainText('credential_missing');

    const replayedGraph = await getCompletedGraph(request, runId);
    expect(replayedGraph.routeHops?.filter((hop) => hop.fromNodeId === 'auto-route')).toHaveLength(1);

    const screenshotPath = testInfo.outputPath('jev-auto-routing-replay.png');
    await page.screenshot({ path: screenshotPath, fullPage: true });
  } finally {
    if (sessionId) await deleteSessionIfExists(request, sessionId);
    for (const id of [savedVariantId, variantId]) {
      if (!id) continue;
      const response = await request.delete(`${API_BASE}/architecture-registry/schemas/${id}`);
      expect([200, 204, 404]).toContain(response.status());
    }
    if (originalHitlConfig) await putHitlConfig(request, originalHitlConfig);
    await restoreActiveCredential(request, activeCredentialId);
  }
});
