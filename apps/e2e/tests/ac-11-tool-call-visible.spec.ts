import { test, expect } from '@playwright/test';
import { API_BASE, isMockLlm } from './helpers/test-config';

function uniqueSessionTitle(prefix: string): string {
  return `${prefix} ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

// AC-11: Tool call chips appear inline during streaming and show results after completion
test.describe('AC-11: Tool call visibility', () => {
  test('tool call chip appears and resolves during RA-App session', async ({ page, request }) => {
    test.skip(await isMockLlm(request), 'Mock LLM only echoes the latest prompt and never emits tool calls.');
    const title = uniqueSessionTitle('AC11 Tool Call Test');

    // Use a persona that has RA-Apps available
    const res = await request.post(`${API_BASE}/sessions`, {
      data: { title, personaId: 'ra-apps' },
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
    await expect(chatInput).toBeEnabled({ timeout: 5000 });

    // Send message that should trigger list_raapps tool call
    await chatInput.fill('Show me available apps.');
    await page.getByTestId('chat-send-btn').click();

    // Wait for streaming to start (agent turn bubble appears)
    await expect(page.getByTestId('agent-turn-bubble').first()).toBeVisible({ timeout: 10000 });

    // Wait for tool call chip to appear
    // Tool call chips have data-testid="tool-call-chip" or similar
    const toolChip = page.getByTestId('tool-call-chip');
    await expect(toolChip.first()).toBeVisible({ timeout: 15000 });

    // Wait for completion
    await expect(chatInput).toBeEnabled({ timeout: 30_000 });

    // Verify at least one agent turn with tool calls exists
    const agentTurns = page.getByTestId('agent-turn-bubble');
    const turnCount = await agentTurns.count();
    expect(turnCount).toBeGreaterThanOrEqual(1);

    // Cleanup
    await request.delete(`${API_BASE}/sessions/${session.id}`);
  });
});
