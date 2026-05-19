import { describe, expect, it } from 'vitest';
import { envSchema } from './env.schema';

describe('envSchema', () => {
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
    expect(value.EMBEDDING_DIMENSIONS).toBe(1536);
  });

  it('fills mock LLM defaults in test mode', () => {
    const { error, value } = envSchema.validate({
      DATABASE_PATH: './data/test.sqlite',
      WORKSPACE_ROOT: './sessions/test',
      NODE_ENV: 'test',
    });

    expect(error).toBeUndefined();
    expect(value.LLM_API_KEY).toBe('mock');
    expect(value.LLM_BASE_URL).toBe('mock');
    expect(value.LLM_MODEL).toBe('mock');
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
});