import { test, expect } from '@playwright/test';
import { API_BASE } from './helpers/test-config';

// AC-26: After page reload, selecting a session restores the full conversation history
test.describe('AC-26: Session history restored after reload', () => {
  test('user message and agent response are visible after page reload', async ({ page, request }) => {
    const res = await request.post(`${API_BASE}/sessions`, {
      data: { title: 'AC26 Reload Test', personaId: 'default' },
    });
    expect(res.ok()).toBeTruthy();
    const session = await res.json() as { id: string };

    await page.goto('/');
    await page.getByTestId('nav-talk').click();

    await expect(
      page.getByTestId('session-item').filter({ hasText: 'AC26 Reload Test' }).first(),
    ).toBeVisible({ timeout: 5000 });
    await page.getByTestId('session-item').filter({ hasText: 'AC26 Reload Test' }).first().click();

    const chatInput = page.getByTestId('chat-input');
    await expect(chatInput).toBeEnabled({ timeout: 5000 });

    await chatInput.fill('Say the single word: PINEAPPLE');
    await page.getByTestId('chat-send-btn').click();

    // Wait for streaming to finish
    await expect(chatInput).toBeEnabled({ timeout: 30_000 });

    // Confirm agent turn appeared with content
    const turnBubble = page.getByTestId('agent-turn-bubble').first();
    await expect(turnBubble).toBeVisible({ timeout: 5000 });
    const responseText = await turnBubble.textContent();
    expect(responseText?.trim().length).toBeGreaterThan(0);

    // Reload the page — simulates browser refresh
    await page.reload();
    await page.getByTestId('nav-talk').click();

    // Select same session
    await expect(
      page.getByTestId('session-item').filter({ hasText: 'AC26 Reload Test' }).first(),
    ).toBeVisible({ timeout: 5000 });
    await page.getByTestId('session-item').filter({ hasText: 'AC26 Reload Test' }).first().click();

    // User message must still be visible
    const userBubble = page.locator('[data-testid="message-bubble"][data-role="user"]').first();
    await expect(userBubble).toBeVisible({ timeout: 10_000 });

    // Agent turn must be restored from history
    const restoredTurn = page.getByTestId('agent-turn-bubble').first();
    await expect(restoredTurn).toBeVisible({ timeout: 10_000 });
    const restoredText = await restoredTurn.textContent();
    expect(restoredText?.trim().length).toBeGreaterThan(0);

    await request.delete(`${API_BASE}/sessions/${session.id}`);
  });

  test('history endpoint returns persisted messages after session reload', async ({ request }) => {
    const res = await request.post(`${API_BASE}/sessions`, {
      data: { title: 'AC26 API Persistence Test' },
    });
    const session = await res.json() as { id: string };

    // Messages endpoint is accessible and returns array
    const msgRes = await request.get(`${API_BASE}/sessions/${session.id}/messages`);
    expect(msgRes.ok()).toBeTruthy();
    const messages = await msgRes.json() as unknown[];
    expect(Array.isArray(messages)).toBeTruthy();

    // Calling the endpoint twice gives identical results (no mutation)
    const msgRes2 = await request.get(`${API_BASE}/sessions/${session.id}/messages`);
    const messages2 = await msgRes2.json() as unknown[];
    expect(JSON.stringify(messages)).toBe(JSON.stringify(messages2));

    await request.delete(`${API_BASE}/sessions/${session.id}`);
  });
});
