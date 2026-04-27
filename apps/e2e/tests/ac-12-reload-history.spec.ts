import { test, expect } from '@playwright/test';
import { API_BASE } from './helpers/test-config';

// AC-12: Full conversation history survives page reload
test.describe('AC-12: History after reload', () => {
  test('conversation history restored after page reload', async ({ page, request }) => {
    // Pre-create session via API
    const res = await request.post(`${API_BASE}/sessions`, {
      data: { title: 'AC12 Reload Test', personaId: 'default' },
    });
    expect(res.ok()).toBeTruthy();
    const session = await res.json() as { id: string };

    await page.goto('/');
    await page.getByTestId('nav-talk').click();

    // Select the session
    await expect(
      page.getByTestId('session-item').filter({ hasText: 'AC12 Reload Test' }).first(),
    ).toBeVisible({ timeout: 5000 });
    await page.getByTestId('session-item').filter({ hasText: 'AC12 Reload Test' }).first().click();

    const chatInput = page.getByTestId('chat-input');
    await expect(chatInput).toBeEnabled({ timeout: 5000 });

    // Send first message and wait for response
    await chatInput.fill('Say HELLO.');
    await page.getByTestId('chat-send-btn').click();

    // Wait for response
    await expect(page.getByTestId('agent-turn-bubble').first()).toBeVisible({ timeout: 30_000 });
    await expect(chatInput).toBeEnabled({ timeout: 30_000 });

    // Send second message
    await chatInput.fill('Say WORLD.');
    await page.getByTestId('chat-send-btn').click();

    await expect(page.getByTestId('agent-turn-bubble')).toHaveCount(2, { timeout: 30_000 });
    await expect(chatInput).toBeEnabled({ timeout: 30_000 });

    // Count messages before reload
    const userMessagesBefore = await page.getByTestId('message-bubble').count();
    const agentTurnsBefore = await page.getByTestId('agent-turn-bubble').count();
    expect(userMessagesBefore).toBe(2);
    expect(agentTurnsBefore).toBe(2);

    // Reload page
    await page.reload();
    await page.getByTestId('nav-talk').click();

    // Select same session
    await expect(
      page.getByTestId('session-item').filter({ hasText: 'AC12 Reload Test' }).first(),
    ).toBeVisible({ timeout: 5000 });
    await page.getByTestId('session-item').filter({ hasText: 'AC12 Reload Test' }).first().click();

    // Wait for history to load
    await page.waitForTimeout(2000);

    // Verify history restored
    const userMessagesAfter = await page.getByTestId('message-bubble').count();
    const agentTurnsAfter = await page.getByTestId('agent-turn-bubble').count();
    expect(userMessagesAfter).toBe(2);
    expect(agentTurnsAfter).toBe(2);

    // Cleanup
    await request.delete(`${API_BASE}/sessions/${session.id}`);
  });
});
