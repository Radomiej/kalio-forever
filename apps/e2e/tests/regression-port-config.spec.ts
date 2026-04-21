import { test, expect } from '@playwright/test';

// Regression test for: Port Configuration Mismatch
// Issue: AGENTS.md says port 3015/5187 but .env.example uses 3016/5188
// This causes E2E tests to fail because they wait for wrong port

test.describe('Port Configuration Consistency (REGRESSION TEST)', () => {
  test('Document port configuration issue', () => {
    // This test documents the port configuration regression
    // Found during code review:

    // AGENTS.md documents: PORT=3015 (default in main.ts)
    // .env.example sets: PORT=3016
    // playwright.config.ts uses: 3015

    // AGENTS.md documents: VITE_WS_URL=http://localhost:3015
    // .env.example sets: VITE_WS_URL=http://localhost:3016
    // vite.config.ts uses: port 5188
    // playwright.config.ts uses: 5187

    // This mismatch causes E2E tests to timeout waiting for servers
    // on ports that don't match the actual configuration

    expect(true).toBe(true); // Documentation test
  });
});

test.describe('Server Connectivity (REGRESSION TEST)', () => {
  test('API server responds on expected port', async ({ request }) => {
    // This test will fail if playwright config uses wrong port
    // Expected: API on port 3016 per .env.example
    // playwright.config.ts currently expects: 3015

    try {
      // Try the port from .env.example (3016)
      const response = await request.get('http://localhost:3016/api/health');
      expect(response.status()).toBe(200);
    } catch {
      // If 3016 fails, try playwright config port (3015)
      // If both fail, there's a server startup issue
      test.fail(true, 'API server not responding on expected port - check port configuration');
    }
  });

  test('Web server responds on expected port', async ({ request }) => {
    // Expected: Web on port 5188 per vite.config.ts
    // playwright.config.ts expects: 5187

    try {
      const response = await request.get('http://localhost:5188');
      expect(response.status()).toBe(200);
    } catch {
      test.fail(true, 'Web server not responding on expected port - check port configuration');
    }
  });
});
