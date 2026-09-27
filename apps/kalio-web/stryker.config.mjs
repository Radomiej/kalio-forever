export default {
  plugins: ['@stryker-mutator/vitest-runner'],
  testRunner: 'vitest',
  vitest: {
    configFile: 'vitest.config.ts',
    related: true,
  },
  mutate: ['src/features/updates/desktopUpdater.ts'],
  reporters: ['clear-text', 'progress', 'json', 'html'],
  coverageAnalysis: 'perTest',
  concurrency: 1,
  thresholds: {
    high: 90,
    low: 80,
    break: 90,
  },
};
