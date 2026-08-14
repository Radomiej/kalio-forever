import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import {
  API_BASE,
  APP_BASE,
  deleteSessionIfExists,
  getJsonWithTransportRetry,
  selectArchitectureInComposer,
  selectSession,
  sendMessageFromComposer,
} from './helpers/test-config';

type ArchitectureSchema = {
  id: string;
  name: string;
  nodes: Array<Record<string, unknown> & { id: string; kind?: string; maxToolAttempts?: number }>;
  edges: Array<Record<string, unknown> & { id: string; fromNodeId: string; toNodeId: string }>;
};

type SessionResponse = { id: string };
type RuntimeConfig = { apiUrl?: string; wsUrl?: string };

function expectedApiOrigin(): string {
  return new URL(API_BASE).origin;
}

async function expectBrowserUsesTestApi(page: Page): Promise<void> {
  const runtimeConfig = await page.evaluate(() => (
    window as unknown as { __KALIO_RUNTIME_CONFIG__?: RuntimeConfig }
  ).__KALIO_RUNTIME_CONFIG__ ?? null) as RuntimeConfig | null;
  expect(runtimeConfig?.apiUrl, `Expected ${APP_BASE} runtime config to point at Playwright API`).toBe(expectedApiOrigin());
}

async function collectSessionDiagnostics(request: APIRequestContext, sessionId: string): Promise<unknown> {
  const [sessionResponse, childrenResponse] = await Promise.all([
    request.get(`${API_BASE}/sessions/${sessionId}`, { timeout: 10_000 }).catch((error: unknown) => error),
    request.get(`${API_BASE}/sessions/${sessionId}/children`, { timeout: 10_000 }).catch((error: unknown) => error),
  ]);
  return {
    session: await responsePayload(sessionResponse),
    children: await responsePayload(childrenResponse),
  };
}

async function responsePayload(value: unknown): Promise<unknown> {
  if (value instanceof Error) {
    return { error: value.message };
  }
  if (!value || typeof value !== 'object' || !('ok' in value)) {
    return { error: String(value) };
  }
  const response = value as { ok: () => boolean; status: () => number; text: () => Promise<string> };
  const text = await response.text().catch((error: unknown) => `ERR ${String(error)}`);
  return {
    ok: response.ok(),
    status: response.status(),
    text: text.slice(0, 4000),
  };
}

async function createBudgetVariant(request: APIRequestContext, name: string): Promise<ArchitectureSchema> {
  const base = await getJsonWithTransportRetry<ArchitectureSchema>(
    request,
    `${API_BASE}/architecture-registry/schemas/strategic-decision-council`,
  );
  const pragmatist = base.nodes.find((node) => node.id === 'pragmatist');
  const finalArtifact = base.nodes.find((node) => node.id === 'final-artifact');
  if (!pragmatist || !finalArtifact) {
    throw new Error('Strategic Decision Council seed is missing the pragmatist/final-artifact nodes');
  }
  const nodes = [
    { ...pragmatist, maxToolAttempts: 1 },
    finalArtifact,
  ];
  const edges = [{
    id: 'pragmatist-final-artifact',
    fromNodeId: 'pragmatist',
    toNodeId: 'final-artifact',
    selection: 'converge',
  }];
  const response = await request.post(`${API_BASE}/architecture-registry/schemas/strategic-decision-council/variants`, {
    data: {
      name,
      description: 'Live budget HITL proof variant with one intentionally tiny role tool budget.',
      nodes,
      edges,
    },
  });
  expect(response.ok()).toBeTruthy();
  return await response.json() as ArchitectureSchema;
}

async function expectLiveXiaomi(request: APIRequestContext): Promise<void> {
  const config = await getJsonWithTransportRetry<{ provider?: string; model?: string; source?: string }>(
    request,
    `${API_BASE}/llm/config`,
  );
  test.skip(config.provider !== 'xiaomimimo', `Live Xiaomi budget HITL requires xiaomimimo provider, got ${config.provider ?? 'unknown'}.`);
  expect(config.provider).toBe('xiaomimimo');
  expect(['db', 'env']).toContain(config.source);
  expect(config.model).toMatch(/mimo/i);
}

test.describe('Live Xiaomi budget HITL', () => {
  test('surfaces a durable budget approval from a live workflow and resumes with +10', async ({ page, request }, testInfo) => {
    test.setTimeout(360_000);
    await expectLiveXiaomi(request);

    const title = `Live Budget HITL ${Date.now()}`;
    const variant = await createBudgetVariant(request, `Live Budget HITL ${Date.now()}`);
    let sessionId: string | null = null;
    let failed = false;

    try {
      const sessionResponse = await request.post(`${API_BASE}/sessions`, {
        data: { title, personaId: 'default' },
      });
      expect(sessionResponse.ok()).toBeTruthy();
      const session = await sessionResponse.json() as SessionResponse;
      sessionId = session.id;

      await page.goto('/');
      await expectBrowserUsesTestApi(page);
      await page.getByTestId('nav-talk').click();
      await selectSession(page, session.id, title);
      await selectArchitectureInComposer(page, variant.id);
      await sendMessageFromComposer(
        page,
        'Your first assistant action must be exactly one tool call: run vfs_list with empty JSON arguments {}. Do not include any final answer text before that tool call. The tiny role tool budget is intentional; after that first tool call, the runtime must pause for more budget instead of silently finishing.',
      );

      await expect(page.getByTestId('architecture-run-timeline')).toBeVisible({ timeout: 90_000 });
      await expect(page.getByText(`${title}: Pragmatist`)).toBeVisible({ timeout: 30_000 });
      await page.getByText(`${title}: Pragmatist`).first().click();
      await expect(page.getByTestId('turn-budget-approval')).toBeVisible({ timeout: 180_000 });
      await expect(page.getByTestId('turn-budget-approval')).toContainText('Agent reached tool loop limit 1/1');
      await page.getByRole('button', { name: '+10' }).click();
      await expect(page.getByTestId('turn-budget-approval')).not.toBeVisible({ timeout: 30_000 });
    } catch (error) {
      failed = true;
      if (sessionId) {
        const diagnostics = await collectSessionDiagnostics(request, sessionId);
        await testInfo.attach('session-diagnostics.json', {
          body: JSON.stringify(diagnostics, null, 2),
          contentType: 'application/json',
        });
      }
      throw error;
    } finally {
      if (sessionId && !failed) {
        await deleteSessionIfExists(request, sessionId);
      }
      await request.delete(`${API_BASE}/architecture-registry/schemas/${variant.id}`, { timeout: 5000 }).catch(() => undefined);
    }
  });
});
