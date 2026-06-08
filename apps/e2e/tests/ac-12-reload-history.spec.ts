import { test, expect } from '@playwright/test';
import {
  API_BASE,
  expectComposerEnabled,
  selectSession,
  sendMessageFromComposer,
} from './helpers/test-config';

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
    await selectSession(page, session.id, 'AC12 Reload Test');

    const chatInput = await expectComposerEnabled(page, 5000);

    // Send first message and wait for response
    await sendMessageFromComposer(page, 'Say HELLO.');

    // Wait for response
    await expect(page.getByTestId('agent-turn-bubble').first()).toBeVisible({ timeout: 30_000 });
    await expectComposerEnabled(page, 30_000);

    // Send second message
    await sendMessageFromComposer(page, 'Say WORLD.');

    await expect(page.getByTestId('agent-turn-bubble')).toHaveCount(2, { timeout: 30_000 });
    await expectComposerEnabled(page, 30_000);

    // Count messages before reload
    const userMessagesBefore = await page.getByTestId('message-bubble').count();
    const agentTurnsBefore = await page.getByTestId('agent-turn-bubble').count();
    expect(userMessagesBefore).toBe(2);
    expect(agentTurnsBefore).toBe(2);

    // Reload page
    await page.reload();
    await page.getByTestId('nav-talk').click();

    // Select same session
    await selectSession(page, session.id, 'AC12 Reload Test');

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
