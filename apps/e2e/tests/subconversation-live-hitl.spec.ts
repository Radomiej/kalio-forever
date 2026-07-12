import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import {
  API_BASE,
  deleteSessionIfExists,
  ensureEnvMockProvider,
  expectComposerEnabled,
  getActiveCredentialId,
  getComposerSendButton,
  restoreActiveCredential,
  selectSession,
} from './helpers/test-config';
import { restartPlaywrightBackend } from './helpers/restart-control';

const MANUAL_CHILD_TRIGGER = '[[mock:tool:run_subagent:hitl]]';
const AUTO_APPROVE_CHILD_TRIGGER = '[[mock:tool:run_subagent:auto-approve]]';
const CHILD_VFS_PATH = 'e2e/mock-tool-trigger.txt';
const CHILD_VFS_CONTENT = 'mock-trigger-confirmation';

type HitlMode = 'manual' | 'auto' | 'bypass';

interface HitlConfig {
  mode: HitlMode;
  autoPersonaId: string | null;
}

interface SessionListItem {
  id: string;
  title: string;
  parentSessionId?: string;
}

async function openHitlPanel(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByTestId('nav-settings').click();
  await expect(page.getByTestId('settings-modal')).toBeVisible();
  await page.getByTestId('settings-tab-hitl').click();
  await expect(page.getByTestId('hitl-settings-panel')).toBeVisible();
}

async function saveHitlMode(page: Page, mode: 'manual' | 'bypass'): Promise<void> {
  await openHitlPanel(page);
  await page.getByRole('radio', { name: mode === 'manual' ? 'Manual' : 'Bypass all' }).check();
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('HITL settings saved.')).toBeVisible({ timeout: 10_000 });
  await page.getByTestId('settings-close').click();
  await expect(page.getByTestId('settings-modal')).toHaveCount(0);
}

async function getHitlConfig(request: APIRequestContext): Promise<HitlConfig> {
  const response = await request.get(`${API_BASE}/hitl/config`);
  expect(response.ok()).toBeTruthy();
  return response.json() as Promise<HitlConfig>;
}

async function restoreHitlConfig(request: APIRequestContext, config: HitlConfig): Promise<void> {
  const response = await request.put(`${API_BASE}/hitl/config`, {
    data: config,
  });
  expect(response.ok()).toBeTruthy();
}

async function createSession(
  request: APIRequestContext,
  title: string,
  personaId: string,
): Promise<{ id: string; title: string }> {
  const response = await request.post(`${API_BASE}/sessions`, {
    data: { title, personaId },
  });
  expect(response.ok()).toBeTruthy();
  const session = await response.json() as { id: string };
  return { id: session.id, title };
}

async function findChildSessionId(request: APIRequestContext, parentSessionId: string): Promise<string> {
  let childSessionId: string | null = null;
  await expect
    .poll(async () => {
      const response = await request.get(`${API_BASE}/sessions`);
      if (!response.ok()) {
        childSessionId = null;
        return null;
      }
      const sessions = await response.json() as SessionListItem[];
      childSessionId = sessions.find((session) => session.parentSessionId === parentSessionId)?.id ?? null;
      return childSessionId;
    }, {
      timeout: 20_000,
      message: `Expected a child session for parent ${parentSessionId}`,
    })
    .not.toBeNull();
  if (!childSessionId) {
    throw new Error(`Missing child session for parent ${parentSessionId}`);
  }
  return childSessionId;
}

async function openChildSession(page: Page, parentSessionId: string, childSessionId: string): Promise<void> {
  const childItem = page.locator(`[data-testid="session-item"][data-session-id="${childSessionId}"]`);
  if (!(await childItem.isVisible().catch(() => false))) {
    const toggle = page.getByTestId(`toggle-session-children-${parentSessionId}`);
    if (await toggle.isVisible().catch(() => false)) {
      await toggle.click();
    }
  }

  await expect(childItem).toBeVisible({ timeout: 15_000 });
  await childItem.click();
  await expect
    .poll(() => page.evaluate(() => window.sessionStorage.getItem('kalio:last-active-session-id')), { timeout: 10_000 })
    .toBe(childSessionId);
}

async function expectVfsContent(
  request: APIRequestContext,
  sessionId: string,
  filePath: string,
  expectedContent: string,
): Promise<void> {
  await expect
    .poll(async () => {
      const response = await request.get(
        `${API_BASE}/sessions/${sessionId}/vfs/read?path=${encodeURIComponent(filePath)}`,
      );
      if (!response.ok()) {
        return null;
      }

      const payload = await response.json() as { content?: string };
      return payload.content ?? null;
    }, {
      timeout: 20_000,
      message: `Expected ${filePath} to be written in session ${sessionId}`,
    })
    .toBe(expectedContent);
}

async function sendPrompt(page: Page, content: string): Promise<void> {
  const input = await expectComposerEnabled(page, 10_000);
  const sendButton = await getComposerSendButton(page);
  await input.fill(content);
  await sendButton.click();
}

