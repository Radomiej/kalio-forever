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
      () => messageRequests.find((url) => url.includes('/api/sessions/') && url.includes('/messages')) ?? null,
      { timeout: 5_000 },
    ).not.toBeNull();

    const firstHistoryRequest = messageRequests[0];
    expect(firstHistoryRequest).toBeTruthy();
    const parsed = new URL(firstHistoryRequest);
    expect(parsed.searchParams.get('limit')).toBe('40');
  });
});
