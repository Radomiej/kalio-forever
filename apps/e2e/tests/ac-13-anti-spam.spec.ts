import { test, expect } from '@playwright/test';
import { API_BASE, isMockLlm } from './helpers/test-config';

const LONG_STREAMING_PROMPT = `Repeat this text slowly: ${'HELLO '.repeat(120).trim()}`;

// AC-13: Anti-spam — input disabled during streaming, multiple clicks don't send extra messages
test.describe('AC-13: Anti-spam protection', () => {
  test('input disabled while streaming and multiple clicks blocked', async ({ page, request }) => {
    test.skip(await isMockLlm(request), 'Mock LLM does not keep the disabled-state window stable enough for this click-blocking UX assertion.');

    const title = `AC13 Anti-Spam Test ${Date.now()}`;

    // Pre-create session via API
    const res = await request.post(`${API_BASE}/sessions`, {
      data: { title, personaId: 'default' },
    });
    expect(res.ok()).toBeTruthy();
    const session = await res.json() as { id: string };

    await page.goto('/');
    await page.getByTestId('nav-talk').click();

    // Select the session
    await expect(
      page.getByTestId('session-item').filter({ hasText: title }).first(),
    ).toBeVisible({ timeout: 5000 });
    await page.getByTestId('session-item').filter({ hasText: title }).first().click();

    const chatInput = page.getByTestId('chat-input');
    const sendBtn = page.getByTestId('chat-send-btn');

    await expect(chatInput).toBeEnabled({ timeout: 5000 });

    // Send first message
    await chatInput.fill(LONG_STREAMING_PROMPT);
    await sendBtn.click();

    // Streaming should flip the composer into stop-mode immediately.
    await expect(page.getByTestId('chat-stop-btn')).toBeVisible({ timeout: 5000 });

    // Try clicking send button again while disabled — should not send second message
    await chatInput.fill('This should NOT be sent', { force: true });
    await sendBtn.click({ timeout: 1000 }).catch(() => { /* expected to be blocked */ });

    // Wait for first response to complete
    await expect(chatInput).toBeEnabled({ timeout: 30_000 });

    // Verify only one user message was sent
    const userMessages = page.locator('[data-testid="message-bubble"][data-role="user"]');
    await expect(userMessages).toHaveCount(1, { timeout: 5000 });

    // Verify one agent turn appeared
    const agentTurns = page.getByTestId('agent-turn-bubble');
    await expect(agentTurns.first()).toBeVisible({ timeout: 5000 });

    // Cleanup
    await request.delete(`${API_BASE}/sessions/${session.id}`);
  });

  test('rapid Enter key presses while streaming only send one message', async ({ page, request }) => {
    test.setTimeout(45_000);

    const title = `AC13 Rapid Enter Test ${Date.now()}`;

    const res = await request.post(`${API_BASE}/sessions`, {
      data: { title, personaId: 'default' },
    });
    expect(res.ok()).toBeTruthy();
    const session = await res.json() as { id: string };

    await page.goto('/');
    await page.getByTestId('nav-talk').click();

    await expect(
      page.getByTestId('session-item').filter({ hasText: title }).first(),
    ).toBeVisible({ timeout: 5000 });
    await page.getByTestId('session-item').filter({ hasText: title }).first().click();

    const chatInput = page.getByTestId('chat-input');
    await expect(chatInput).toBeEnabled({ timeout: 5000 });

    await chatInput.fill(LONG_STREAMING_PROMPT);
    await chatInput.press('Enter');

    // Spam Enter while streaming
    for (let i = 0; i < 5; i++) {
      await page.waitForTimeout(200);
      await chatInput.press('Enter').catch(() => { /* expected blocked */ });
    }

    // Wait for completion
    await expect(chatInput).toBeEnabled({ timeout: 30_000 });

    // Only one user message
    const userMessages = page.locator('[data-testid="message-bubble"][data-role="user"]');
    await expect(userMessages).toHaveCount(1, { timeout: 5000 });

    // Cleanup
    await request.delete(`${API_BASE}/sessions/${session.id}`);
  });
});
