import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { resolve } from 'node:path';

const vitePort = Number.parseInt(process.env['VITE_PORT'] ?? '5188', 10);
const apiOrigin = process.env['VITE_API_URL'] ?? 'http://localhost:3016';
const wsOrigin = process.env['VITE_WS_URL'] ?? apiOrigin;

export default defineConfig({
  plugins: [react(), tailwindcss()],
  optimizeDeps: {
    exclude: ['vitest'],
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
      '@kalio/types': resolve(__dirname, '../../packages/@kalio/types/src'),
      '@kalio/sdk': resolve(__dirname, '../../packages/@kalio/sdk/src'),
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
