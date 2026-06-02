import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const pagesBase = process.env['VITE_BASE_PATH'] ?? '/kalio-forever/';
const vitePort = Number.parseInt(process.env['VITE_PORT'] ?? '5190', 10);

export default defineConfig({
  base: pagesBase,
  plugins: [react()],
  server: {
    port: Number.isNaN(vitePort) ? 5190 : vitePort,
  },
});
