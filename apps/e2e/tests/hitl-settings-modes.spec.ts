import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { API_BASE, deleteSessionIfExists, isMockLlm, selectSession } from './helpers/test-config';

const MOCK_VFS_WRITE_TRIGGER = '[[mock:tool:vfs_write:no-arg-progress]]';
const MOCK_VFS_WRITE_PATH = 'e2e/mock-tool-trigger.txt';
const MOCK_VFS_WRITE_CONTENT = 'mock-trigger-confirmation';

type HitlMode = 'manual' | 'auto' | 'bypass';

interface HitlConfig {
  mode: HitlMode;
  autoPersonaId: string | null;
}

function uniqueName(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

async function openHitlPanel(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByTestId('nav-settings').click();
  await expect(page.getByTestId('settings-modal')).toBeVisible();
  await page.getByTestId('settings-tab-hitl').click();
  await expect(page.getByTestId('hitl-settings-panel')).toBeVisible();
}

async function saveHitlMode(page: Page, mode: Extract<HitlMode, 'manual' | 'bypass'>): Promise<void> {
  await openHitlPanel(page);

  if (mode === 'manual') {
    await page.getByLabel('Manual').check();
  } else {
    await page.getByLabel('Bypass all').check();
  }

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

async function getActiveCredentialId(request: APIRequestContext): Promise<string | null> {
  const response = await request.get(`${API_BASE}/credentials/active`);
  expect(response.ok()).toBeTruthy();
  const payload = await response.json() as { credentialId?: string | null };
  return payload.credentialId ?? null;
}

async function restoreActiveCredential(request: APIRequestContext, credentialId: string | null): Promise<void> {
  if (credentialId) {
    const activateResponse = await request.put(`${API_BASE}/credentials/active/${credentialId}`);
    expect(activateResponse.ok()).toBeTruthy();
    return;
  }

  await request.delete(`${API_BASE}/credentials/active`).catch(() => undefined);
}

async function ensureEnvMockProvider(request: APIRequestContext): Promise<void> {
  await request.delete(`${API_BASE}/credentials/active`).catch(() => undefined);
  await expect.poll(async () => isMockLlm(request), {
    timeout: 10_000,
    message: 'Expected Playwright stack to fall back to env mock provider',
  }).toBe(true);
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

async function seedRaAppFixture(
  request: APIRequestContext,
  sessionId: string,
  filePath: string,
  fileContent: string,
): Promise<void> {
  const toolCallId = `tc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const approvalId = `approval-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  const response = await request.post(`${API_BASE}/test-support/raapp-hitl/seed`, {
    data: {
      sessionId,
      toolCallId,
      promptMessage: 'Launch the seeded RA-App fixture.',
      assistantMessage: 'I prepared a seeded RA-App with one approval-required native operation.',
      block: {
        type: 'html',
        mode: 'interactive',
        content: '<!DOCTYPE html><html><body><p>Seeded RA-App fixture</p></body></html>',
      },
      approvals: [
        {
          id: approvalId,
          system: 'vfs_write',
          displayLabel: 'seeded write',
          args: {
            path: filePath,
            content: fileContent,
          },
        },
      ],
    },
  });

  expect(response.ok()).toBeTruthy();
}

async function openTalk(page: Page): Promise<void> {
  await page.getByTestId('nav-talk').click();
  await expect(page.getByTestId('chat-interface')).toBeVisible({ timeout: 10_000 });
}

async function runMockVfsWriteTool(page: Page): Promise<void> {
  const chatInput = page.getByTestId('chat-input');
  await expect(chatInput).toBeEnabled({ timeout: 10_000 });
  await chatInput.fill(`${MOCK_VFS_WRITE_TRIGGER} Use exactly the vfs_write tool and nothing else.`);
  await page.getByTestId('chat-send-btn').click();
}

test.describe('HITL settings modes', () => {
  test.describe.configure({ mode: 'serial' });

  test('manual mode shows tool confirmation and RA-App approval overlay', async ({ page, request }) => {
    const previousHitlConfig = await getHitlConfig(request);
    const previousActiveCredentialId = await getActiveCredentialId(request);
    const createdSessions: string[] = [];

    try {
      await ensureEnvMockProvider(request);

      const toolSession = await createSession(request, uniqueName('HITL Tool Manual'), 'designer');
      const raappSession = await createSession(request, uniqueName('HITL RAApp Manual'), 'ra-apps');
      createdSessions.push(toolSession.id, raappSession.id);

      await saveHitlMode(page, 'manual');
      await openTalk(page);

      await selectSession(page, toolSession.id, toolSession.title);
      await runMockVfsWriteTool(page);

      const confirmButton = page.getByTestId('confirmation-confirm-btn');
      await expect(confirmButton).toBeVisible({ timeout: 10_000 });
      await confirmButton.click();

      await expectVfsContent(request, toolSession.id, MOCK_VFS_WRITE_PATH, MOCK_VFS_WRITE_CONTENT);

      await seedRaAppFixture(request, raappSession.id, 'e2e/raapp-manual.txt', 'raapp-manual-approved');
      await selectSession(page, raappSession.id, raappSession.title);

      const overlay = page.getByTestId('raapp-hitl-overlay');
      await expect(overlay).toBeVisible({ timeout: 10_000 });
      await page.getByTestId('raapp-hitl-approve').click();
      await expect(overlay).toHaveCount(0, { timeout: 10_000 });

      await expectVfsContent(request, raappSession.id, 'e2e/raapp-manual.txt', 'raapp-manual-approved');
    } finally {
      for (const sessionId of createdSessions) {
        await deleteSessionIfExists(request, sessionId);
      }
      await restoreHitlConfig(request, previousHitlConfig);
      await restoreActiveCredential(request, previousActiveCredentialId);
    }
  });

  test('bypass mode auto-executes tool confirmation and RA-App approval', async ({ page, request }) => {
    const previousHitlConfig = await getHitlConfig(request);
    const previousActiveCredentialId = await getActiveCredentialId(request);
    const createdSessions: string[] = [];

    try {
      await ensureEnvMockProvider(request);

      const toolSession = await createSession(request, uniqueName('HITL Tool Bypass'), 'designer');
      const raappSession = await createSession(request, uniqueName('HITL RAApp Bypass'), 'ra-apps');
      createdSessions.push(toolSession.id, raappSession.id);

      await saveHitlMode(page, 'bypass');
      await openTalk(page);

      await selectSession(page, toolSession.id, toolSession.title);
      await runMockVfsWriteTool(page);

      await expectVfsContent(request, toolSession.id, MOCK_VFS_WRITE_PATH, MOCK_VFS_WRITE_CONTENT);
      await expect(page.getByTestId('confirmation-confirm-btn')).toHaveCount(0);

      await seedRaAppFixture(request, raappSession.id, 'e2e/raapp-bypass.txt', 'raapp-bypass-approved');
      await selectSession(page, raappSession.id, raappSession.title);

      await expect(page.getByTestId('raapp-hitl-overlay')).toHaveCount(0);
      await expectVfsContent(request, raappSession.id, 'e2e/raapp-bypass.txt', 'raapp-bypass-approved');
    } finally {
      for (const sessionId of createdSessions) {
        await deleteSessionIfExists(request, sessionId);
      }
      await restoreHitlConfig(request, previousHitlConfig);
      await restoreActiveCredential(request, previousActiveCredentialId);
    }
  });
});