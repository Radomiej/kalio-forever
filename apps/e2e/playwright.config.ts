import { resolve } from 'node:path';
import { defineConfig, devices } from '@playwright/test';

const PROCESS = (globalThis as { process?: { env?: Record<string, string | undefined>; platform?: string } }).process;
const repoRoot = resolve(__dirname, '../..');

if (PROCESS?.env) {
  PROCESS.env.PLAYWRIGHT_BASE_URL ??= 'http://localhost:5288';
  PROCESS.env.PLAYWRIGHT_API_ORIGIN ??= 'http://localhost:3316';
  PROCESS.env.TEST_API_URL ??= `${PROCESS.env.PLAYWRIGHT_API_ORIGIN}/api`;
  PROCESS.env.DATABASE_PATH ??= resolve(repoRoot, 'data/kalio-e2e.db');
  PROCESS.env.WORKSPACE_ROOT ??= resolve(repoRoot, 'data/workspaces-e2e');
  PROCESS.env.CREDENTIALS_MASTER_KEY ??= 'playwright-test-master-key-32-chars-minimum';
}

const CI = PROCESS?.env?.CI;
const PLAYWRIGHT_BASE_URL = PROCESS?.env?.PLAYWRIGHT_BASE_URL ?? 'http://localhost:5288';
const reuseExistingServer = PROCESS?.env?.KALIO_PLAYWRIGHT_REUSE_SERVER === '1';
const stackLauncherCommand = 'node ./scripts/start-playwright-stack.mjs';

export default defineConfig({
  testDir: './tests',
  timeout: 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: true,
  forbidOnly: !!CI,
  retries: CI ? 2 : 0,
  workers: CI ? 1 : undefined,
  reporter: [['html', { open: 'never' }], ['list']],

  use: {
    baseURL: PLAYWRIGHT_BASE_URL,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },

  webServer: {
    command: stackLauncherCommand,
    url: PLAYWRIGHT_BASE_URL,
    reuseExistingServer,
    timeout: 240_000,
  },

  projects: [
    {
      name: 'chromium',
      testIgnore: ['**/integration/**'],
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'integration',
      testDir: './tests/integration',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
