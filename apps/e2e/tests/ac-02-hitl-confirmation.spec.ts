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

const MOCK_VFS_WRITE_TRIGGER = '[[mock:tool:vfs_write:no-arg-progress]]';
const MOCK_VFS_WRITE_PATH = 'e2e/mock-tool-trigger.txt';
const MOCK_VFS_WRITE_CONTENT = 'mock-trigger-confirmation';

type HitlMode = 'manual' | 'auto' | 'bypass';

interface HitlConfig {
  mode: HitlMode;
  autoPersonaId: string | null;
}

async function openHitlPanel(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByTestId('nav-settings').click();
  await expect(page.getByTestId('settings-modal')).toBeVisible();
  await page.getByTestId('settings-tab-hitl').click();
  await expect(page.getByTestId('hitl-settings-panel')).toBeVisible();
}

async function saveManualHitlMode(page: Page): Promise<void> {
  await openHitlPanel(page);
  await page.getByRole('radio', { name: 'Manual' }).check();
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
      timeout: 15_000,
      message: `Expected ${filePath} to be written in session ${sessionId}`,
    })
    .toBe(expectedContent);
}

async function expectVfsMissing(
  request: APIRequestContext,
  sessionId: string,
  filePath: string,
): Promise<void> {
  await expect
    .poll(async () => {
      const response = await request.get(
        `${API_BASE}/sessions/${sessionId}/vfs/read?path=${encodeURIComponent(filePath)}`,
      );
      return response.ok();
    }, {
      timeout: 5_000,
      message: `Expected ${filePath} to stay absent in session ${sessionId}`,
    })
    .toBe(false);
}

async function runMockVfsWriteTool(page: Page): Promise<void> {
  const input = await expectComposerEnabled(page, 10_000);
  const sendButton = await getComposerSendButton(page);
  await input.fill(`${MOCK_VFS_WRITE_TRIGGER} Use exactly the vfs_write tool and nothing else.`);
  await sendButton.click();
}

