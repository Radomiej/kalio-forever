import { test, expect } from '@playwright/test';
import {
  API_BASE,
  deleteSessionIfExists,
  expectComposerEnabled,
  getComposerSendButton,
  selectSession,
} from './helpers/test-config';
import { createExistingMockConversation } from './helpers/existing-mock-conversation';

// Diagnostic hold exposes queued follow-ups without relying on token timing.
const LONG_STREAMING_PROMPT = '[[mock:script]] hold(6000); return("Queue fixture stream completed") [[/mock:script]]';

// AC-13: Queue mode — composer stays enabled during streaming; extra sends queue instead of spamming active turn
test.describe('AC-13: Queue while streaming', () => {
  test('composer stays enabled while streaming and queues a second message', async ({ page, request }) => {
    const title = `AC13 Queue Test ${Date.now()}`;

    const session = await createExistingMockConversation(request, title);

    await page.goto('/');
    await page.getByTestId('nav-talk').click();
    await selectSession(page, session.id, title);
    const userMessages = page.locator('[data-testid="message-bubble"][data-role="user"]');
    const baselineUsers = await userMessages.count();
    const baselineTurns = await page.getByTestId('agent-turn-bubble').count();

    const chatInput = await expectComposerEnabled(page, 5000);
    const sendBtn = await getComposerSendButton(page);

    await chatInput.fill(LONG_STREAMING_PROMPT);
    await sendBtn.click();

    await expect(page.getByTestId('chat-stop-btn')).toBeVisible({ timeout: 5000 });
    const active = await (await request.get(`${API_BASE}/sessions/${session.id}/runs/current`)).json() as { turnId: string };
    expect(active.turnId).toBeTruthy();
    const streamingInput = await expectComposerEnabled(page, 5000);
    const streamingSendBtn = await getComposerSendButton(page);

    await streamingInput.fill('queued follow-up');
    await streamingSendBtn.click();

    await expect(userMessages).toHaveCount(baselineUsers + 2, { timeout: 10_000 });
    await expect(userMessages.last()).toContainText('queued follow-up');
    const stillActive = await (await request.get(`${API_BASE}/sessions/${session.id}/runs/current`)).json() as { turnId: string };
    expect(stillActive.turnId).toBe(active.turnId);
    await expect.poll(async () => (await request.get(`${API_BASE}/sessions/${session.id}/runs/current`)).text(), { timeout: 15_000 }).toBe('');
    await expect(page.getByTestId('agent-turn-bubble')).toHaveCount(baselineTurns + 2);
    await expect(page.getByTestId('chat-stop-btn')).toHaveCount(0);

    await deleteSessionIfExists(request, session.id);
  });

  test('rapid Enter key presses while streaming can queue additional user bubbles', async ({ page, request }) => {
    test.setTimeout(45_000);

    const title = `AC13 Rapid Enter Queue ${Date.now()}`;

    const session = await createExistingMockConversation(request, title);

    await page.goto('/');
    await page.getByTestId('nav-talk').click();
    await selectSession(page, session.id, title);
    const baselineUsers = await page.locator('[data-testid="message-bubble"][data-role="user"]').count();
    const baselineTurns = await page.getByTestId('agent-turn-bubble').count();

    const chatInput = await expectComposerEnabled(page, 5000);

    await chatInput.fill(LONG_STREAMING_PROMPT);
    await chatInput.press('Enter');

    await expect(page.getByTestId('chat-stop-btn')).toBeVisible({ timeout: 5000 });
    const streamingInput = await expectComposerEnabled(page, 5000);
    const userMessages = page.locator('[data-testid="message-bubble"][data-role="user"]');

    for (let i = 0; i < 3; i++) {
      await streamingInput.fill(`queued ${i + 1}`);
      await streamingInput.press('Enter');
      await expect(userMessages).toHaveCount(baselineUsers + i + 2, { timeout: 10_000 });
    }

    await expect(userMessages).toHaveCount(baselineUsers + 4, { timeout: 15_000 });
    await expect.poll(async () => (await request.get(`${API_BASE}/sessions/${session.id}/runs/current`)).text(), { timeout: 15_000 }).toBe('');
    await expect(page.getByTestId('agent-turn-bubble')).toHaveCount(baselineTurns + 4);
    await expect(page.getByTestId('chat-stop-btn')).toHaveCount(0);

    await deleteSessionIfExists(request, session.id);
  });
});
