import { test, expect } from '@playwright/test';

const DEDICATED_API_BASE = 'http://localhost:3316/api';
const DEDICATED_APP_URL = 'http://localhost:5288';

// Regression test for: E2E stack sharing the normal dev ports.
// Issue: local Playwright could attach to an already-running real dev backend on
// 3016/5188 instead of a dedicated mock-backed E2E stack.

test.describe('Port Configuration Consistency (REGRESSION TEST)', () => {
  test('Document port configuration issue', () => {
    // This test documents the port configuration regression
    // Found during code review:

    // Normal local dev uses:      API 3016 / Web 5188
    // Dedicated E2E should use:  API 3316 / Web 5288
    // Playwright defaults must point at the dedicated stack so the tests never
    // reuse a real agent backend by accident.

    expect(true).toBe(true); // Documentation test
  });
});

test.describe('Server Connectivity (REGRESSION TEST)', () => {
  test('API server responds on the dedicated E2E port', async ({ request }) => {
    const response = await request.get(`${DEDICATED_API_BASE}/health`);
    expect(response.status()).toBe(200);
  });

  test('Web server responds on the dedicated E2E port', async ({ request }) => {
    const response = await request.get(DEDICATED_APP_URL);
    expect(response.status()).toBe(200);
  });
});
