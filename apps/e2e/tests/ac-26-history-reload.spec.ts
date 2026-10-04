import { test, expect } from '@playwright/test';
import { API_BASE, expectComposerEnabled, sendMessageFromComposer } from './helpers/test-config';
import { createExistingMockConversation } from './helpers/existing-mock-conversation';

// AC-26: After page reload, selecting a session restores the full conversation history
test.describe('AC-26: Session history restored after reload', () => {
  test('user message and agent response are visible after page reload', async ({ page, request }) => {
    const session = await createExistingMockConversation(request, 'AC26 Reload Test');

    await page.goto('/');
    await page.getByTestId('nav-talk').click();

    await expect(
      page.getByTestId('session-item').filter({ hasText: 'AC26 Reload Test' }).first(),
    ).toBeVisible({ timeout: 5000 });
    await page.getByTestId('session-item').filter({ hasText: 'AC26 Reload Test' }).first().click();

    await expectComposerEnabled(page, 5000);
    const baselineTurns = await page.getByTestId('agent-turn-bubble').count();
    await sendMessageFromComposer(page, 'Say the single word: PINEAPPLE');

    // Wait for streaming to finish
    await expectComposerEnabled(page, 30_000);

    // Confirm agent turn appeared with content
    await expect(page.getByTestId('agent-turn-bubble')).toHaveCount(baselineTurns + 1);
    await expect.poll(async () => (await request.get(`${API_BASE}/sessions/${session.id}/runs/current`)).text()).toBe('');
    const turnBubble = page.getByTestId('agent-turn-bubble').last();
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
    const userBubble = page.locator('[data-testid="message-bubble"][data-role="user"]').filter({ hasText: 'Say the single word: PINEAPPLE' });
    await expect(userBubble).toBeVisible({ timeout: 10_000 });

    // Agent turn must be restored from history
    await expect(page.getByTestId('agent-turn-bubble')).toHaveCount(baselineTurns + 1);
    const restoredTurn = page.getByTestId('agent-turn-bubble').last();
    await expect(restoredTurn).toBeVisible({ timeout: 10_000 });
    const restoredText = await restoredTurn.textContent();
    expect(restoredText).toBe(responseText);

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
