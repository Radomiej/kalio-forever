import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchProtectedHitlConfig } from './devin-session-readiness.auth.mjs';

const apiBase = 'http://127.0.0.1:3316/api';
const env = { KALIO_CONTROL_PLANE_TOKEN: 'a'.repeat(64) };

test('helper cannot send bearer to another host, route, query, fragment or URL credentials', async () => {
  for (const invalid of ['https://127.0.0.1:3316/api', 'http://evil.example/api',
    'http://127.0.0.1:3316/api/credentials', 'http://127.0.0.1:3316/api/hitl/config',
    'http://127.0.0.1:3316/api?x=1', 'http://127.0.0.1:3316/api#x',
    'http://user:secret@127.0.0.1:3316/api']) {
    let calls = 0;
    await assert.rejects(fetchProtectedHitlConfig({ apiBase: invalid, env, fetchJson: async () => { calls += 1; } }));
    assert.equal(calls, 0);
  }
});

test('helper makes one exact GET; no Origin, cookies, writes or redirect following', async () => {
  let calls = 0;
  const response = await fetchProtectedHitlConfig({ apiBase, env, fetchJson: async (url, init) => {
    calls += 1;
    assert.equal(url, `${apiBase}/hitl/config`);
    assert.equal(init.method, 'GET');
    assert.equal(init.redirect, 'error');
    assert.deepEqual(Object.keys(init.headers), ['Authorization']);
    return new Response('{"mode":"manual"}');
  } });
  assert.equal(response.status, 200);
  assert.equal(calls, 1);
});

test('401 stays unauthorized without retry, bootstrap or consuming secret-bearing response body', async () => {
  let calls = 0;
  const response = await fetchProtectedHitlConfig({ apiBase, env, fetchJson: async () => {
    calls += 1;
    return new Response(env.KALIO_CONTROL_PLANE_TOKEN, { status: 401 });
  } });
  assert.equal(response.status, 401);
  assert.equal(response.bodyUsed, false);
  assert.equal(calls, 1);
});
