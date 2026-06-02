import { randomInt } from 'node:crypto';
import { resolve } from 'node:path';
import { defineConfig, devices } from '@playwright/test';

const PROCESS = (globalThis as { process?: { env?: Record<string, string | undefined>; platform?: string } }).process;
const repoRoot = resolve(__dirname, '../..');
const defaultApiPort = randomInt(20_000, 49_999);
const defaultWebPort = randomInt(50_000, 59_999);

if (PROCESS?.env) {
  PROCESS.env.DATABASE_PATH ??= resolve(repoRoot, 'data/kalio-e2e.db');
  PROCESS.env.WORKSPACE_ROOT ??= resolve(repoRoot, 'data/workspaces-e2e');
  PROCESS.env.CREDENTIALS_MASTER_KEY ??= 'playwright-test-master-key-32-chars-minimum';
}

const CI = PROCESS?.env?.CI;
const PLAYWRIGHT_BASE_URL = PROCESS?.env?.PLAYWRIGHT_BASE_URL ?? `http://127.0.0.1:${defaultWebPort}`;
const PLAYWRIGHT_API_ORIGIN = PROCESS?.env?.PLAYWRIGHT_API_ORIGIN ?? `http://127.0.0.1:${defaultApiPort}`;
const TEST_API_URL = PROCESS?.env?.TEST_API_URL ?? `${PLAYWRIGHT_API_ORIGIN}/api`;
const PLAYWRIGHT_BROWSER_EXECUTABLE_PATH = PROCESS?.env?.KALIO_PLAYWRIGHT_BROWSER_EXECUTABLE_PATH;
const PLAYWRIGHT_BROWSER_CHANNEL = PROCESS?.env?.KALIO_PLAYWRIGHT_BROWSER_CHANNEL;
const reuseExistingServer = PROCESS?.env?.KALIO_PLAYWRIGHT_REUSE_SERVER === '1';
const externalServer = PROCESS?.env?.KALIO_PLAYWRIGHT_EXTERNAL_SERVER === '1';
const stackLauncherCommand = 'node ./scripts/start-playwright-stack.mjs';
const requestedWorkers = Number(PROCESS?.env?.KALIO_PLAYWRIGHT_WORKERS ?? '1');
const workers = Number.isInteger(requestedWorkers) && requestedWorkers > 0 ? requestedWorkers : 1;
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

if (PROCESS?.env) {
  PROCESS.env.PLAYWRIGHT_BASE_URL ??= PLAYWRIGHT_BASE_URL;
  PROCESS.env.PLAYWRIGHT_API_ORIGIN ??= PLAYWRIGHT_API_ORIGIN;
  PROCESS.env.TEST_API_URL ??= TEST_API_URL;
}

export default defineConfig({
  testDir: './tests',
  timeout: 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: true,
  forbidOnly: !!CI,
  retries: CI ? 2 : 0,
  workers,
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
