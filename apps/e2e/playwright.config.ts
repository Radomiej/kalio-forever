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
const PLAYWRIGHT_API_ORIGIN = PROCESS?.env?.PLAYWRIGHT_API_ORIGIN ?? 'http://localhost:3316';
const TEST_API_URL = PROCESS?.env?.TEST_API_URL ?? `${PLAYWRIGHT_API_ORIGIN}/api`;
const PLAYWRIGHT_BROWSER_EXECUTABLE_PATH = PROCESS?.env?.KALIO_PLAYWRIGHT_BROWSER_EXECUTABLE_PATH;
const PLAYWRIGHT_BROWSER_CHANNEL = PROCESS?.env?.KALIO_PLAYWRIGHT_BROWSER_CHANNEL;
const reuseExistingServer = PROCESS?.env?.KALIO_PLAYWRIGHT_REUSE_SERVER === '1';
const externalServer = PROCESS?.env?.KALIO_PLAYWRIGHT_EXTERNAL_SERVER === '1';
const stackLauncherCommand = 'node ./scripts/start-playwright-stack.mjs';
const browserLaunchOptions = PLAYWRIGHT_BROWSER_EXECUTABLE_PATH
  ? { executablePath: PLAYWRIGHT_BROWSER_EXECUTABLE_PATH }
  : undefined;

if (PROCESS?.env?.TEST_API_URL) {
  const expectedTestApiUrl = `${new URL(PLAYWRIGHT_API_ORIGIN).origin}/api`;
  const actualTestApiUrl = new URL(TEST_API_URL).href.replace(/\/$/, '');

  if (actualTestApiUrl !== expectedTestApiUrl) {
    throw new Error(
      `TEST_API_URL must match PLAYWRIGHT_API_ORIGIN. Expected ${expectedTestApiUrl}, got ${actualTestApiUrl}.`,
    );
  }
}

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

  webServer: externalServer
    ? undefined
    : {
        command: stackLauncherCommand,
        url: PLAYWRIGHT_BASE_URL,
        reuseExistingServer,
        timeout: 240_000,
      },

  projects: [
    {
      name: 'chromium',
      testIgnore: ['**/integration/**'],
      use: {
        ...devices['Desktop Chrome'],
        channel: PLAYWRIGHT_BROWSER_CHANNEL,
        launchOptions: browserLaunchOptions,
      },
    },
    {
      name: 'integration',
      testDir: './tests/integration',
      use: {
        ...devices['Desktop Chrome'],
        channel: PLAYWRIGHT_BROWSER_CHANNEL,
        launchOptions: browserLaunchOptions,
      },
    },
  ],
});
