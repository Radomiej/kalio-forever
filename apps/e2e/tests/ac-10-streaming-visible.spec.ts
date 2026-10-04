import { test, expect } from '@playwright/test';
import {
  API_BASE,
  expectComposerEnabled,
  selectSession,
  sendMessageFromComposer,
} from './helpers/test-config';
import { createExistingMockConversation } from './helpers/existing-mock-conversation';

function uniqueSessionTitle(prefix: string): string {
  return `${prefix} ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

// AC-10: Streaming content appears token-by-token in agent turn bubble
test.describe('AC-10: Streaming visibility', () => {
  test('agent response streams and is visible during and after streaming', async ({ page, request }) => {
    test.setTimeout(90_000);
    const title = uniqueSessionTitle('AC10 Streaming Test');

    const session = await createExistingMockConversation(request, title);

    await page.goto('/');
    await page.getByTestId('nav-talk').click();

    // Select the session
    await selectSession(page, session.id, title);

    await expectComposerEnabled(page, 5000);
    const bubbles = page.getByTestId('agent-turn-bubble');
    const baseline = await bubbles.count();
    const marker = `AC10_STREAM_${Date.now()}`;
    // Diagnostic hold exposes an intermediate chunk; it does not stabilize runtime.
    await sendMessageFromComposer(page, `[[mock:script]] return("${marker} started"); hold(2000); return(" finished") [[/mock:script]]`);
    await expect(bubbles).toHaveCount(baseline + 1);
    const agentBubble = bubbles.last();
    await expect(agentBubble).toContainText(`${marker} started`);
    await expect(page.getByTestId('chat-stop-btn')).toBeVisible();
    await expect(agentBubble).not.toContainText('finished');
    await expect(agentBubble).toContainText(`${marker} started finished`, { timeout: 10_000 });
    await expect(page.getByTestId('chat-stop-btn')).toHaveCount(0);
    await expect.poll(async () => (await request.get(`${API_BASE}/sessions/${session.id}/runs/current`)).text()).toBe('');
    const stored = await request.get(`${API_BASE}/sessions/${session.id}/messages`);
    expect(stored.ok()).toBeTruthy();
    const messages = await stored.json() as Array<{ role: string; content: string }>;
    expect(messages.filter(message => message.role === 'assistant').at(-1)?.content).toBe(`${marker} started finished`);

    // Cleanup
    await request.delete(`${API_BASE}/sessions/${session.id}`);
  });

  test('multiple turns render in chronological order', async ({ page, request }) => {
    test.setTimeout(120_000);
    const title = uniqueSessionTitle('AC10 Multi-Turn Test');

    const session = await createExistingMockConversation(request, title);

    await page.goto('/');
    await page.getByTestId('nav-talk').click();

    await selectSession(page, session.id, title);

    await expectComposerEnabled(page, 5000);

    const allBubbles = page.locator('[data-testid="message-bubble"], [data-testid="agent-turn-bubble"]');
    const baseline = await allBubbles.count();
    const queuedBanner = page.getByTestId('queued-follow-up-banner');

    // First message
    await sendMessageFromComposer(page, 'Reply with the word FIRST and no tools.');
    await expect
      .poll(async () => allBubbles.count(), { timeout: 60_000, message: 'Expected first assistant turn to render' })
      .toBe(baseline + 2);
    await expect.poll(async () => (await request.get(`${API_BASE}/sessions/${session.id}/runs/current`)).text()).toBe('');
    await expectComposerEnabled(page, 60_000);

    // Second message
    await sendMessageFromComposer(page, 'Reply with the word SECOND and no tools.');
    await expect
      .poll(async () => allBubbles.count(), { timeout: 60_000, message: 'Expected both assistant turns to render' })
      .toBe(baseline + 4);
    await expect.poll(async () => (await request.get(`${API_BASE}/sessions/${session.id}/runs/current`)).text()).toBe('');
    await expectComposerEnabled(page, 60_000);
    await expect(queuedBanner).toHaveCount(0);

    // Verify interleaved order: user, agent, user, agent
    // First should be user message
    await expect(allBubbles.nth(baseline)).toHaveAttribute('data-testid', 'message-bubble');
    await expect(allBubbles.nth(baseline)).toContainText('Reply with the word FIRST and no tools.');
    // Second should be agent turn
    await expect(allBubbles.nth(baseline + 1)).toHaveAttribute('data-testid', 'agent-turn-bubble');
    // Third should be user message
    await expect(allBubbles.nth(baseline + 2)).toHaveAttribute('data-testid', 'message-bubble');
    await expect(allBubbles.nth(baseline + 2)).toContainText('Reply with the word SECOND and no tools.');
    // Fourth should be agent turn
    await expect(allBubbles.nth(baseline + 3)).toHaveAttribute('data-testid', 'agent-turn-bubble');

    // Cleanup
    await request.delete(`${API_BASE}/sessions/${session.id}`);
  });
});
