import { existsSync, readFileSync, statSync, unlinkSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { expect, test, type APIRequestContext } from '@playwright/test';
import {
  API_BASE,
  deleteSessionIfExists,
  expectComposerEnabled,
  getJsonWithTransportRetry,
  selectSession,
  sendMessageFromComposer,
} from './helpers/test-config';

const PROCESS_ENV = (globalThis as {
  process?: { env?: Record<string, string | undefined> };
}).process?.env;

interface HitlConfig {
  mode: 'manual' | 'auto' | 'bypass';
  autoPersonaId: string | null;
  unattendedFallback: string;
  representativePersonaId: string | null;
  notificationChannel: string;
  externalPolicyEnabled: boolean;
  externalPolicyPersonaId: string | null;
  raAppApprovalTimeoutMs: number;
}

interface AllowedPath {
  id: string;
  path: string;
}

async function putHitlConfig(request: APIRequestContext, config: HitlConfig): Promise<void> {
  const response = await request.put(`${API_BASE}/hitl/config`, { data: config });
  expect(response.ok()).toBeTruthy();
}

test('runs one confirmed fs_write against the explicit safe path and restores state', async ({ page, request }) => {
  test.setTimeout(240_000);
  const llmConfig = await getJsonWithTransportRetry<{ provider?: string; model?: string }>(
    request,
    `${API_BASE}/llm/config`,
  );
  if (llmConfig.provider === 'mock' || PROCESS_ENV?.KALIO_RUN_PAID_TOOL_CANARY !== '1') {
    test.skip(true, 'This canary requires an explicitly enabled live provider');
  }

  const safeRootValue = PROCESS_ENV?.KALIO_SAFE_TOOL_PATH;
  expect(safeRootValue, 'KALIO_SAFE_TOOL_PATH must be set by the bounded paid runner').toBeTruthy();
  const safeRoot = resolve(safeRootValue as string);
  expect(statSync(safeRoot).isDirectory()).toBe(true);

  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const markerContent = `KALIO_PAID_TOOL_CANARY_${suffix}`;
  const markerPath = resolve(safeRoot, `kalio-paid-tool-canary-${suffix}.txt`);
  const title = `Paid Tool Canary ${suffix}`;
  expect(existsSync(markerPath), 'canary refuses to overwrite an existing file').toBe(false);

  const previousHitlConfig = await getJsonWithTransportRetry<HitlConfig>(request, `${API_BASE}/hitl/config`);
  const allowedPaths = await getJsonWithTransportRetry<AllowedPath[]>(request, `${API_BASE}/allowed-paths`);
  const existingAllowedPath = allowedPaths.find((entry) => resolve(entry.path).toLowerCase() === safeRoot.toLowerCase());
  let createdAllowedPathId: string | null = null;
  let personaId: string | null = null;
  let sessionId: string | null = null;
  let hiddenTitleRequests = 0;

  await page.route('**/api/sessions/*/generate-title', async (route) => {
    hiddenTitleRequests += 1;
    await route.abort();
  });

  try {
    if (!existingAllowedPath) {
      const allowedPathResponse = await request.post(`${API_BASE}/allowed-paths`, { data: { path: safeRoot } });
      expect(allowedPathResponse.ok()).toBeTruthy();
      createdAllowedPathId = (await allowedPathResponse.json() as AllowedPath).id;
    }

    await putHitlConfig(request, { ...previousHitlConfig, mode: 'manual' });

    const personaResponse = await request.post(`${API_BASE}/personas`, {
      data: {
        name: title,
        systemPrompt: 'You are a bounded release canary. Call only fs_write, exactly once, with the exact path and content requested. Do not call any other tool.',
        model: llmConfig.model ?? '',
        allowedTools: ['fs_write'],
      },
    });
    expect(personaResponse.ok()).toBeTruthy();
    personaId = (await personaResponse.json() as { id: string }).id;

    const sessionResponse = await request.post(`${API_BASE}/sessions`, {
      data: { title, personaId },
    });
    expect(sessionResponse.ok()).toBeTruthy();
    sessionId = (await sessionResponse.json() as { id: string }).id;

    await page.goto('/');
    await page.getByTestId('nav-talk').click();
    await selectSession(page, sessionId, title);
    await sendMessageFromComposer(
      page,
      `Use fs_write exactly once. Set path to ${JSON.stringify(markerPath)} and content to ${JSON.stringify(markerContent)}. Do not call any other tool.`,
    );

    const messageList = page.getByTestId('message-list');
    const pendingTool = messageList.getByTestId('tool-call-bubble').filter({ hasText: 'fs_write' });
    await expect(pendingTool).toBeVisible({ timeout: 120_000 });
    const confirmButton = messageList.getByTestId('confirmation-confirm-btn');
    await expect(confirmButton).toBeVisible({ timeout: 10_000 });
    expect(existsSync(markerPath), 'fs_write must remain blocked before confirmation').toBe(false);

    await confirmButton.click();
    await expect(confirmButton).toBeHidden({ timeout: 10_000 });
    await expect.poll(
      () => existsSync(markerPath) ? readFileSync(markerPath, 'utf8') : null,
      { timeout: 60_000, message: 'confirmed fs_write did not create the exact marker content' },
    ).toBe(markerContent);
    await expectComposerEnabled(page, 120_000);
    expect(hiddenTitleRequests, 'the canary must not spend an extra request on title generation').toBe(0);

    await page.reload();
    await page.getByTestId('nav-talk').click();
    await selectSession(page, sessionId, title);
    const restoredTool = page.getByTestId('tool-call-bubble').filter({ hasText: 'fs_write' });
    await expect(restoredTool).toBeVisible({ timeout: 30_000 });
    await expect(restoredTool).toContainText(basename(markerPath));
  } finally {
    if (sessionId) await deleteSessionIfExists(request, sessionId);
    if (personaId) await request.delete(`${API_BASE}/personas/${personaId}`, { timeout: 5000 }).catch(() => undefined);
    await putHitlConfig(request, previousHitlConfig).catch(() => undefined);
    if (createdAllowedPathId) {
      await request.delete(`${API_BASE}/allowed-paths/${createdAllowedPathId}`, { timeout: 5000 }).catch(() => undefined);
    }
    if (existsSync(markerPath)) unlinkSync(markerPath);
  }
});
