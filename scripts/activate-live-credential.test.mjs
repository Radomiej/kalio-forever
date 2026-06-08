import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  activateLiveCredential,
  assertLocalApiUrl,
  readStackApiUrl,
  runActivateLiveCredential,
} from './activate-live-credential.mjs';

function response(body, ok = true, status = 200) {
  return {
    ok,
    status,
    async text() {
      return typeof body === 'string' ? body : JSON.stringify(body);
    },
  };
}

test('activation refuses remote Kalio API URLs unless explicitly allowed', () => {
  assert.throws(
    () => assertLocalApiUrl('https://kalio.example.test/api'),
    /refusing to send credentials to a non-local API URL/,
  );
  assert.doesNotThrow(() => assertLocalApiUrl('https://kalio.example.test/api', true));
});

test('activation reads the managed stack API URL from random-port state', () => {
  const root = mkdtempSync(join(tmpdir(), 'kalio-activate-live-'));
  mkdirSync(join(root, '.kalio-stack'));
  writeFileSync(join(root, '.kalio-stack/qa-stack-state.json'), JSON.stringify({ backendPort: 51052 }), 'utf8');

  assert.equal(readStackApiUrl(root), 'http://127.0.0.1:51052/api');
});

test('activation prefers ignored test env values over base env file values', async () => {
  const root = mkdtempSync(join(tmpdir(), 'kalio-activate-live-env-priority-'));
  writeFileSync(join(root, '.env'), [
    'LLM_API_KEY=base-key',
    'LLM_PROVIDER=openai',
    'LLM_MODEL=gpt-4o-mini',
    'LLM_BASE_URL=https://api.openai.com/v1',
  ].join('\n'), 'utf8');
  writeFileSync(join(root, '.env.test'), [
    'LLM_API_KEY=test-key',
    'LLM_PROVIDER=xiaomimimo',
    'LLM_MODEL=mimo-v2.5-pro',
    'LLM_BASE_URL=https://token-plan-ams.xiaomimimo.com/v1',
  ].join('\n'), 'utf8');

  const calls = [];
  await activateLiveCredential({
    args: ['--api-url', 'http://127.0.0.1:51052/api'],
    env: {},
    repoRoot: root,
    fetchJson: async (url, init) => {
      calls.push({ url, init });
      return url.endsWith('/credentials') ? response({ id: 'cred-live' }) : response('');
    },
  });

  const body = JSON.parse(calls[0].init.body);
  assert.equal(body.apiKey, 'test-key');
  assert.equal(body.provider, 'xiaomimimo');
  assert.equal(body.model, 'mimo-v2.5-pro');
});

test('activation creates and activates a DB credential without printing the API key', async () => {
  const calls = [];
  const stdout = [];
  const exitCode = await runActivateLiveCredential({
    args: ['--api-url', 'http://127.0.0.1:51052/api', '--provider', 'xiaomimimo', '--model', 'mimo-v2.5-pro'],
    env: {
      LLM_API_KEY: 'secret-live-key',
      LLM_BASE_URL: 'https://token-plan-ams.xiaomimimo.com/v1',
    },
    stdout: (line) => stdout.push(line),
    stderr: () => {},
    fetchJson: async (url, init) => {
      calls.push({ url, init });
      if (url.endsWith('/credentials')) {
        return response({ id: 'cred-live' });
      }
      return response('');
    },
  });

  assert.equal(exitCode, 0);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].url, 'http://127.0.0.1:51052/api/credentials');
  assert.equal(calls[1].url, 'http://127.0.0.1:51052/api/credentials/active/cred-live');
  assert.equal(JSON.parse(calls[0].init.body).apiKey, 'secret-live-key');
  assert.doesNotMatch(stdout.join('\n'), /secret-live-key/);
  assert.match(stdout.join('\n'), /"credentialId": "cred-live"/);
});

test('activation defaults Xiaomi live credentials to the cheaper mimo-v2.5 model', async () => {
  const calls = [];

  await activateLiveCredential({
    args: ['--api-url', 'http://127.0.0.1:51052/api'],
    env: {
      LLM_API_KEY: 'secret-live-key',
    },
    repoRoot: mkdtempSync(join(tmpdir(), 'kalio-activate-live-default-model-')),
    fetchJson: async (url, init) => {
      calls.push({ url, init });
      return url.endsWith('/credentials') ? response({ id: 'cred-live' }) : response('');
    },
  });

  const body = JSON.parse(calls[0].init.body);
  assert.equal(body.provider, 'xiaomimimo');
  assert.equal(body.model, 'mimo-v2.5');
});

test('activation fails before network calls when no API key is available', async () => {
  const root = mkdtempSync(join(tmpdir(), 'kalio-activate-live-empty-env-'));
  let called = false;

  await assert.rejects(
    () => activateLiveCredential({
      args: ['--api-url', 'http://127.0.0.1:51052/api'],
      env: {},
      repoRoot: root,
      fetchJson: async () => {
        called = true;
        return response({});
      },
    }),
    /LLM_API_KEY is empty/,
  );
  assert.equal(called, false);
});
