import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveQaEnvValues } from './stack-qa-env.mjs';

const emptyLlm = { LLM_PROVIDER: '', LLM_API_KEY: '', LLM_BASE_URL: '', LLM_MODEL: '' };
const configuredLlm = {
  LLM_PROVIDER: 'openai', LLM_API_KEY: 'fixture-key',
  LLM_BASE_URL: 'https://fixture.invalid/v1', LLM_MODEL: 'fixture-model',
};
const resolveEnv = (options = {}) => resolveQaEnvValues({ fileEnv: {}, processEnv: {}, ...options });
const llmFields = (env) => Object.fromEntries(Object.keys(emptyLlm).map((key) => [key, env[key]]));

test('manual QA without credentials stays unconfigured and does not enable fast mock', () => {
  const env = resolveEnv({ useEnvLlm: true });
  assert.deepEqual(llmFields(env), emptyLlm);
  assert.equal(env.KALIO_MOCK_LLM_FAST, '');
  assert.equal(env.KALIO_FORCE_ENV_LLM, '');
});

test('manual QA preserves explicit empty configuration', () => {
  assert.deepEqual(llmFields(resolveEnv({ useEnvLlm: true, fileEnv: configuredLlm, processEnv: emptyLlm })), emptyLlm);
});

test('manual QA preserves partial configuration without inventing mock fields', () => {
  assert.deepEqual(llmFields(resolveEnv({ useEnvLlm: true, fileEnv: { LLM_PROVIDER: 'openai' } })), {
    ...emptyLlm, LLM_PROVIDER: 'openai',
  });
});

test('disposable stacks intentionally default to mock even with configured env', () => {
  const env = resolveEnv({ fileEnv: configuredLlm, processEnv: configuredLlm });
  assert.deepEqual(llmFields(env), Object.fromEntries(Object.keys(emptyLlm).map((key) => [key, 'mock'])));
  assert.equal(env.KALIO_MOCK_LLM_FAST, '1');
});

test('manual QA accepts file configuration and process env takes precedence', () => {
  assert.deepEqual(llmFields(resolveEnv({ useEnvLlm: true, fileEnv: configuredLlm })), configuredLlm);
  assert.deepEqual(llmFields(resolveEnv({
    useEnvLlm: true, fileEnv: configuredLlm, processEnv: { LLM_MODEL: 'process-model' },
  })), { ...configuredLlm, LLM_MODEL: 'process-model' });
});

test('CLI overrides take precedence in both stack modes', () => {
  for (const useEnvLlm of [true, false]) {
    assert.deepEqual(llmFields(resolveEnv({
      useEnvLlm, fileEnv: configuredLlm, processEnv: configuredLlm,
      provider: 'custom', apiKey: 'cli-key', baseUrl: 'https://cli.invalid', model: 'cli-model',
    })), { LLM_PROVIDER: 'custom', LLM_API_KEY: 'cli-key', LLM_BASE_URL: 'https://cli.invalid', LLM_MODEL: 'cli-model' });
  }
});

test('explicit mock still enables fast mock for manual QA', () => {
  assert.equal(resolveEnv({ useEnvLlm: true, provider: 'mock' }).KALIO_MOCK_LLM_FAST, '1');
  assert.equal(resolveEnv({ useEnvLlm: true, fileEnv: { LLM_PROVIDER: 'mock' } }).KALIO_MOCK_LLM_FAST, '1');
});

test('force and fast flags retain precedence and resolver does not mutate inputs', () => {
  const fileEnv = Object.freeze({ OTHER: 'file', KALIO_FORCE_ENV_LLM: '0', KALIO_MOCK_LLM_FAST: '0' });
  const processEnv = Object.freeze({ OTHER: 'process', KALIO_FORCE_ENV_LLM: '1', KALIO_MOCK_LLM_FAST: '1' });
  const env = resolveEnv({ useEnvLlm: true, fileEnv, processEnv });
  assert.equal(env.OTHER, 'file');
  assert.equal(env.KALIO_FORCE_ENV_LLM, '1');
  assert.equal(env.KALIO_MOCK_LLM_FAST, '1');
  assert.equal(resolveEnv({ forceEnvLlm: true, fileEnv }).KALIO_FORCE_ENV_LLM, '1');
  assert.equal(resolveEnv({ useEnvLlm: true, fileEnv }).KALIO_MOCK_LLM_FAST, '0');
});