async function expectChildHitlAcrossRuntimeSurfaces(
  page: Page,
  parentSessionId: string,
  parentTitle: string,
  childSessionId: string,
): Promise<void> {
  await expect(page.getByTestId(`session-pending-confirmation-${childSessionId}`)).toBeVisible({ timeout: 20_000 });

  await selectSession(page, parentSessionId, parentTitle);
  await page.getByTestId('talk-sidebar-conversation-entry').click();
  if (!(await page.getByTestId('canvas-panel').isVisible().catch(() => false))) {
    const canvasToggle = page.getByTestId('canvas-toggle');
    if (await canvasToggle.isVisible().catch(() => false)) {
      await canvasToggle.click();
    } else {
      const openSubagentCanvas = page.getByTestId('open-subagent-canvas');
      await expect(openSubagentCanvas).toBeVisible({ timeout: 10_000 });
      await openSubagentCanvas.click();
    }
  }
  await expect(page.getByTestId(`canvas-subagent-status-${childSessionId}`)).toHaveAttribute('data-status', 'waiting', { timeout: 20_000 });

  await page.getByTestId('talk-sidebar-graph-entry').click();
  const graphNode = page.getByTestId(`graph-node-subagent:${childSessionId}`);
  await expect(graphNode).toBeVisible({ timeout: 20_000 });
  await expect(graphNode.locator('[aria-label="Status: waiting"]')).toBeVisible({ timeout: 20_000 });

  await openChildSession(page, parentSessionId, childSessionId);
  await expect(page.getByTestId('confirmation-confirm-btn')).toBeVisible({ timeout: 20_000 });
}

test.describe('Subconversation live HITL', () => {
  test('child session restores pending HITL after backend restart and then continues', async ({ page, request }) => {
    test.setTimeout(180_000);
    const previousHitlConfig = await getHitlConfig(request);
    const previousActiveCredentialId = await getActiveCredentialId(request);
    const title = `Child HITL ${Date.now()}`;
    let parentSessionId: string | null = null;
    let childSessionId: string | null = null;

    try {
      await ensureEnvMockProvider(request);
      const session = await createSession(request, title, 'default');
      parentSessionId = session.id;

      await saveHitlMode(page, 'manual');
      await page.getByTestId('nav-talk').click();
      await selectSession(page, session.id, title);

      await sendPrompt(page, `${MANUAL_CHILD_TRIGGER} Use a child that triggers vfs_write HITL.`);
      await expect(page.locator('[data-testid="tool-call-bubble"][data-tool-name="run_subagent"]')).toBeVisible({ timeout: 20_000 });

      childSessionId = await findChildSessionId(request, session.id);
      await openChildSession(page, session.id, childSessionId);

      const confirmButton = page.getByTestId('confirmation-confirm-btn');
      await expect(confirmButton).toBeVisible({ timeout: 20_000 });
      await expectChildHitlAcrossRuntimeSurfaces(page, session.id, title, childSessionId);

      await restartPlaywrightBackend();
      await page.reload();
      await page.getByTestId('nav-talk').click();
      await openChildSession(page, session.id, childSessionId);
      await expect(confirmButton).toBeVisible({ timeout: 20_000 });
      await expectChildHitlAcrossRuntimeSurfaces(page, session.id, title, childSessionId);

      await confirmButton.click();
      await expect(confirmButton).toHaveCount(0, { timeout: 15_000 });

      await expectVfsContent(request, session.id, CHILD_VFS_PATH, CHILD_VFS_CONTENT);
      await expect(page.getByTestId('message-list')).not.toContainText('Waiting for the first persisted message');
      await expect(page.getByTestId('confirmation-confirm-btn')).toHaveCount(0);
    } finally {
      if (childSessionId) {
        await deleteSessionIfExists(request, childSessionId);
      }
      if (parentSessionId) {
        await deleteSessionIfExists(request, parentSessionId);
      }
      await restoreHitlConfig(request, previousHitlConfig);
      await restoreActiveCredential(request, previousActiveCredentialId);
    }
  });

  test('auto-approved child tool completes without creating manual confirmation', async ({ page, request }) => {
    test.setTimeout(180_000);
    const previousHitlConfig = await getHitlConfig(request);
    const previousActiveCredentialId = await getActiveCredentialId(request);
    const title = `Child auto approve ${Date.now()}`;
    let parentSessionId: string | null = null;
    let childSessionId: string | null = null;

    try {
      await ensureEnvMockProvider(request);
      const session = await createSession(request, title, 'default');
      parentSessionId = session.id;

      await saveHitlMode(page, 'manual');
      await page.getByTestId('nav-talk').click();
      await selectSession(page, session.id, title);

      await sendPrompt(page, `${AUTO_APPROVE_CHILD_TRIGGER} Use a child that auto-approves vfs_write.`);
      await expect(page.locator('[data-testid="tool-call-bubble"][data-tool-name="run_subagent"]')).toBeVisible({ timeout: 20_000 });

      childSessionId = await findChildSessionId(request, session.id);
      await openChildSession(page, session.id, childSessionId);

      await expect(page.getByTestId('confirmation-confirm-btn')).toHaveCount(0, { timeout: 5_000 });
      await expectVfsContent(request, childSessionId, CHILD_VFS_PATH, CHILD_VFS_CONTENT);
    } finally {
      if (childSessionId) {
        await deleteSessionIfExists(request, childSessionId);
      }
      if (parentSessionId) {
        await deleteSessionIfExists(request, parentSessionId);
      }
      await restoreHitlConfig(request, previousHitlConfig);
      await restoreActiveCredential(request, previousActiveCredentialId);
    }
  });
});
