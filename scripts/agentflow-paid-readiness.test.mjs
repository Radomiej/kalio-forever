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
    if (!route && url.endsWith('/search/config')) {
      return response({ provider: 'perplexity', configured: true });
    }
    if (!route && url.endsWith('/search/test')) {
      return response({ ok: true });
    }
    if (!route && (url.endsWith('/sessions') || url.includes('/sessions/'))) {
      return response([]);
    }
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
      'http://kalio.test/api/search/config': response({ provider: 'perplexity', configured: false }),
      'http://kalio.test/api/search/test': response({ ok: false, error: 'Web search not configured.' }),
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
    'Web Search is not configured (perplexity); configure it before paid research/persistence runs.',
    'Web Search smoke failed: Web search not configured.',
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
      'http://kalio.test/api/credentials/cred-live/test-completion': response({
        ok: true,
        provider: 'openai',
        model: 'gpt-5.4',
        source: 'db',
        latencyMs: 42,
      }),
      'http://kalio.test/api/agent-flows/runs': response([{ run: { id: 'run-fresh', status: 'running', updatedAt: 9_500 } }]),
      'http://kalio.test/api/cli-agents/codex/config': response({ enabled: true, model: 'gpt-5.4-mini' }),
    }),
  });

  assert.equal(exitCode, 0);
});

test('paid readiness blocks when the completion smoke diverges from the effective Xiaomi provider config', async () => {
  const checks = await collectPaidReadinessChecks({
    apiBase: 'http://kalio.test/api',
    now: 10_000,
    maxRunningAgeMs: 1_000,
    fetchJson: fetchFrom({
      'http://kalio.test/api/llm/config': response({ provider: 'xiaomimimo', source: 'db', model: 'mimo-v2.5' }),
      'http://kalio.test/api/credentials': response([{ id: 'cred-live' }]),
      'http://kalio.test/api/credentials/active': response({ credentialId: 'cred-live' }),
      'http://kalio.test/api/credentials/cred-live/test': response({ ok: true, modelCount: 2 }),
      'http://kalio.test/api/credentials/cred-live/test-completion': response({
        ok: true,
        provider: 'openai',
        model: 'gpt-4o',
        source: 'env',
        latencyMs: 42,
      }),
      'http://kalio.test/api/agent-flows/runs': response([]),
      'http://kalio.test/api/cli-agents/codex/config': response({ enabled: true, model: 'gpt-5.4-mini' }),
    }),
  });

  assert.ok(checks.some((check) => (
    check.ok === false
    && check.message === 'Active completion smoke used openai but effective provider is xiaomimimo'
  )));
  assert.ok(checks.some((check) => (
    check.ok === false
    && check.message === 'Active completion smoke model gpt-4o does not match effective model mimo-v2.5'
  )));
  assert.ok(checks.some((check) => (
    check.ok === false
    && check.message === 'Active completion smoke source env does not match effective source db'
  )));
});

