import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { resolve } from 'node:path';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
      '@kalio/types': resolve(__dirname, '../../packages/@kalio/types/src'),
      '@kalio/sdk': resolve(__dirname, '../../packages/@kalio/sdk/src'),
    },
  },
  server: {
    port: 5188,
    proxy: {
      '/api': { target: 'http://localhost:3016', changeOrigin: true },
      '/socket.io': { target: 'http://localhost:3016', ws: true, changeOrigin: true },
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.tsx', 'src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/main.tsx', 'src/test/**'],
      thresholds: { lines: 65, functions: 65, statements: 65, branches: 60 },
    },
  },
});
