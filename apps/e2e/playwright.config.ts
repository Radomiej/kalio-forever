import { defineConfig, devices } from '@playwright/test';

const CI = (globalThis as any).process?.env.CI;
const PLAYWRIGHT_BASE_URL = (globalThis as any).process?.env.PLAYWRIGHT_BASE_URL || 'http://localhost:5288';

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