test('paid readiness can require a high-level model completion smoke without changing the active model', async () => {
  const completionBodies = [];
  const checks = await collectPaidReadinessChecks({
    apiBase: 'http://kalio.test/api',
    now: 10_000,
    maxRunningAgeMs: 1_000,
    requiredHighLevelModel: 'mimo-v2.5-pro',
    fetchJson: async (url, init) => {
      if (url === 'http://kalio.test/api/llm/config') {
        return response({ provider: 'xiaomimimo', source: 'db', model: 'mimo-v2.5' });
      }
      if (url === 'http://kalio.test/api/credentials') {
        return response([{ id: 'cred-live' }]);
      }
      if (url === 'http://kalio.test/api/credentials/active') {
        return response({ credentialId: 'cred-live' });
      }
      if (url === 'http://kalio.test/api/credentials/cred-live/test') {
        return response({ ok: true, modelCount: 9 });
      }
      if (url === 'http://kalio.test/api/credentials/cred-live/test-completion') {
        const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
        completionBodies.push(body ?? null);
        return response(body?.model === 'mimo-v2.5-pro'
          ? {
              ok: false,
              provider: 'xiaomimimo',
              model: 'mimo-v2.5-pro',
              source: 'db',
              error: '451 Unavailable For Legal Reasons',
            }
          : {
              ok: true,
              provider: 'xiaomimimo',
              model: 'mimo-v2.5',
              source: 'db',
            });
      }
      if (url === 'http://kalio.test/api/agent-flows/runs') {
        return response([]);
      }
      if (url === 'http://kalio.test/api/cli-agents/codex/config') {
        return response({ enabled: true, model: 'gpt-5.4-mini' });
      }
      if (url === 'http://kalio.test/api/search/config') {
        return response({ provider: 'perplexity', configured: true });
      }
      if (url === 'http://kalio.test/api/search/test') {
        return response({ ok: true });
      }
      if (url.endsWith('/sessions')) {
        return response([]);
      }
      throw new Error(`Unexpected URL: ${url}`);
    },
  });

  assert.deepEqual(completionBodies, [null, { model: 'mimo-v2.5-pro' }]);
  assert.ok(checks.some((check) => (
    check.ok === false
    && check.message === 'Required high-level model completion smoke failed for mimo-v2.5-pro: 451 Unavailable For Legal Reasons'
  )));
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
    'http://127.0.0.1:51052/api/sessions',
    'http://127.0.0.1:51052/api/cli-agents/codex/config',
    'http://127.0.0.1:51052/api/search/config',
    'http://127.0.0.1:51052/api/search/test',
    'http://127.0.0.1:51052/api/credentials/cred-live/test',
    'http://127.0.0.1:51052/api/credentials/cred-live/test-completion',
  ]);
});

test('paid readiness fails when Web Search is not configured for research persistence', async () => {
  const checks = await collectPaidReadinessChecks({
    apiBase: 'http://kalio.test/api',
    now: 10_000,
    maxRunningAgeMs: 1_000,
    fetchJson: fetchFrom({
      'http://kalio.test/api/llm/config': response({ provider: 'xiaomimimo', source: 'db', model: 'mimo-v2.5' }),
      'http://kalio.test/api/credentials': response([{ id: 'cred-live' }]),
      'http://kalio.test/api/credentials/active': response({ credentialId: 'cred-live' }),
      'http://kalio.test/api/credentials/cred-live/test': response({ ok: true, modelCount: 9 }),
      'http://kalio.test/api/credentials/cred-live/test-completion': response({
        ok: true,
        provider: 'xiaomimimo',
        model: 'mimo-v2.5',
        source: 'db',
      }),
      'http://kalio.test/api/agent-flows/runs': response([]),
      'http://kalio.test/api/cli-agents/codex/config': response({ enabled: true, model: 'gpt-5.4-mini' }),
      'http://kalio.test/api/search/config': response({ provider: 'perplexity', configured: false }),
      'http://kalio.test/api/search/test': response({ ok: false, error: 'Web search not configured.' }),
    }),
  });

  assert.ok(checks.some((check) => (
    check.ok === false
    && check.message === 'Web Search is not configured (perplexity); configure it before paid research/persistence runs.'
  )));
  assert.ok(checks.some((check) => (
    check.ok === false
    && check.message === 'Web Search smoke failed: Web search not configured.'
  )));
});

test('paid readiness CLI honors --api instead of silently using managed stack state', async () => {
  const output = [];
  const exitCode = await runPaidReadinessCheck({
    argv: ['--api', 'http://kalio.test/api'],
    now: 10_000,
    maxRunningAgeMs: 1_000,
    stdout: (line) => output.push(line),
    stderr() {},
    fetchJson: fetchFrom({
      'http://kalio.test/api/llm/config': response({ provider: 'openai', source: 'db', model: 'gpt-5.4' }),
      'http://kalio.test/api/credentials': response([{ id: 'cred-live' }]),
      'http://kalio.test/api/credentials/active': response({ credentialId: 'cred-live' }),
      'http://kalio.test/api/credentials/cred-live/test': response({ ok: true, modelCount: 2 }),
      'http://kalio.test/api/credentials/cred-live/test-completion': response({
        ok: true,
        provider: 'openai',
        model: 'gpt-5.4',
        source: 'db',
        latencyMs: 42,
      }),
      'http://kalio.test/api/agent-flows/runs': response([]),
      'http://kalio.test/api/cli-agents/codex/config': response({ enabled: true, model: 'gpt-5.4-mini' }),
    }),
  });

  assert.equal(exitCode, 0);
  assert.ok(output.some((line) => line.includes('AgentFlow paid-run readiness passed.')));
});

