import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import {
  API_BASE,
  deleteSessionIfExists,
  ensureEnvMockProvider,
  expectComposerEnabled,
  getComposerSendButton,
  getActiveCredentialId,
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

test.describe('HITL tool confirmation on built QA', () => {
  test('manual mode blocks a mock tool until the user confirms it', async ({ page, request }) => {
    const previousHitlConfig = await getHitlConfig(request);
    const previousActiveCredentialId = await getActiveCredentialId(request);
    const title = `HITL runtime ${Date.now()}`;
    let createdSessionId: string | null = null;

    try {
      await ensureEnvMockProvider(request);
      const session = await createSession(request, title, 'designer');
      createdSessionId = session.id;

      await saveHitlMode(page, 'manual');
      await page.getByTestId('nav-talk').click();
      await selectSession(page, session.id, title);

      const input = await expectComposerEnabled(page, 10_000);
      const sendButton = await getComposerSendButton(page);
      await input.fill(`${MOCK_VFS_WRITE_TRIGGER} Use exactly the vfs_write tool and nothing else.`);
      await sendButton.click();

      const messageList = page.getByTestId('message-list');
      const confirmButton = messageList.getByTestId('confirmation-confirm-btn');
      await expect(confirmButton).toBeVisible({ timeout: 10_000 });
      await confirmButton.click();
      await expect(confirmButton).toBeHidden({ timeout: 10_000 });

      await expectVfsContent(request, session.id, MOCK_VFS_WRITE_PATH, MOCK_VFS_WRITE_CONTENT);
    } finally {
      if (createdSessionId) {
        await deleteSessionIfExists(request, createdSessionId);
      }
      await restoreHitlConfig(request, previousHitlConfig);
      await restoreActiveCredential(request, previousActiveCredentialId);
    }
  });
});
