import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadConfigFromFile } from 'vite';
import preview from './vite.preview.config.mjs';
import { decisionProtectedProxy, decisionProtectedRoute } from './decision-auth.proxy.mjs';

test('actual preview and DEV configs put exact protected rules before generic proxy', async () => {
  assert.equal(Object.keys(preview.preview.proxy)[0], decisionProtectedRoute);
  assert.equal(preview.preview.proxy[decisionProtectedRoute].changeOrigin, false);
  assert.equal(preview.preview.proxy['/api'].changeOrigin, true);
  const dev = readFileSync(new URL('./vite.config.ts', import.meta.url), 'utf8');
  assert.ok(dev.indexOf('...decisionProtectedProxy(apiOrigin)') < dev.indexOf("'/api': {"));
  const loaded = await loadConfigFromFile({ command: 'serve', mode: 'development' }, new URL('./vite.config.ts', import.meta.url).pathname.replace(/^\/(\w:)/, '$1'));
  assert.ok(loaded);
  assert.equal(Object.keys(loaded.config.server.proxy)[0], decisionProtectedRoute);
  assert.equal(loaded.config.server.proxy[decisionProtectedRoute].changeOrigin, false);
  const route = new RegExp(decisionProtectedRoute);
  assert.ok(route.test('/api/memory/project-context/settings'));
  assert.ok(!route.test('/api/memory/project-context/settings/extra'));
  for (const path of ['/api/decision/auth', '/api/decision/config?x=1', '/api/hitl/config/', '/api/runtime/default-profile']) assert.ok(route.test(path));
  for (const path of ['/api/credentials', '/api/personas', '/api/hitl/config-other', '/api/decision/config/nested', '/api/runtime/default-profile-extra', '/api/runtime/profiles']) assert.ok(!route.test(path));
});

test('proxy ingress validates original peer and exact browser-facing Host/Origin', () => {
  const rule = decisionProtectedProxy('http://127.0.0.1:3316')[decisionProtectedRoute];
  const valid = { socket: { remoteAddress: '127.0.0.1', localPort: 5288 }, headers: { host: 'localhost:5288', origin: 'http://localhost:5288' } };
  const res = { statusCode: 200, setHeader() {}, end() { this.ended = true; }, ended: false };
  assert.equal(rule.bypass(valid, res), undefined);
  assert.equal(valid.headers.host, 'localhost:5288');
  assert.equal(valid.headers.origin, 'http://localhost:5288');
  for (const invalid of [
    { ...valid, socket: { ...valid.socket, remoteAddress: '10.0.0.1' } },
    { ...valid, headers: { ...valid.headers, host: 'evil.example:5288' } },
    { ...valid, headers: { ...valid.headers, origin: 'http://localhost:5188' } },
    { ...valid, headers: { ...valid.headers, origin: 'null' } },
    { ...valid, headers: { ...valid.headers, host: 'localhost:3316' } },
    { ...valid, socket: { ...valid.socket, remoteAddress: '10.0.0.1' }, headers: { ...valid.headers, 'x-forwarded-for': '127.0.0.1' } },
  ]) {
    assert.equal(rule.bypass(invalid, res), '/');
    assert.equal(res.statusCode, 403);
    assert.ok(res.ended);
  }
});

test('random port validates its own listening port rather than known port union', () => {
  const rule = decisionProtectedProxy('http://127.0.0.1:42001')[decisionProtectedRoute];
  const res = { setHeader() {}, end() {} };
  assert.equal(rule.bypass({ socket: { remoteAddress: '::1', localPort: 42002 }, headers: { host: '[::1]:42002', origin: 'http://[::1]:42002' } }, res), undefined);
  assert.equal(rule.bypass({ socket: { remoteAddress: '::1', localPort: 42002 }, headers: { host: 'localhost:5288', origin: 'http://localhost:5288' } }, res), '/');
});
