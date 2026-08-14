import { test, expect, type Page } from '@playwright/test';
import {
  API_BASE,
  deleteSessionIfExists,
  expectComposerEnabled,
  getComposerSendButton,
  selectSession,
} from './helpers/test-config';

const STOPPABLE_STREAM_PROMPT = [
  'Start a controlled stoppable mock stream.',
  '[[mock:script]]',
  'hold(8000) return("controlled stop stream finished")',
  '[[/mock:script]]',
].join('\n');

async function clickStopButton(page: Page): Promise<void> {
  await expect
    .poll(async () => {
      const stopBtn = page.getByTestId('chat-stop-btn');
      if (!await stopBtn.isVisible().catch(() => false)) {
        return 'missing';
      }
      try {
        await stopBtn.click({ force: true, timeout: 1_000 });
        return 'clicked';
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (/detached|not attached|Timeout .*chat-stop-btn|waiting for getByTestId\('chat-stop-btn'\)/i.test(message)) {
          return 'retry';
        }
        throw error;
      }
    }, { timeout: 10_000 })
    .toBe('clicked');
}

test.describe('REGRESSION: stop and follow-up runtime flow', () => {
  test('stop drains the active turn so a follow-up starts fresh instead of queueing', async ({ page, request }) => {
    test.setTimeout(60_000);

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

    await chatInput.fill(STOPPABLE_STREAM_PROMPT);
    await sendBtn.click();

    const stopBtn = page.getByTestId('chat-stop-btn');
    await expect(stopBtn).toBeVisible({ timeout: 5_000 });
    await clickStopButton(page);
    await expect(stopBtn).toBeHidden({ timeout: 10_000 });

    const followUpInput = await expectComposerEnabled(page, 5_000);
    const followUpSendBtn = await getComposerSendButton(page);

    await followUpInput.fill(`${STOPPABLE_STREAM_PROMPT}\nafter stop`);
    await followUpSendBtn.click();

    await expect(stopBtn).toBeVisible({ timeout: 5_000 });
    await expect(page.locator('[data-testid="message-bubble"][data-role="user"]')).toHaveCount(2, { timeout: 10_000 });
    await expect(page.getByTestId('chat-queued-badge')).toHaveCount(0);

    await deleteSessionIfExists(request, session.id);
  });
});