test('paid readiness CLI rejects --api without a URL', async () => {
  const errors = [];
  const exitCode = await runPaidReadinessCheck({
    argv: ['--api'],
    stdout() {},
    stderr: (line) => errors.push(line),
    fetchJson: fetchFrom({}),
  });

  assert.equal(exitCode, 1);
  assert.deepEqual(errors, ['Missing value for --api.']);
});

test('paid readiness fails when recent conversation projection contains Architecture provider failure', async () => {
  const checks = await collectPaidReadinessChecks({
    apiBase: 'http://kalio.test/api',
    now: 10_000,
    maxRunningAgeMs: 1_000,
    maxRecentProviderFailureMs: 5_000,
    fetchJson: fetchFrom({
      'http://kalio.test/api/llm/config': response({ provider: 'xiaomimimo', source: 'db', model: 'mimo-v2.5-pro' }),
      'http://kalio.test/api/credentials': response([{ id: 'cred-live' }]),
      'http://kalio.test/api/credentials/active': response({ credentialId: 'cred-live' }),
      'http://kalio.test/api/credentials/cred-live/test': response({ ok: true, modelCount: 9 }),
      'http://kalio.test/api/credentials/cred-live/test-completion': response({ ok: true, latencyMs: 42 }),
      'http://kalio.test/api/agent-flows/runs': response([]),
      'http://kalio.test/api/sessions': response([{ id: 'parent-1', updatedAt: 9_500 }]),
      'http://kalio.test/api/sessions/parent-1/messages': response([{
        id: 'architecture:run-1:text',
        content: 'Architecture run failed. Reason: [XiaomiMiMo] LLM request failed: 451 Unavailable For Legal Reasons - cross-border isolation policy',
      }]),
      'http://kalio.test/api/cli-agents/codex/config': response({ enabled: true, model: 'gpt-5.4-mini' }),
    }),
  });

  assert.ok(checks.some((check) => (
    check.ok === false
    && check.message === 'Recent Architecture provider failures found: parent-1:architecture:run-1:text'
  )));
});

test('paid readiness fails when a recent AgentFlow trace contains Xiaomi provider failure', async () => {
  const checks = await collectPaidReadinessChecks({
    apiBase: 'http://kalio.test/api',
    now: 10_000,
    maxRunningAgeMs: 1_000,
    maxRecentProviderFailureMs: 5_000,
    fetchJson: fetchFrom({
      'http://kalio.test/api/llm/config': response({ provider: 'xiaomimimo', source: 'db', model: 'mimo-v2.5' }),
      'http://kalio.test/api/credentials': response([{ id: 'cred-live' }]),
      'http://kalio.test/api/credentials/active': response({ credentialId: 'cred-live' }),
      'http://kalio.test/api/credentials/cred-live/test': response({ ok: true, modelCount: 9 }),
      'http://kalio.test/api/credentials/cred-live/test-completion': response({
        ok: true,
        provider: 'xiaomimimo',
        model: 'mimo-v2.5',
        source: 'db',
      }),
      'http://kalio.test/api/agent-flows/runs': response([{
        run: { id: 'flow-451', status: 'waiting_on_orchestrator', updatedAt: 9_500 },
        events: [{
          id: 'flow-451:event:60',
          message: 'Goal Master branch error: [XiaomiMiMo] LLM request failed: 451 Unavailable For Legal Reasons - cross-border isolation policy',
        }],
      }]),
      'http://kalio.test/api/cli-agents/codex/config': response({ enabled: true, model: 'gpt-5.4-mini' }),
    }),
  });

  assert.ok(checks.some((check) => (
    check.ok === false
    && check.message === 'Recent AgentFlow provider failures found: flow-451:flow-451:event:60'
  )));
});

