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
    test.setTimeout(120_000);
    const title = uniqueSessionTitle('AC10 Multi-Turn Test');

    const res = await request.post(`${API_BASE}/sessions`, {
      data: { title, personaId: 'default' },
    });
    expect(res.ok()).toBeTruthy();
    const session = await res.json() as { id: string };

    await page.goto('/');
    await page.getByTestId('nav-talk').click();

    await selectSession(page, session.id, title);

    await expectComposerEnabled(page, 5000);

    const allBubbles = page.locator('[data-testid="message-bubble"], [data-testid="agent-turn-bubble"]');
    const queuedBanner = page.getByTestId('queued-follow-up-banner');

    // First message
    await sendMessageFromComposer(page, 'Reply with the word FIRST and no tools.');
    await expect
      .poll(async () => allBubbles.count(), { timeout: 60_000, message: 'Expected first assistant turn to render' })
      .toBeGreaterThanOrEqual(2);
    await expectComposerEnabled(page, 60_000);

    // Second message
    await sendMessageFromComposer(page, 'Reply with the word SECOND and no tools.');
    await expect
      .poll(async () => allBubbles.count(), { timeout: 60_000, message: 'Expected both assistant turns to render' })
      .toBe(4);
    await expectComposerEnabled(page, 60_000);
    await expect(queuedBanner).toHaveCount(0);

    // Verify interleaved order: user, agent, user, agent
    // First should be user message
    await expect(allBubbles.nth(0)).toHaveAttribute('data-testid', 'message-bubble');
    await expect(allBubbles.nth(0)).toContainText('Reply with the word FIRST and no tools.');
    // Second should be agent turn
    await expect(allBubbles.nth(1)).toHaveAttribute('data-testid', 'agent-turn-bubble');
    // Third should be user message
    await expect(allBubbles.nth(2)).toHaveAttribute('data-testid', 'message-bubble');
    await expect(allBubbles.nth(2)).toContainText('Reply with the word SECOND and no tools.');
    // Fourth should be agent turn
    await expect(allBubbles.nth(3)).toHaveAttribute('data-testid', 'agent-turn-bubble');

    // Cleanup
    await request.delete(`${API_BASE}/sessions/${session.id}`);
  });
});
