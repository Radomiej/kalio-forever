import type { Credential } from '@kalio/types';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  apiFetch,
  buildActiveRuntimeConfig,
  emptyForm,
  normalizeOptionalText,
  normalizeProviderName,
  readResponseErrorMessage,
} from './llm-panel.utils';

describe('llm-panel.utils', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('normalizes form defaults and runtime config display names', () => {
    const activeCredential: Credential = {
      id: 'cred-1',
      name: 'My Local',
      provider: 'bitnet',
      model: 'bitnet-b1.58-2b-4t',
      baseUrl: 'http://localhost:8080/v1',
      createdAt: 1,
    };

    expect(emptyForm()).toMatchObject({
      name: 'OpenAI',
      provider: 'openai',
      apiKey: '',
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-4o-mini',
      nameEdited: false,
    });
    expect(normalizeOptionalText('  hello ')).toBe('hello');
    expect(normalizeOptionalText('   ')).toBeUndefined();
    expect(normalizeProviderName('  ', 'deepseek')).toBe('DeepSeek');
    expect(normalizeProviderName('Custom name', 'deepseek')).toBe('Custom name');
    expect(buildActiveRuntimeConfig(activeCredential, null)).toMatchObject({
      source: 'db',
      provider: 'bitnet',
      model: 'bitnet-b1.58-2b-4t',
      baseUrl: 'http://localhost:8080/v1',
      displayName: 'My Local',
      credentialId: 'cred-1',
    });
    expect(buildActiveRuntimeConfig(null, {
      source: 'env',
      provider: 'xiaomimimo',
      model: 'mimo-v2.5-pro',
      baseUrl: 'https://token-plan-ams.xiaomimimo.com/v1',
      contextWindowSize: 32000,
      maxToolAttempts: 8,
    })).toMatchObject({
      source: 'env',
      provider: 'xiaomimimo',
      displayName: 'Xiaomi MiMo',
    });
    expect(buildActiveRuntimeConfig(null, null)).toBeNull();
  });

  it('fetches through the /api prefix and preserves GET vs POST cache behavior', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ value: 1 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(apiFetch<{ value: number }>('/thing')).resolves.toEqual({ value: 1 });
    await expect(apiFetch('/submit', { method: 'POST' })).resolves.toBeUndefined();

    expect(fetchMock).toHaveBeenNthCalledWith(1, '/api/thing', expect.objectContaining({
      headers: { 'Content-Type': 'application/json' },
      cache: 'no-store',
    }));
    expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/submit', expect.objectContaining({
      headers: { 'Content-Type': 'application/json' },
    }));
  });

  it('returns readable messages from API responses', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    expect(await readResponseErrorMessage(new Response('oops', {
      status: 502,
      statusText: 'Bad Gateway',
    }), 'context')).toBe('HTTP 502: oops');

    expect(await readResponseErrorMessage(new Response(null, {
      status: 404,
      statusText: 'Not Found',
    }), 'context')).toBe('HTTP 404: Not Found');

    expect(await readResponseErrorMessage(new Response(JSON.stringify({ error: 'denied' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    }), 'context')).toBe('denied');

    expect(await readResponseErrorMessage(new Response('{', {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    }), 'context')).toBe('HTTP 500: {');
    expect(errorSpy).toHaveBeenCalled();
  });
});
