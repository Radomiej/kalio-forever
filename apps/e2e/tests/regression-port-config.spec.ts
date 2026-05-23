import { test, expect } from '@playwright/test';

// Regression test for: E2E stack sharing the normal dev ports.
// Issue: local Playwright could attach to an already-running real dev backend on
// 3016/5188 or dedicated lanes 3316/5288 instead of a dedicated mock-backed E2E stack.

function assertNotLegacyPort(urlText: string) {
  const parsed = new URL(urlText);
  const port = parsed.port;
  expect([3016, 3316, 5188, 5288]).not.toContain(Number(port));
}

test.describe('Server Connectivity (REGRESSION TEST)', () => {
  test('API server responds on the configured E2E port', async ({ request }) => {
    const apiBase = process.env.TEST_API_URL;
    expect(apiBase).toBeTruthy();
    assertNotLegacyPort(apiBase);

    const response = await request.get(`${apiBase}/health`);
    expect(response.status()).toBe(200);
  });

  test('Web server responds on the configured E2E port', async ({ request }) => {
    const appUrl = process.env.PLAYWRIGHT_BASE_URL;
    expect(appUrl).toBeTruthy();
    assertNotLegacyPort(appUrl);

    const response = await request.get(appUrl);
    expect(response.status()).toBe(200);
  });
});
