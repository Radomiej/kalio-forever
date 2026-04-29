import { test, expect } from '@playwright/test';
import { API_BASE } from './helpers/test-config';

// AC-13: Anti-spam — input disabled during streaming, multiple clicks don't send extra messages
test.describe('AC-13: Anti-spam protection', () => {
  test('input disabled while streaming and multiple clicks blocked', async ({ page, request }) => {
    // Pre-create session via API
    const res = await request.post(`${API_BASE}/sessions`, {
      data: { title: 'AC13 Anti-Spam Test', personaId: 'default' },
    });
    expect(res.ok()).toBeTruthy();
    const session = await res.json() as { id: string };

    await page.goto('/');
    await page.getByTestId('nav-talk').click();

    // Select the session
    await expect(
      page.getByTestId('session-item').filter({ hasText: 'AC13 Anti-Spam Test' }).first(),
    ).toBeVisible({ timeout: 5000 });
    await page.getByTestId('session-item').filter({ hasText: 'AC13 Anti-Spam Test' }).first().click();

    const chatInput = page.getByTestId('chat-input');
    const sendBtn = page.getByTestId('chat-send-btn');

    await expect(chatInput).toBeEnabled({ timeout: 5000 });

    // Send first message
    await chatInput.fill('Say HELLO slowly.');
    await sendBtn.click();

    // Input should be disabled immediately
    await expect(chatInput).toBeDisabled({ timeout: 3000 });

    // Try clicking send button again while disabled — should not send second message
    await chatInput.fill('This should NOT be sent', { force: true });
    await sendBtn.click({ timeout: 1000 }).catch(() => { /* expected to be blocked */ });

    // Wait for first response to complete
    await expect(chatInput).toBeEnabled({ timeout: 30_000 });

    // Verify only one user message was sent
    const userMessages = page.getByTestId('message-bubble');
    await expect(userMessages).toHaveCount(1, { timeout: 5000 });

    // Verify one agent turn appeared
    const agentTurns = page.getByTestId('agent-turn-bubble');
    await expect(agentTurns.first()).toBeVisible({ timeout: 5000 });

    // Cleanup
    await request.delete(`${API_BASE}/sessions/${session.id}`);
  });

  test('rapid Enter key presses while streaming only send one message', async ({ page, request }) => {
    const res = await request.post(`${API_BASE}/sessions`, {
      data: { title: 'AC13 Rapid Enter Test', personaId: 'default' },
    });
    expect(res.ok()).toBeTruthy();
    const session = await res.json() as { id: string };

    await page.goto('/');
    await page.getByTestId('nav-talk').click();

    await expect(
      page.getByTestId('session-item').filter({ hasText: 'AC13 Rapid Enter Test' }).first(),
    ).toBeVisible({ timeout: 5000 });
    await page.getByTestId('session-item').filter({ hasText: 'AC13 Rapid Enter Test' }).first().click();

    const chatInput = page.getByTestId('chat-input');
    await expect(chatInput).toBeEnabled({ timeout: 5000 });

    await chatInput.fill('Count to 5 slowly.');
    await chatInput.press('Enter');

    // Spam Enter while streaming
    for (let i = 0; i < 5; i++) {
      await page.waitForTimeout(200);
      await chatInput.press('Enter').catch(() => { /* expected blocked */ });
    }

    // Wait for completion
    await expect(chatInput).toBeEnabled({ timeout: 30_000 });

    // Only one user message
    const userMessages = page.getByTestId('message-bubble');
    await expect(userMessages).toHaveCount(1, { timeout: 5000 });

    // Cleanup
    await request.delete(`${API_BASE}/sessions/${session.id}`);
  });
});
