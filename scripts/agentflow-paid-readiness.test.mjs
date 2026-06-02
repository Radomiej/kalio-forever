import test from 'node:test';
import assert from 'node:assert/strict';

import { collectPaidReadinessChecks, runPaidReadinessCheck } from './agentflow-paid-readiness.mjs';

function response(body, ok = true, status = 200) {
  return {
    ok,
    status,
    async json() {
      return body;
    },
  };
}

function invalidJsonResponse() {
  return {
    ok: true,
    status: 200,
    async json() {
      throw new SyntaxError('Unexpected token');
    },
  };
}

function fetchFrom(routes) {
  return async (url) => {
    const route = routes[url];
    if (!route) {
      throw new Error(`Unexpected URL: ${url}`);
    }
    return route;
  };
}

test('paid readiness fails closed for mock provider, missing credentials, stale runs, and wrong Codex model', async () => {
  const checks = await collectPaidReadinessChecks({
    apiBase: 'http://kalio.test/api',
    now: 10_000,
    maxRunningAgeMs: 1_000,
    fetchJson: fetchFrom({
      'http://kalio.test/api/llm/config': response({ provider: 'mock', source: 'env', model: '' }),
      'http://kalio.test/api/credentials': response([]),
      'http://kalio.test/api/credentials/active': response({ credentialId: null }),
      'http://kalio.test/api/agent-flows/runs': response([{ run: { id: 'run-stale', status: 'running', updatedAt: 1 } }]),
      'http://kalio.test/api/cli-agents/codex/config': response({ enabled: false, model: 'gpt-5.3-codex' }),
    }),
  });

  const failures = checks.filter((check) => !check.ok).map((check) => check.message);

  assert.deepEqual(failures, [
    'LLM provider is mock; configure a real provider before paid/live AgentFlow runs.',
    'LLM config source is env; activate a saved credential before paid/live runs.',
    'LLM model is empty.',
    'No saved live credentials exist in Kalio.',
    'Active credential is not set.',
    'Found stale running AgentFlow runs: run-stale',
    'Codex CLI agent is disabled.',
    'Codex CLI default model is gpt-5.3-codex, expected gpt-5.4-mini.',
  ]);
});

test('paid readiness passes only when live provider, active credential, fresh runs, and Codex defaults are valid', async () => {
  const exitCode = await runPaidReadinessCheck({
    apiBase: 'http://kalio.test/api',
    now: 10_000,
    maxRunningAgeMs: 1_000,
    stdout() {},
    stderr() {},
    fetchJson: fetchFrom({
      'http://kalio.test/api/llm/config': response({ provider: 'openai', source: 'db', model: 'gpt-5.4' }),
      'http://kalio.test/api/credentials': response([{ id: 'cred-live' }]),
      'http://kalio.test/api/credentials/active': response({ credentialId: 'cred-live' }),
      'http://kalio.test/api/credentials/cred-live/test': response({ ok: true, modelCount: 2 }),
      'http://kalio.test/api/agent-flows/runs': response([{ run: { id: 'run-fresh', status: 'running', updatedAt: 9_500 } }]),
      'http://kalio.test/api/cli-agents/codex/config': response({ enabled: true, model: 'gpt-5.4-mini' }),
    }),
  });

  assert.equal(exitCode, 0);
});

test('paid readiness honors explicit API base when the managed stack uses random ports', async () => {
  const requestedUrls = [];

  await collectPaidReadinessChecks({
    apiBase: 'http://127.0.0.1:51052/api',
    now: 10_000,
    maxRunningAgeMs: 1_000,
    fetchJson: async (url) => {
      requestedUrls.push(url);
      if (!url.startsWith('http://127.0.0.1:51052/api/')) {
        throw new Error(`Unexpected fixed-port URL: ${url}`);
      }
      return response(url.endsWith('/credentials') ? [{ id: 'cred-live' }] : {
        provider: 'openai',
        source: 'db',
        model: 'gpt-5.4-mini',
        credentialId: 'cred-live',
        enabled: true,
        ok: true,
      });
    },
  });

  assert.deepEqual(requestedUrls, [
    'http://127.0.0.1:51052/api/llm/config',
    'http://127.0.0.1:51052/api/credentials',
    'http://127.0.0.1:51052/api/credentials/active',
    'http://127.0.0.1:51052/api/agent-flows/runs',
    'http://127.0.0.1:51052/api/cli-agents/codex/config',
    'http://127.0.0.1:51052/api/credentials/cred-live/test',
  ]);
});

test('paid readiness fails when the active credential exists but provider validation fails', async () => {
  const checks = await collectPaidReadinessChecks({
    apiBase: 'http://kalio.test/api',
    now: 10_000,
    maxRunningAgeMs: 1_000,
    fetchJson: fetchFrom({
      'http://kalio.test/api/llm/config': response({ provider: 'xiaomimimo', source: 'db', model: 'mimo-v2.5-pro' }),
      'http://kalio.test/api/credentials': response([{ id: 'cred-live' }]),
      'http://kalio.test/api/credentials/active': response({ credentialId: 'cred-live' }),
      'http://kalio.test/api/credentials/cred-live/test': response({ ok: false, error: 'Invalid API Key' }),
      'http://kalio.test/api/agent-flows/runs': response([]),
      'http://kalio.test/api/cli-agents/codex/config': response({ enabled: true, model: 'gpt-5.4-mini' }),
    }),
  });

  assert.ok(checks.some((check) => check.ok === false && check.message === 'Active credential provider test failed: Invalid API Key'));
});

test('paid readiness reports malformed JSON responses as blockers instead of throwing', async () => {
  const checks = await collectPaidReadinessChecks({
    apiBase: 'http://kalio.test/api',
    now: 10_000,
    maxRunningAgeMs: 1_000,
    fetchJson: fetchFrom({
      'http://kalio.test/api/llm/config': invalidJsonResponse(),
      'http://kalio.test/api/credentials': response([]),
      'http://kalio.test/api/credentials/active': response({ credentialId: null }),
      'http://kalio.test/api/agent-flows/runs': response([]),
      'http://kalio.test/api/cli-agents/codex/config': response({ enabled: true, model: 'gpt-5.4-mini' }),
    }),
  });

  assert.ok(checks.some((check) => check.ok === false && check.message.includes('LLM config endpoint is reachable: invalid JSON')));
});

test('paid readiness wrapper returns exit code 1 and prints blocker count on failure', async () => {
  const output = [];
  const errors = [];
  const exitCode = await runPaidReadinessCheck({
    apiBase: 'http://kalio.test/api',
    now: 10_000,
    maxRunningAgeMs: 1_000,
    stdout: (line) => output.push(line),
    stderr: (line) => errors.push(line),
    fetchJson: fetchFrom({
      'http://kalio.test/api/llm/config': response({ provider: 'mock', source: 'env', model: '' }),
      'http://kalio.test/api/credentials': response([]),
      'http://kalio.test/api/credentials/active': response({ credentialId: null }),
      'http://kalio.test/api/agent-flows/runs': response([]),
      'http://kalio.test/api/cli-agents/codex/config': response({ enabled: true, model: 'gpt-5.4-mini' }),
    }),
  });

  assert.equal(exitCode, 1);
  assert.ok(output.some((line) => line.includes('FAIL LLM provider is mock')));
  assert.ok(errors.some((line) => line.includes('AgentFlow paid-run readiness failed: 5 blocker(s).')));
});
