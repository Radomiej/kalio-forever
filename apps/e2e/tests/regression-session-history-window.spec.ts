import { test, expect } from '@playwright/test';

test.describe('session history window hydration', () => {
  test('new session activation stays responsive and requests bounded history', async ({ page }) => {
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

    await expect(page.getByTestId('chat-session-title')).toHaveText('New Chat', { timeout: 5_000 });
    const activationMs = Date.now() - startedAt;

    expect(activationMs).toBeLessThan(5_000);
    await expect.poll(
      () => page.evaluate(() => window.sessionStorage.getItem('kalio:last-active-session-id')),
      { timeout: 5_000 },
    ).not.toBeNull();
    const activeSessionId = await page.evaluate(() => window.sessionStorage.getItem('kalio:last-active-session-id'));
    if (!activeSessionId) {
      throw new Error('Expected new session activation to persist kalio:last-active-session-id');
    }

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
  });
});
