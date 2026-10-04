import test from 'node:test';
import assert from 'node:assert/strict';

test('built preview serves runtime origins and prevents stale routing cache', async () => {
  const oldApi = process.env.VITE_API_URL;
  const oldWs = process.env.VITE_WS_URL;
  try {
    process.env.VITE_API_URL = 'http://127.0.0.1:3316';
    process.env.VITE_WS_URL = 'http://127.0.0.1:4316';
    const { default: config } = await import('../apps/kalio-web/vite.preview.config.mjs?test=origins');
    assert.equal(config.preview?.proxy?.['/api']?.target, process.env.VITE_API_URL);
    assert.equal(config.preview?.proxy?.['/socket.io']?.target, process.env.VITE_WS_URL);
    assert.equal(config.preview?.proxy?.['/socket.io']?.ws, true);
    let handler;
    config.plugins[0].configurePreviewServer({ middlewares: { use(path, callback) {
      assert.equal(path, '/runtime-config.js'); handler = callback;
    } } });
    const headers = {};
    const response = { statusCode: 0, setHeader(key, value) { headers[key] = value; }, end(body) { this.body = body; } };
    handler({}, response);
    assert.equal(response.statusCode, 200);
    assert.equal(headers['Cache-Control'], 'no-store');
    assert.equal(headers['Content-Type'], 'application/javascript; charset=utf-8');
    assert.equal(response.body, 'window.__KALIO_RUNTIME_CONFIG__ = {"apiUrl":"http://127.0.0.1:3316","wsUrl":"http://127.0.0.1:4316"};\n');
  } finally {
    if (oldApi === undefined) delete process.env.VITE_API_URL; else process.env.VITE_API_URL = oldApi;
    if (oldWs === undefined) delete process.env.VITE_WS_URL; else process.env.VITE_WS_URL = oldWs;
  }
});
