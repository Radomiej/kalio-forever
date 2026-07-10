import { test, expect } from '@playwright/test';
import {
  API_BASE,
  deleteSessionIfExists,
  expectComposerEnabled,
  getComposerSendButton,
  selectSession,
} from './helpers/test-config';

const LONG_STREAMING_PROMPT = `Repeat this text slowly: ${'HELLO '.repeat(120).trim()}`;

// AC-13: Queue mode — composer stays enabled during streaming; extra sends queue instead of spamming active turn
test.describe('AC-13: Queue while streaming', () => {
  test('composer stays enabled while streaming and queues a second message', async ({ page, request }) => {
    const title = `AC13 Queue Test ${Date.now()}`;

    const res = await request.post(`${API_BASE}/sessions`, {
      data: { title, personaId: 'default' },
    });
    expect(res.ok()).toBeTruthy();
    const session = await res.json() as { id: string };

    await page.goto('/');
    await page.getByTestId('nav-talk').click();
    await selectSession(page, session.id, title);

    const chatInput = await expectComposerEnabled(page, 5000);
    const sendBtn = await getComposerSendButton(page);

    await chatInput.fill(LONG_STREAMING_PROMPT);
    await sendBtn.click();

    await expect(page.getByTestId('chat-stop-btn')).toBeVisible({ timeout: 5000 });
    const streamingInput = await expectComposerEnabled(page, 5000);
    const streamingSendBtn = await getComposerSendButton(page);

    await streamingInput.fill('queued follow-up');
    await streamingSendBtn.click();

    const userMessages = page.locator('[data-testid="message-bubble"][data-role="user"]');
    await expect(userMessages).toHaveCount(2, { timeout: 10_000 });
    await expect(userMessages.nth(1)).toContainText('queued follow-up');

    await deleteSessionIfExists(request, session.id);
  });

  test('rapid Enter key presses while streaming can queue additional user bubbles', async ({ page, request }) => {
    test.setTimeout(45_000);

    const title = `AC13 Rapid Enter Queue ${Date.now()}`;

    const res = await request.post(`${API_BASE}/sessions`, {
      data: { title, personaId: 'default' },
    });
    expect(res.ok()).toBeTruthy();
    const session = await res.json() as { id: string };

    await page.goto('/');
    await page.getByTestId('nav-talk').click();
    await selectSession(page, session.id, title);

    const chatInput = await expectComposerEnabled(page, 5000);

    await chatInput.fill(LONG_STREAMING_PROMPT);
    await chatInput.press('Enter');

    await expect(page.getByTestId('chat-stop-btn')).toBeVisible({ timeout: 5000 });
    const streamingInput = await expectComposerEnabled(page, 5000);
    const userMessages = page.locator('[data-testid="message-bubble"][data-role="user"]');

    for (let i = 0; i < 3; i++) {
      await streamingInput.fill(`queued ${i + 1}`);
      await streamingInput.press('Enter');
      await expect(userMessages).toHaveCount(i + 2, { timeout: 10_000 });
    }

    await expect(userMessages).toHaveCount(4, { timeout: 15_000 });

    await deleteSessionIfExists(request, session.id);
  });
});
