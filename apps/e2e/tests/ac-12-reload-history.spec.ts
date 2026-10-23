import { test, expect } from '@playwright/test';
import {
  API_BASE,
  expectComposerEnabled,
  selectSession,
  sendMessageFromComposer,
} from './helpers/test-config';
import { createExistingMockConversation } from './helpers/existing-mock-conversation';

// AC-12: Full conversation history survives page reload
test.describe('AC-12: History after reload', () => {
  test('conversation history restored after page reload', async ({ page, request }) => {
    const session = await createExistingMockConversation(request, 'AC12 Reload Test');

    await page.goto('/');
    await page.getByTestId('nav-talk').click();

    // Select the session
    await selectSession(page, session.id, 'AC12 Reload Test');

    await expectComposerEnabled(page, 5000);
    const baselineUsers = await page.getByTestId('message-bubble').count();
    const baselineTurns = await page.getByTestId('agent-turn-bubble').count();

    // Send first message and wait for response
    await sendMessageFromComposer(page, 'Say HELLO.');

    // Wait for response
    await expect(page.getByTestId('agent-turn-bubble')).toHaveCount(baselineTurns + 1, { timeout: 30_000 });
    await expect.poll(async () => (await request.get(`${API_BASE}/sessions/${session.id}/runs/current`)).text()).toBe('');
    await expectComposerEnabled(page, 30_000);

    // Send second message
    await sendMessageFromComposer(page, 'Say WORLD.');

    await expect(page.getByTestId('agent-turn-bubble')).toHaveCount(baselineTurns + 2, { timeout: 30_000 });
    await expect.poll(async () => (await request.get(`${API_BASE}/sessions/${session.id}/runs/current`)).text()).toBe('');
    await expectComposerEnabled(page, 30_000);

    // Count messages before reload
    const userMessagesBefore = await page.getByTestId('message-bubble').count();
    const agentTurnsBefore = await page.getByTestId('agent-turn-bubble').count();
    expect(userMessagesBefore).toBe(baselineUsers + 2);
    expect(agentTurnsBefore).toBe(baselineTurns + 2);
    const turnsBefore = await page.getByTestId('agent-turn-bubble').allTextContents();

    // Reload page
    await page.reload();
    await page.getByTestId('nav-talk').click();

    // Select same session
    await selectSession(page, session.id, 'AC12 Reload Test');

    await expect(page.getByTestId('message-bubble')).toHaveCount(userMessagesBefore);
    await expect(page.getByTestId('agent-turn-bubble')).toHaveCount(agentTurnsBefore);
    await expect.poll(() => page.getByTestId('agent-turn-bubble').allTextContents()).toEqual(turnsBefore);

    // Cleanup
    await request.delete(`${API_BASE}/sessions/${session.id}`);
  });
});
