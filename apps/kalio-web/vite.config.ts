import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const configDir = dirname(fileURLToPath(import.meta.url));
const vitePort = Number.parseInt(process.env['VITE_PORT'] ?? '5188', 10);
const apiOrigin = process.env['VITE_API_URL'] ?? 'http://localhost:3016';
const wsOrigin = process.env['VITE_WS_URL'] ?? apiOrigin;
const cacheDir = process.env['VITE_CACHE_DIR'] ?? 'node_modules/.vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  cacheDir,
  optimizeDeps: {
    exclude: ['vitest'],
  },
  resolve: {
    alias: {
      '@': resolve(configDir, 'src'),
      '@kalio/types': resolve(configDir, '../../packages/@kalio/types/src'),
      '@kalio/sdk': resolve(configDir, '../../packages/@kalio/sdk/src'),
    },
  },
  server: {
    port: Number.isNaN(vitePort) ? 5188 : vitePort,
    watch: {
      ignored: ['**/*.spec.ts', '**/*.spec.tsx', '**/*.test.ts', '**/*.test.tsx'],
    },
    proxy: {
      '/api': {
        target: apiOrigin,
        changeOrigin: true,
        configure: (proxy) => {
          proxy.on('error', (err) => {
            console.warn('[proxy] /api error:', err.message);
          });
        },
      },
      '/socket.io': {
        target: wsOrigin,
        ws: true,
        changeOrigin: true,
        configure: (proxy) => {
          proxy.on('error', (err) => {
            console.warn('[proxy] /socket.io error:', err.message);
          });
        },
      },
    },
  },
});
