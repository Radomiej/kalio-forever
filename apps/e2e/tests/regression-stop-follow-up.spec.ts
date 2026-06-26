import { test, expect } from '@playwright/test';
import {
  API_BASE,
  deleteSessionIfExists,
  expectComposerEnabled,
  getComposerSendButton,
  selectSession,
} from './helpers/test-config';

const LONG_STREAMING_PROMPT = `Repeat this text slowly: ${'HELLO '.repeat(120).trim()}`;

test.describe('REGRESSION: stop and follow-up runtime flow', () => {
  test('stop drains the active turn so a follow-up starts fresh instead of queueing', async ({ page, request }) => {
    test.setTimeout(45_000);

    const title = `Stop follow-up ${Date.now()}`;

    const res = await request.post(`${API_BASE}/sessions`, {
      data: { title, personaId: 'default' },
    });
    expect(res.ok()).toBeTruthy();
    const session = await res.json() as { id: string };

    await page.goto('/');
    await page.getByTestId('nav-talk').click();
    await selectSession(page, session.id, title);

    const chatInput = await expectComposerEnabled(page, 5_000);
    const sendBtn = await getComposerSendButton(page);

    await chatInput.fill(LONG_STREAMING_PROMPT);
    await sendBtn.click();

    const stopBtn = page.getByTestId('chat-stop-btn');
    await expect(stopBtn).toBeVisible({ timeout: 5_000 });
    await stopBtn.click();
    await expect(stopBtn).toBeHidden({ timeout: 10_000 });

    const followUpInput = await expectComposerEnabled(page, 5_000);
    const followUpSendBtn = await getComposerSendButton(page);

    await followUpInput.fill(`${LONG_STREAMING_PROMPT} after stop`);
    await followUpSendBtn.click();

    await expect(stopBtn).toBeVisible({ timeout: 5_000 });
    await expect(page.locator('[data-testid="message-bubble"][data-role="user"]')).toHaveCount(2, { timeout: 10_000 });
    await expect(page.getByTestId('chat-queued-badge')).toHaveCount(0);

    await deleteSessionIfExists(request, session.id);
  });
});
