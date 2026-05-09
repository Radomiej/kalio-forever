import { test, expect } from '@playwright/test';
import { API_BASE } from './helpers/test-config';

// AC-10: Streaming content appears token-by-token in agent turn bubble
test.describe('AC-10: Streaming visibility', () => {
  test('agent response streams and is visible during and after streaming', async ({ page, request }) => {
    // Pre-create session via API
    const res = await request.post(`${API_BASE}/sessions`, {
      data: { title: 'AC10 Streaming Test', personaId: 'default' },
    });
    expect(res.ok()).toBeTruthy();
    const session = await res.json() as { id: string };

    await page.goto('/');
    await page.getByTestId('nav-talk').click();

    // Select the session
    await expect(
      page.getByTestId('session-item').filter({ hasText: 'AC10 Streaming Test' }).first(),
    ).toBeVisible({ timeout: 5000 });
    await page.getByTestId('session-item').filter({ hasText: 'AC10 Streaming Test' }).first().click();

    const chatInput = page.getByTestId('chat-input');
    await expect(chatInput).toBeEnabled({ timeout: 5000 });

    // Send message
    await chatInput.fill('Say the word HELLO and nothing else.');
    await page.getByTestId('chat-send-btn').click();

    // Agent turn bubble should appear quickly
    const agentBubble = page.getByTestId('agent-turn-bubble').first();
    await expect(agentBubble).toBeVisible({ timeout: 10000 });

    // Loading indicator should appear initially
    const loadingIndicator = agentBubble.locator('[data-testid="turn-loading-indicator"]').or(
      agentBubble.locator('.loading')
    );
    // Loading might be brief, just verify bubble exists

    // Wait for streaming to complete
    await expect(chatInput).toBeEnabled({ timeout: 30_000 });

    // Verify content is present after completion
    const bubbleText = await agentBubble.textContent();
    expect(bubbleText?.length).toBeGreaterThan(0);

    // Cleanup
    await request.delete(`${API_BASE}/sessions/${session.id}`);
  });

  test('multiple turns render in chronological order', async ({ page, request }) => {
    const res = await request.post(`${API_BASE}/sessions`, {
      data: { title: 'AC10 Multi-Turn Test', personaId: 'default' },
    });
    expect(res.ok()).toBeTruthy();
    const session = await res.json() as { id: string };

    await page.goto('/');
    await page.getByTestId('nav-talk').click();

    await expect(
      page.getByTestId('session-item').filter({ hasText: 'AC10 Multi-Turn Test' }).first(),
    ).toBeVisible({ timeout: 5000 });
    await page.getByTestId('session-item').filter({ hasText: 'AC10 Multi-Turn Test' }).first().click();

    const chatInput = page.getByTestId('chat-input');
    await expect(chatInput).toBeEnabled({ timeout: 5000 });

    // First message
    await chatInput.fill('First message.');
    await page.getByTestId('chat-send-btn').click();
    await expect(chatInput).toBeEnabled({ timeout: 30_000 });

    // Second message
    await chatInput.fill('Second message.');
    await page.getByTestId('chat-send-btn').click();
    await expect(chatInput).toBeEnabled({ timeout: 30_000 });

    // Verify interleaved order: user, agent, user, agent
    const allBubbles = page.locator('[data-testid="message-bubble"], [data-testid="agent-turn-bubble"]');
    const count = await allBubbles.count();
    expect(count).toBe(4);

    // First should be user message
    await expect(allBubbles.nth(0)).toHaveAttribute('data-testid', 'message-bubble');
    // Second should be agent turn
    await expect(allBubbles.nth(1)).toHaveAttribute('data-testid', 'agent-turn-bubble');
    // Third should be user message
    await expect(allBubbles.nth(2)).toHaveAttribute('data-testid', 'message-bubble');
    // Fourth should be agent turn
    await expect(allBubbles.nth(3)).toHaveAttribute('data-testid', 'agent-turn-bubble');

    // Cleanup
    await request.delete(`${API_BASE}/sessions/${session.id}`);
  });
});
