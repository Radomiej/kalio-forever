import { defineConfig, devices } from '@playwright/test';

const CI = (globalThis as any).process?.env.CI;

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
    baseURL: 'http://localhost:5188',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'integration',
      testDir: './tests/integration',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
