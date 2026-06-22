import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildStackStatusReport,
  fetchEffectiveLlmConfig,
  normalizeEffectiveLlmConfig,
  readEffectiveLlmConfig,
  renderEffectiveLlmLine,
  renderStateProcesses,
} from './stack-status.mjs';

test('normalizeEffectiveLlmConfig keeps only meaningful string fields', () => {
  assert.deepEqual(
    normalizeEffectiveLlmConfig({
      provider: 'openrouter',
      model: 'cohere/north-mini-code:free',
      baseUrl: 'https://openrouter.ai/api/v1',
      source: 'db',
      ignored: 'value',
    }),
    {
      provider: 'openrouter',
      model: 'cohere/north-mini-code:free',
      baseUrl: 'https://openrouter.ai/api/v1',
      source: 'db',
    },
  );
  assert.equal(normalizeEffectiveLlmConfig({ provider: '   ' }), null);
});

test('fetchEffectiveLlmConfig returns normalized payload for successful responses', async () => {
  const effective = await fetchEffectiveLlmConfig('http://127.0.0.1:3316/api/llm/config', async (url) => {
    assert.equal(url, 'http://127.0.0.1:3316/api/llm/config');
    return {
      ok: true,
      async json() {
        return {
          provider: 'openrouter',
          model: 'cohere/north-mini-code:free',
          baseUrl: 'https://openrouter.ai/api/v1',
          source: 'db',
        };
      },
    };
  });

  assert.deepEqual(effective, {
    provider: 'openrouter',
    model: 'cohere/north-mini-code:free',
    baseUrl: 'https://openrouter.ai/api/v1',
    source: 'db',
  });
});

test('fetchEffectiveLlmConfig returns null for network or response failures', async () => {
  assert.equal(await fetchEffectiveLlmConfig('http://127.0.0.1:3316/api/llm/config', async () => ({ ok: false })), null);
  assert.equal(await fetchEffectiveLlmConfig('http://127.0.0.1:3316/api/llm/config', async () => { throw new Error('offline'); }), null);
  assert.equal(await fetchEffectiveLlmConfig('', async () => ({ ok: true, json: async () => ({}) })), null);
});

test('readEffectiveLlmConfig derives the canonical llm config URL from backendPort', async () => {
  const effective = await readEffectiveLlmConfig({ backendPort: 3316 }, async (url) => {
    assert.equal(url, 'http://127.0.0.1:3316/api/llm/config');
    return {
      ok: true,
      async json() {
        return { provider: 'mock', model: 'mock', source: 'env' };
      },
    };
  });

  assert.deepEqual(effective, {
    provider: 'mock',
    model: 'mock',
    baseUrl: null,
    source: 'env',
  });
});

test('buildStackStatusReport includes effectiveLlm alongside startup state', async () => {
  const report = await buildStackStatusReport({
    status: 'running',
    state: {
      backend: { pid: 111 },
      frontend: { pid: 222 },
      backendPort: 3316,
      provider: 'xiaomimimo',
      model: 'mimo-v2.5-pro',
    },
    repoRoot: 'C:\\Projekty\\kalio-forever',
    isProcessAlive: (pid) => pid === 111,
    fetchImpl: async () => ({
      ok: true,
      async json() {
        return { provider: 'openrouter', model: 'cohere/north-mini-code:free', source: 'db' };
      },
    }),
  });

  assert.equal(report.status, 'running');
  assert.equal(report.backendUp, true);
  assert.equal(report.frontendUp, false);
  assert.equal(report.state.provider, 'xiaomimimo');
  assert.equal(report.state.model, 'mimo-v2.5-pro');
  assert.deepEqual(report.effectiveLlm, {
    provider: 'openrouter',
    model: 'cohere/north-mini-code:free',
    baseUrl: null,
    source: 'db',
  });
  assert.equal(report.paths.statePath.endsWith('\\.tmp\\qa-stack\\qa-stack-state.json'), true);
});

test('render helpers produce stable operator-facing lines', () => {
  assert.deepEqual(renderStateProcesses({ backend: { pid: 101, cwd: 'api' }, frontend: { pid: 202, cwd: 'web' } }), [
    '[stack] backend pid 101  (api)',
    '[stack] frontend pid 202 (web)',
    '[stack] ports: backend=unknown, frontend=unknown',
  ]);
  assert.equal(
    renderEffectiveLlmLine({ provider: 'openrouter', model: 'cohere/north-mini-code:free', source: 'db' }),
    '[stack] effective provider=openrouter model=cohere/north-mini-code:free source=db',
  );
  assert.equal(renderEffectiveLlmLine(null), null);
});