test('paid readiness inspects the newest sessions before applying the recent provider failure limit', async () => {
  const sessions = Array.from({ length: 25 }, (_value, index) => ({
    id: `session-${index + 1}`,
    updatedAt: 1_000 + index,
  }));
  const newestFailedSession = sessions.at(-1);
  const requestedMessageUrls = [];

  const checks = await collectPaidReadinessChecks({
    apiBase: 'http://kalio.test/api',
    now: 10_000,
    maxRunningAgeMs: 1_000,
    maxRecentProviderFailureMs: 20_000,
    fetchJson: async (url) => {
      if (url === 'http://kalio.test/api/llm/config') {
        return response({ provider: 'xiaomimimo', source: 'db', model: 'mimo-v2.5' });
      }
      if (url === 'http://kalio.test/api/credentials') {
        return response([{ id: 'cred-live' }]);
      }
      if (url === 'http://kalio.test/api/credentials/active') {
        return response({ credentialId: 'cred-live' });
      }
      if (url === 'http://kalio.test/api/credentials/cred-live/test') {
        return response({ ok: true, modelCount: 9 });
      }
      if (url === 'http://kalio.test/api/credentials/cred-live/test-completion') {
        return response({
          ok: true,
          provider: 'xiaomimimo',
          model: 'mimo-v2.5',
          source: 'db',
        });
      }
      if (url === 'http://kalio.test/api/agent-flows/runs') {
        return response([]);
      }
      if (url === 'http://kalio.test/api/sessions') {
        return response(sessions);
      }
      if (url === 'http://kalio.test/api/cli-agents/codex/config') {
        return response({ enabled: true, model: 'gpt-5.4-mini' });
      }
      if (url.includes('/sessions/') && url.endsWith('/messages')) {
        requestedMessageUrls.push(url);
        return response(url.includes(`/sessions/${newestFailedSession.id}/messages`)
          ? [{
              id: 'architecture:newest-failure:text',
              content: 'Architecture run failed. Reason: [XiaomiMiMo] LLM request failed: 451 Unavailable For Legal Reasons - cross-border isolation policy',
            }]
          : []);
      }
      throw new Error(`Unexpected URL: ${url}`);
    },
  });

  assert.equal(requestedMessageUrls.length, 20);
  assert.equal(requestedMessageUrls[0], `http://kalio.test/api/sessions/${newestFailedSession.id}/messages`);
  assert.ok(checks.some((check) => (
    check.ok === false
    && check.message === `Recent Architecture provider failures found: ${newestFailedSession.id}:architecture:newest-failure:text`
  )));
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
      'http://kalio.test/api/credentials/cred-live/test-completion': response({ ok: false, error: 'Invalid API Key' }),
      'http://kalio.test/api/agent-flows/runs': response([]),
      'http://kalio.test/api/cli-agents/codex/config': response({ enabled: true, model: 'gpt-5.4-mini' }),
    }),
  });

  assert.ok(checks.some((check) => check.ok === false && check.message === 'Active credential provider test failed: Invalid API Key'));
});

test('paid readiness fails when provider model listing passes but real completion smoke fails', async () => {
  const checks = await collectPaidReadinessChecks({
    apiBase: 'http://kalio.test/api',
    now: 10_000,
    maxRunningAgeMs: 1_000,
    fetchJson: fetchFrom({
      'http://kalio.test/api/llm/config': response({ provider: 'xiaomimimo', source: 'db', model: 'mimo-v2.5-pro' }),
      'http://kalio.test/api/credentials': response([{ id: 'cred-live' }]),
      'http://kalio.test/api/credentials/active': response({ credentialId: 'cred-live' }),
      'http://kalio.test/api/credentials/cred-live/test': response({ ok: true, modelCount: 9 }),
      'http://kalio.test/api/credentials/cred-live/test-completion': response({
        ok: false,
        error: '[XiaomiMiMo] LLM request failed: 451 Client Error (451) - cross-border isolation policy',
      }),
      'http://kalio.test/api/agent-flows/runs': response([]),
      'http://kalio.test/api/cli-agents/codex/config': response({ enabled: true, model: 'gpt-5.4-mini' }),
    }),
  });

  assert.ok(checks.some((check) => (
    check.ok === false
    && check.message === 'Active credential completion smoke failed: [XiaomiMiMo] LLM request failed: 451 Client Error (451) - cross-border isolation policy'
  )));
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
