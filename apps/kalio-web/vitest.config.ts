import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
      '@kalio/types': resolve(__dirname, '../../packages/@kalio/types/src'),
      '@kalio/sdk': resolve(__dirname, '../../packages/@kalio/sdk/src'),
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test-setup.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/**/*.spec.{ts,tsx}', 'src/**/*.test.{ts,tsx}', 'src/main.tsx', 'src/test-setup.ts'],
      thresholds: {
        lines: 38,
        functions: 30,
        statements: 36,
        branches: 30,
      },
    },
  },
});
