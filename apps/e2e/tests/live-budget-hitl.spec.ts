import { existsSync } from 'node:fs';
import { expect, test, type APIRequestContext } from '@playwright/test';
import {
  API_BASE,
  deleteSessionIfExists,
  getJsonWithTransportRetry,
  selectArchitectureInComposer,
  selectSession,
  sendMessageFromComposer,
} from './helpers/test-config';

const projectPath = 'C:\\Projekty\\FamilyQuest';

type ArchitectureSchema = {
  id: string;
  name: string;
  nodes: Array<Record<string, unknown> & { id: string; kind?: string; maxToolAttempts?: number }>;
  edges: Array<Record<string, unknown> & { id: string; fromNodeId: string; toNodeId: string }>;
};

type SessionResponse = { id: string };

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
  expect(config.provider).toBe('xiaomimimo');
  expect(['db', 'env']).toContain(config.source);
  expect(config.model).toMatch(/mimo/i);
}

test.describe('Live Xiaomi budget HITL', () => {
  test.skip(!existsSync(projectPath), `Missing local project path: ${projectPath}`);

  test('surfaces a durable budget approval from a live workflow and resumes with +10', async ({ page, request }, testInfo) => {
    test.setTimeout(360_000);
    await expectLiveXiaomi(request);

    const title = `Live Budget HITL ${Date.now()}`;
    const variant = await createBudgetVariant(request, `Live Budget HITL ${Date.now()}`);
    let sessionId: string | null = null;

    try {
      const sessionResponse = await request.post(`${API_BASE}/sessions`, {
        data: { title, personaId: 'default' },
      });
      expect(sessionResponse.ok()).toBeTruthy();
      const session = await sessionResponse.json() as SessionResponse;
      sessionId = session.id;

      await page.goto('/');
      await page.getByTestId('nav-talk').click();
      await selectSession(page, session.id, title);
      await selectArchitectureInComposer(page, variant.id);
      await sendMessageFromComposer(
        page,
        `Use project path ${projectPath}. Your first assistant action must be a tool call: run fs_list on exactly ${projectPath}. Do not answer from memory before that tool call. The tiny role tool budget is intentional; when the tool-call limit is reached, request more budget instead of silently failing.`,
      );

      await expect(page.getByTestId('architecture-run-timeline')).toBeVisible({ timeout: 90_000 });
      await expect(page.getByText(`${title}: Pragmatist`)).toBeVisible({ timeout: 30_000 });
      await page.getByText(`${title}: Pragmatist`).first().click();
      await expect(page.getByTestId('turn-budget-approval')).toBeVisible({ timeout: 180_000 });
      await expect(page.getByTestId('turn-budget-approval')).toContainText('Agent reached tool loop limit 1/1');
      await page.getByRole('button', { name: '+10' }).click();
      await expect(page.getByTestId('turn-budget-approval')).not.toBeVisible({ timeout: 30_000 });
    } finally {
      if (sessionId && testInfo.status === testInfo.expectedStatus) {
        await deleteSessionIfExists(request, sessionId);
      }
      await request.delete(`${API_BASE}/architecture-registry/schemas/${variant.id}`, { timeout: 5000 }).catch(() => undefined);
    }
  });
});
