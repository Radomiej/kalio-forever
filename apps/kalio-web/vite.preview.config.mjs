// Built serving needs no React/Tailwind transforms or TypeScript config runner.
// Keep runtime-config behavior aligned with vite.config.ts (manual DEV).
const apiOrigin = process.env.VITE_API_URL ?? 'http://127.0.0.1:3016';
const wsOrigin = process.env.VITE_WS_URL ?? apiOrigin;

export default {
  preview: {
    proxy: {
      '/api': { target: apiOrigin, changeOrigin: true },
      '/socket.io': { target: wsOrigin, changeOrigin: true, ws: true },
    },
  },
  plugins: [{
    name: 'kalio-runtime-config',
    configurePreviewServer(server) {
      server.middlewares.use('/runtime-config.js', (_req, res) => {
        res.statusCode = 200;
        res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
        res.setHeader('Cache-Control', 'no-store');
        res.end(`window.__KALIO_RUNTIME_CONFIG__ = ${JSON.stringify({ apiUrl: apiOrigin, wsUrl: wsOrigin })};\n`);
      });
    },
  }],
};