// AC-02: When a tool with requiresConfirmation=true is called, user sees HITL dialog before execution
test.describe('AC-02: HITL tool confirmation', () => {
  test.describe.configure({ mode: 'serial' });

  test('REGRESSION: replayed stale confirmation is invalidated after a stale confirm click', async ({ page, request }) => {
    const suffix = Date.now();
    const title = `AC02 Stale Replay ${suffix}`;
    const requestId = `req-ac02-stale-${suffix}`;
    const toolCallId = `call-ac02-stale-${suffix}`;

    const sessionResponse = await request.post(`${API_BASE}/sessions`, {
      data: {
        personaId: 'default',
        title,
      },
    });
    expect(sessionResponse.ok()).toBeTruthy();
    const session = await sessionResponse.json() as { id: string };

    try {
      const seedResponse = await request.post(`${API_BASE}/test-support/tool-confirmations/seed-replay`, {
        data: {
          sessionId: session.id,
          requestId,
          toolCallId,
          toolName: 'image_generate',
          args: {
            prompt: 'Generate a coffee poster',
          },
          promptMessage: 'Please generate a coffee poster.',
          assistantMessage: 'I need confirmation before running image generation.',
        },
      });
      expect(seedResponse.ok()).toBeTruthy();

      await page.goto('/');
      await page.getByTestId('nav-talk').click();
      await selectSession(page, session.id, title);

      const confirmButton = page.getByTestId('confirmation-confirm-btn');
      await expect(confirmButton).toBeVisible({ timeout: 10000 });

      const dropResponse = await request.post(`${API_BASE}/test-support/tool-confirmations/drop`, {
        data: {
          requestId,
          sessionId: session.id,
        },
      });
      expect(dropResponse.ok()).toBeTruthy();

      await confirmButton.click();

      await expect(page.getByTestId('confirmation-confirm-btn')).toHaveCount(0);
      await expect(page.getByText('confirmation expired')).toBeVisible();
    } finally {
      await deleteSessionIfExists(request, session.id);
    }
  });

  test('confirming tool proceeds with execution and shows result', async ({ page, request }) => {
    const previousHitlConfig = await getHitlConfig(request);
    const previousActiveCredentialId = await getActiveCredentialId(request);
    const title = `AC02 Confirm ${Date.now()}`;
    let createdSessionId: string | null = null;

    try {
      await ensureEnvMockProvider(request);
      const session = await createSession(request, title, 'designer');
      createdSessionId = session.id;

      await saveManualHitlMode(page);
      await page.getByTestId('nav-talk').click();
      await selectSession(page, session.id, title);
      await runMockVfsWriteTool(page);

      const confirmButton = page.getByTestId('confirmation-confirm-btn');
      await expect(confirmButton).toBeVisible({ timeout: 10_000 });
      await confirmButton.click();

      await expect(confirmButton).toHaveCount(0, { timeout: 10_000 });
      await expect(page.getByText('awaiting confirmation')).toHaveCount(0);
      await expectVfsContent(request, session.id, MOCK_VFS_WRITE_PATH, MOCK_VFS_WRITE_CONTENT);
    } finally {
      if (createdSessionId) {
        await deleteSessionIfExists(request, createdSessionId);
      }
      await restoreHitlConfig(request, previousHitlConfig);
      await restoreActiveCredential(request, previousActiveCredentialId);
    }
  });

  test('cancelling tool shows cancellation message and does not execute', async ({ page, request }) => {
    const previousHitlConfig = await getHitlConfig(request);
    const previousActiveCredentialId = await getActiveCredentialId(request);
    const title = `AC02 Cancel ${Date.now()}`;
    let createdSessionId: string | null = null;

    try {
      await ensureEnvMockProvider(request);
      const session = await createSession(request, title, 'designer');
      createdSessionId = session.id;

      await saveManualHitlMode(page);
      await page.getByTestId('nav-talk').click();
      await selectSession(page, session.id, title);
      await runMockVfsWriteTool(page);

      const cancelButton = page.getByTestId('confirmation-cancel-btn');
      await expect(cancelButton).toBeVisible({ timeout: 10_000 });
      await cancelButton.click();

      await expect(page.getByTestId('confirmation-confirm-btn')).toHaveCount(0, { timeout: 10_000 });
      await expect(page.getByTestId('tool-call-chip').getByText('cancelled')).toBeVisible({ timeout: 10_000 });
      await expect(page.getByText('Tool call was cancelled before it completed.')).toBeVisible({ timeout: 10_000 });
      await expectVfsMissing(request, session.id, MOCK_VFS_WRITE_PATH);
    } finally {
      if (createdSessionId) {
        await deleteSessionIfExists(request, createdSessionId);
      }
      await restoreHitlConfig(request, previousHitlConfig);
      await restoreActiveCredential(request, previousActiveCredentialId);
    }
  });

  test('HITL dialog shows tool name and arguments', async ({ page, request }) => {
    const previousHitlConfig = await getHitlConfig(request);
    const previousActiveCredentialId = await getActiveCredentialId(request);
    const title = `AC02 Args ${Date.now()}`;
    let createdSessionId: string | null = null;

    try {
      await ensureEnvMockProvider(request);
      const session = await createSession(request, title, 'designer');
      createdSessionId = session.id;

      await saveManualHitlMode(page);
      await page.getByTestId('nav-talk').click();
      await selectSession(page, session.id, title);
      await runMockVfsWriteTool(page);

      await expect(page.getByTestId('tool-call-chip')).toContainText('vfs_write', { timeout: 10_000 });
      await expect(page.getByTestId('tool-call-target')).toContainText(MOCK_VFS_WRITE_PATH);
      const toggle = page.getByTestId('confirmation-args-toggle');
      await expect(toggle).toBeVisible({ timeout: 10_000 });
      await toggle.click();

      const expandedArgs = page.getByTestId('args-expanded');
      await expect(expandedArgs).toBeVisible({ timeout: 10_000 });
      await expect(expandedArgs).toContainText(`filePath: ${MOCK_VFS_WRITE_PATH}`);
      await expect(expandedArgs).toContainText(`content: ${MOCK_VFS_WRITE_CONTENT}`);
    } finally {
      if (createdSessionId) {
        await deleteSessionIfExists(request, createdSessionId);
      }
      await restoreHitlConfig(request, previousHitlConfig);
      await restoreActiveCredential(request, previousActiveCredentialId);
    }
  });
});
