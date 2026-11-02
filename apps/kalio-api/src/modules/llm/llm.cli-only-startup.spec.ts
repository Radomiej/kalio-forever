import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConfigService } from '@nestjs/config';
import { LLMService } from './llm.service';
import { CredentialsService } from '../credentials/credentials.service';
import { TimeoutSettingsService } from '../credentials/timeout-settings.service';
import { ProviderStreamLimiterService } from './provider-stream-limiter.service';
import { envSchema } from '../../config/env.schema';

function setup(env: Record<string, string | undefined> = {}) {
  const { error, value } = envSchema.validate({ DATABASE_PATH: './data/cli.sqlite', WORKSPACE_ROOT: './sessions', ...env });
  if (error) throw error;
  const credentials = {
    getActiveProviderConfig: vi.fn().mockResolvedValue(null),
    getEnvModelOverride: vi.fn().mockResolvedValue(null),
    getGenerationSettings: vi.fn().mockResolvedValue({ maxTokens: 4096 }),
    getModelsForProviderConfig: vi.fn().mockResolvedValue([]),
  };
  const timeouts = {
    getProviderMaxConcurrentStreams: vi.fn().mockResolvedValue(2),
    getProviderRequestTimeoutMs: vi.fn().mockResolvedValue(120000),
  };
  const service = new LLMService(new ConfigService(value), credentials as unknown as CredentialsService,
    timeouts as unknown as TimeoutSettingsService, new ProviderStreamLimiterService());
  const options = { sessionId: 'cli-only', messageId: 'message', onChunk: vi.fn() };
  return { service, credentials, options };
}

function mockCompletion() {
  const fetchMock = vi.fn().mockResolvedValue(new Response('data: [DONE]\n\n', {
    status: 200, headers: { 'Content-Type': 'text/event-stream' },
  }));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

afterEach(() => vi.unstubAllGlobals());

describe('CLI-only startup and deferred direct LLM configuration', () => {
  it('constructs and exposes settings without a key, mock, or network request', async () => {
    const fetchMock = vi.fn(); vi.stubGlobal('fetch', fetchMock);
    const { service, credentials } = setup();
    expect(await service.getConfig()).toMatchObject({ source: 'env', provider: 'openai', model: '', apiKey: '' });
    expect(await service.getActiveModels()).toEqual([]);
    expect(credentials.getModelsForProviderConfig).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects unconfigured direct use with actionable auth guidance before HTTP', async () => {
    const fetchMock = vi.fn(); vi.stubGlobal('fetch', fetchMock);
    const { service, options } = setup();
    await expect(service.streamChat([], [], options)).rejects.toMatchObject({ code: 'LLM_AUTH' });
    await expect(service.streamChat([], [], options)).rejects.toThrow('Settings or set LLM_API_KEY');
    expect(options.onChunk).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does not infer mock from an API-key placeholder', async () => {
    const { service, options } = setup({ LLM_API_KEY: 'mock', LLM_MODEL: 'real-model' });
    expect((await service.getConfig()).provider).toBe('openai');
    await expect(service.streamChat([], [], options)).rejects.toMatchObject({ code: 'LLM_AUTH' });
  });

  it('allows explicit mock without any direct credentials', async () => {
    const fetchMock = vi.fn(); vi.stubGlobal('fetch', fetchMock);
    const { service, options } = setup({ LLM_PROVIDER: 'mock' });
    expect((await service.getConfig()).provider).toBe('mock');
    await expect(service.streamChat([{ role: 'user', content: 'hello' }], [], options)).resolves.toEqual([]);
    expect(options.onChunk).toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('uses a saved DB credential before missing env credentials and reflects removal', async () => {
    const fetchMock = mockCompletion();
    const { service, credentials, options } = setup();
    credentials.getActiveProviderConfig.mockResolvedValue({ provider: 'openai', apiKey: 'db-key', model: 'db-model',
      baseUrl: 'https://provider.example/v1' });
    expect(await service.getConfig()).toMatchObject({ source: 'db', model: 'db-model', apiKey: '' });
    await expect(service.streamChat([], [], options)).resolves.toEqual([]);
    expect(fetchMock).toHaveBeenCalledWith('https://provider.example/v1/chat/completions', expect.objectContaining({
      headers: expect.objectContaining({ Authorization: 'Bearer db-key' }),
      body: expect.stringContaining('db-model'),
    }));
    credentials.getActiveProviderConfig.mockResolvedValue(null);
    await expect(service.streamChat([], [], options)).rejects.toMatchObject({ code: 'LLM_AUTH' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    { LLM_PROVIDER: 'ollama', LLM_MODEL: 'local-model' },
    { LLM_PROVIDER: 'bitnet', LLM_MODEL: 'local-model' },
    { LLM_PROVIDER: 'custom', LLM_MODEL: 'local-model', LLM_BASE_URL: 'http://localhost:1234/v1' },
    { LLM_PROVIDER: 'openai', LLM_MODEL: 'local-model', LLM_BASE_URL: 'http://127.0.0.1:1234/v1' },
  ])('allows no-auth local direct inference: %j', async env => {
    const fetchMock = mockCompletion();
    const { service, options } = setup(env);
    await expect(service.streamChat([], [], options)).resolves.toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(init.headers).not.toHaveProperty('Authorization');
  });

  it('reports a missing local model only on direct use', async () => {
    const { service, options } = setup({ LLM_PROVIDER: 'ollama' });
    expect(await service.getConfig()).toMatchObject({ provider: 'ollama', model: '' });
    await expect(service.streamChat([], [], options)).rejects.toThrow('LLM_MODEL');
  });

  it('defers an incomplete custom endpoint until direct use, allowing DB credentials to win', async () => {
    const { service, credentials, options } = setup({ LLM_PROVIDER: 'custom' });
    expect(await service.getConfig()).toMatchObject({ provider: 'custom' });
    credentials.getActiveProviderConfig.mockResolvedValue({ provider: 'mock', apiKey: '', model: '', baseUrl: '' });
    await expect(service.streamChat([], [], options)).resolves.toEqual([]);
  });
});
