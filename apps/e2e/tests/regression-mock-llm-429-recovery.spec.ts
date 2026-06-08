import { test, expect } from '@playwright/test';
import {
  API_BASE,
  deleteSessionIfExists,
  expectComposerEnabled,
  selectSession,
  sendMessageFromComposer,
} from './helpers/test-config';

function uniqueSessionTitle(prefix: string): string {
  return `${prefix} ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

test.describe('REGRESSION: mock LLM 429 recovery', () => {
  test('UI recovers cleanly after a deterministic mock-provider 429 error', async ({ page, request }) => {
    const previousActiveResponse = await request.get(`${API_BASE}/credentials/active`);
    const previousActive = await previousActiveResponse.json() as { credentialId?: string | null };

    const credentialResponse = await request.post(`${API_BASE}/credentials`, {
      data: {
        name: 'E2E Mock 429',
        provider: 'mock',
        apiKey: 'mock',
        model: 'mock',
      },
    });
    expect(credentialResponse.ok()).toBeTruthy();
    const credential = await credentialResponse.json() as { id: string };

    const title = uniqueSessionTitle('Mock 429 Recovery');
    const sessionResponse = await request.post(`${API_BASE}/sessions`, {
      data: { title, personaId: 'default' },
    });
    expect(sessionResponse.ok()).toBeTruthy();
    const session = await sessionResponse.json() as { id: string };

    try {
      const activateResponse = await request.put(`${API_BASE}/credentials/active/${credential.id}`);
      expect(activateResponse.ok()).toBeTruthy();

      await page.goto('/');
      await page.getByTestId('nav-talk').click();
      await selectSession(page, session.id, title);

      const chatInput = await expectComposerEnabled(page, 5000);
      await sendMessageFromComposer(page, 'Please fail with a deterministic mock provider 429 [[mock:error:429]]');

      await expect(page.getByTestId('chat-error')).toBeVisible({ timeout: 10_000 });
      await expect(page.getByTestId('chat-error')).toContainText(/429|Too Many Requests|quota exhausted/i);
      await expectComposerEnabled(page, 10_000);
      await expect(page.getByTestId('active-tab-pending-dot')).toHaveCount(0);

      await page.getByTestId('talk-tab-agents').click();
      await expect(page.getByText('No active agent runs.')).toBeVisible({ timeout: 10_000 });
    } finally {
      await deleteSessionIfExists(request, session.id);
      if (previousActive.credentialId) {
        await request.put(`${API_BASE}/credentials/active/${previousActive.credentialId}`);
      } else {
        await request.delete(`${API_BASE}/credentials/active`);
      }
      await request.delete(`${API_BASE}/credentials/${credential.id}`);
    }
  });
});
