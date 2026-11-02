import { describe, expect, it } from 'vitest';
import { envSchema } from './env.schema';

describe('envSchema', () => {
  it.each(['development', 'test', 'production'])('boots CLI-only configuration in %s without direct LLM settings', mode => {
    const { error, value } = envSchema.validate({
      DATABASE_PATH: './data/app.sqlite', WORKSPACE_ROOT: './sessions', NODE_ENV: mode,
      ...(mode === 'production' ? { CREDENTIALS_MASTER_KEY: 'production-master-key' } : {}),
    });
    expect(error).toBeUndefined();
    expect(value.LLM_PROVIDER).toBeUndefined();
    expect(value.LLM_API_KEY).toBeUndefined();
    expect(value.LLM_BASE_URL).toBeUndefined();
    expect(value.LLM_MODEL).toBeUndefined();
  });

  it('accepts empty direct-provider fields without converting them to mock', () => {
    const { error, value } = envSchema.validate({ DATABASE_PATH: './data/app.sqlite', WORKSPACE_ROOT: './sessions',
      LLM_PROVIDER: '', LLM_API_KEY: '', LLM_MODEL: '', LLM_BASE_URL: '' });
    expect(error).toBeUndefined();
    expect(value.LLM_PROVIDER).toBe('');
  });

  it('preserves explicit mock and legacy embedding configuration', () => {
    const { error, value } = envSchema.validate({ DATABASE_PATH: './data/app.sqlite', WORKSPACE_ROOT: './sessions',
      LLM_PROVIDER: 'mock', EMBEDDING_MODEL: 'Xenova/multilingual-e5-small', EMBEDDING_DIMENSIONS: 384 });
    expect(error).toBeUndefined();
    expect(value.LLM_PROVIDER).toBe('mock');
    expect(value.EMBEDDING_MODEL).toBe('Xenova/multilingual-e5-small');
    expect(value.EMBEDDING_DIMENSIONS).toBe(384);
  });

  it('applies development defaults when required values are present', () => {
    const { error, value } = envSchema.validate({
      DATABASE_PATH: './data/app.sqlite',
      WORKSPACE_ROOT: './sessions',
      LLM_API_KEY: 'test-key',
      LLM_BASE_URL: 'http://localhost:11434/v1',
      LLM_MODEL: 'gpt-test',
    });

    expect(error).toBeUndefined();
    expect(value.PORT).toBe(3016);
    expect(value.NODE_ENV).toBe('development');
    expect(value.MEMORY_DB_PATH).toBe('./data/memory');
    expect(value.EMBEDDING_ENABLED).toBe(true);
    expect(value.EMBEDDING_MODEL).toBeUndefined();
    expect(value.EMBEDDING_DIMENSIONS).toBeUndefined();
    expect(value.EMBEDDING_BACKEND).toBe('cpu');
    expect(value.KALIO_ENABLE_TEST_SUPPORT).toBe(false);
  });

  it('does not inject implicit mock LLM configuration in test mode', () => {
    const { error, value } = envSchema.validate({
      DATABASE_PATH: './data/test.sqlite',
      WORKSPACE_ROOT: './sessions/test',
      NODE_ENV: 'test',
    });

    expect(error).toBeUndefined();
    expect(value.LLM_API_KEY).toBeUndefined();
    expect(value.LLM_BASE_URL).toBeUndefined();
    expect(value.LLM_MODEL).toBeUndefined();
  });

  it('requires a credentials master key in production', () => {
    const { error } = envSchema.validate({
      DATABASE_PATH: './data/prod.sqlite',
      WORKSPACE_ROOT: './sessions/prod',
      NODE_ENV: 'production',
      LLM_API_KEY: 'prod-key',
      LLM_BASE_URL: 'https://api.example.com/v1',
      LLM_MODEL: 'gpt-prod',
    });

    expect(error).toBeDefined();
    expect(error?.details[0]?.message).toContain('CREDENTIALS_MASTER_KEY');
  });

  it('accepts explicit test-support enablement for QA stacks', () => {
    const { error, value } = envSchema.validate({
      DATABASE_PATH: './data/qa.sqlite',
      WORKSPACE_ROOT: './sessions/qa',
      NODE_ENV: 'production',
      CREDENTIALS_MASTER_KEY: 'qa-master-key-32-chars-minimum',
      LLM_API_KEY: 'qa-key',
      LLM_BASE_URL: 'https://api.example.com/v1',
      LLM_MODEL: 'gpt-qa',
      KALIO_ENABLE_TEST_SUPPORT: true,
    });

    expect(error).toBeUndefined();
    expect(value.KALIO_ENABLE_TEST_SUPPORT).toBe(true);
  });
});
