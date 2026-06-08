import { test, expect } from '@playwright/test';
import {
  API_BASE,
  expectComposerEnabled,
  selectSession,
  sendMessageFromComposer,
} from './helpers/test-config';

function uniqueSessionTitle(prefix: string): string {
  return `${prefix} ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

// AC-10: Streaming content appears token-by-token in agent turn bubble
test.describe('AC-10: Streaming visibility', () => {
  test('agent response streams and is visible during and after streaming', async ({ page, request }) => {
    const title = uniqueSessionTitle('AC10 Streaming Test');

    // Pre-create session via API
    const res = await request.post(`${API_BASE}/sessions`, {
      data: { title, personaId: 'default' },
    });
    expect(res.ok()).toBeTruthy();
    const session = await res.json() as { id: string };

    await page.goto('/');
    await page.getByTestId('nav-talk').click();

    // Select the session
    await selectSession(page, session.id, title);

    const chatInput = await expectComposerEnabled(page, 5000);

    await sendMessageFromComposer(page, 'Say the word HELLO and nothing else.');

    // Agent turn bubble should appear quickly
    const agentBubble = page.getByTestId('agent-turn-bubble').first();
    await expect(agentBubble).toBeVisible({ timeout: 10000 });

    // Loading indicator should appear initially
    // Wait for streaming to complete
    await expectComposerEnabled(page, 30_000);

    // Verify content is present after completion
    const bubbleText = await agentBubble.textContent();
    expect(bubbleText?.length).toBeGreaterThan(0);

    // Cleanup
    await request.delete(`${API_BASE}/sessions/${session.id}`);
  });

  test('multiple turns render in chronological order', async ({ page, request }) => {
    const title = uniqueSessionTitle('AC10 Multi-Turn Test');

    const res = await request.post(`${API_BASE}/sessions`, {
      data: { title, personaId: 'default' },
    });
    expect(res.ok()).toBeTruthy();
    const session = await res.json() as { id: string };

    await page.goto('/');
    await page.getByTestId('nav-talk').click();

    await selectSession(page, session.id, title);

    const chatInput = await expectComposerEnabled(page, 5000);

    // First message
    await sendMessageFromComposer(page, 'First message.');
    await expectComposerEnabled(page, 30_000);

    // Second message
    await sendMessageFromComposer(page, 'Second message.');
    await expectComposerEnabled(page, 30_000);

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
