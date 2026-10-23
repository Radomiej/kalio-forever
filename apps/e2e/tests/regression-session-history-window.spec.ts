import { test, expect } from '@playwright/test';
import { createExistingMockConversation } from './helpers/existing-mock-conversation';
import { deleteSessionIfExists, selectSession } from './helpers/test-config';

test.describe('session history window hydration', () => {
  test('new draft stays responsive and existing session activation requests bounded history', async ({ page, request }) => {
    const title = `History window ${Date.now()}`;
    const session = await createExistingMockConversation(request, title);
    try {
    const messageRequests: string[] = [];

    page.on('request', (request) => {
      const url = request.url();
      if (url.includes('/api/sessions/') && url.includes('/messages')) {
        messageRequests.push(url);
      }
    });

    await page.goto('/');
    await page.getByTestId('nav-talk').click();

    const startedAt = Date.now();
    await page.getByTestId('new-session-btn').click();

    await expect(page.getByTestId('welcome-screen')).toBeVisible({ timeout: 5_000 });
    const activationMs = Date.now() - startedAt;

    expect(activationMs).toBeLessThan(5_000);
    expect(await page.evaluate(() => window.sessionStorage.getItem('kalio:last-active-session-id'))).toBeNull();
    await selectSession(page, session.id, title);
    const activeSessionId = session.id;

    await expect.poll(
      () => messageRequests.find((url) => (
        url.includes(`/api/sessions/${activeSessionId}/messages`)
      )) ?? null,
      { timeout: 5_000 },
    ).not.toBeNull();
    const activeSessionHistoryRequest = messageRequests.find((url) => (
      url.includes(`/api/sessions/${activeSessionId}/messages`)
    ));
    if (!activeSessionHistoryRequest) {
      throw new Error(`Expected bounded history request for active session ${activeSessionId}; saw ${messageRequests.join('\n')}`);
    }

    for (const historyRequest of messageRequests) {
      const parsedHistoryRequest = new URL(historyRequest);
      const limit = parsedHistoryRequest.searchParams.get('limit');
      expect(limit).toBeTruthy();
      expect(Number(limit)).toBeGreaterThan(0);
      expect(Number(limit)).toBeLessThanOrEqual(40);
    }

    const parsed = new URL(activeSessionHistoryRequest);
    expect(parsed.searchParams.get('limit')).toBe('40');
    } finally {
      await deleteSessionIfExists(request, session.id);
    }
  });
});
