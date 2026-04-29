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
      '/api': {
        target: 'http://localhost:3016',
        changeOrigin: true,
        configure: (proxy) => {
          proxy.on('error', (err) => {
            console.warn('[proxy] /api error:', err.message);
          });
        },
      },
      '/socket.io': {
        target: 'http://localhost:3016',
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
