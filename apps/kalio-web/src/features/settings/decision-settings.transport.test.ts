import { describe, expect, it, vi } from 'vitest';
import { createDecisionSettingsRequest, createDecisionSettingsTransport } from './decision-settings.transport';

const config = { provider: 'openrouter' as const, model: 'typesafe/jev-1.13', credentialId: null, endpoint: '' };
const response = (status: number, body: unknown = config) => new Response(status === 204 ? null : JSON.stringify(body), { status });

describe('scoped Decision transport', () => {
  it('supports only the exact model manager route and method pairs', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response(200, {}));
    const request = createDecisionSettingsRequest(fetcher);
    const job = '12345678-1234-1234-1234-123456789abc';
    await request('/api/decision/ollama/models');
    await request('/api/decision/ollama/install', { method: 'PUT', body: JSON.stringify({ modelTag: 'qwen3.5:2b-q4_K_M', requestId: 'request-a' }) });
    await request(`/api/decision/ollama/install/${job}`);
    await request(`/api/decision/ollama/install/${job}/cancel`, { method: 'PUT', body: '{}' });
    expect(fetcher).toHaveBeenCalledTimes(4);
    for (const [path, method] of [
      ['/api/decision/ollama/models', 'PUT'], ['/api/decision/ollama/install', 'GET'],
      [`/api/decision/ollama/install/${job}`, 'PUT'], [`/api/decision/ollama/install/${job}/cancel`, 'GET'],
      ['/api/decision/ollama/models?extra=1', 'GET'], ['/api/decision/ollama/install/not-a-job', 'GET'],
      [`/api/decision/ollama/install/${job}/cancel/extra`, 'PUT'],
    ]) {
      // @ts-expect-error runtime boundary deliberately includes unsupported routes
      await expect(request(path, { method })).rejects.toThrow(/Unsupported settings/);
    }
    expect(fetcher).toHaveBeenCalledTimes(4);
  });
  it('bootstraps once on explicit 401 and retries with same-origin cookies', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(response(401))
      .mockResolvedValueOnce(response(204)).mockResolvedValueOnce(response(200));
    expect(await createDecisionSettingsTransport(fetcher).getConfig()).toEqual(config);
    expect(fetcher.mock.calls.map(([url]) => url)).toEqual(['/api/decision/config', '/api/decision/auth', '/api/decision/config']);
    for (const [, options] of fetcher.mock.calls) expect(options).toMatchObject({ credentials: 'same-origin', redirect: 'error', cache: 'no-store' });
    expect(fetcher.mock.calls[1][1]).toMatchObject({ method: 'POST', body: '{}' });
  });

  it('writes exact config and supports the protected HITL route', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response(200));
    expect(await createDecisionSettingsTransport(fetcher).updateConfig(config)).toEqual(config);
    expect(fetcher.mock.calls[0][1]).toMatchObject({ method: 'PUT', body: JSON.stringify(config) });
    const request = createDecisionSettingsRequest(fetcher);
    await request('/api/hitl/config');
    expect(fetcher.mock.calls[1][0]).toBe('/api/hitl/config');
    await request('/api/runtime/default-profile');
    expect(fetcher.mock.calls[2][0]).toBe('/api/runtime/default-profile');
  });

  it.each([403, 500])('does not bootstrap or replay status %s', async (status) => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response(status));
    await expect(createDecisionSettingsTransport(fetcher).updateConfig(config)).rejects.toThrow();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('stops after cookies remain blocked and never stores a browser secret', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(response(401))
      .mockResolvedValueOnce(response(204)).mockResolvedValueOnce(response(401));
    await expect(createDecisionSettingsTransport(fetcher).getConfig()).rejects.toThrow();
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(fetcher.mock.calls[0][1]?.headers).toBeInstanceOf(Headers);
    expect((fetcher.mock.calls[0][1]?.headers as Headers).has('Authorization')).toBe(false);
  });

  it('never retries an ambiguous network write failure', async () => {
    const fetcher = vi.fn<typeof fetch>().mockRejectedValue(new Error('connection reset'));
    await expect(createDecisionSettingsTransport(fetcher).updateConfig(config)).rejects.toThrow('connection reset');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});

it('keeps omitted purpose legacy URL and isolates explicit tools and goals reads/writes', async () => {
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => response(200));
  const transport = createDecisionSettingsTransport(fetcher);
  for (const purpose of [undefined, 'tools', 'goals'] as const) {
    await transport.getConfig(purpose); await transport.updateConfig(config, purpose);
  }
  expect(fetcher.mock.calls.map(([url]) => url)).toEqual([
    '/api/decision/config', '/api/decision/config',
    '/api/decision/config?purpose=tools', '/api/decision/config?purpose=tools',
    '/api/decision/config?purpose=goals', '/api/decision/config?purpose=goals',
  ]);
});

it.each(['/api/decision/config?purpose=other', '/api/decision/config?purpose=tools&extra=1', '/api/hitl/config?purpose=tools', '/api/decision/auth?purpose=tools'])(
  'rejects unsupported query %s before fetch', async (path) => {
    const fetcher = vi.fn<typeof fetch>();
    // @ts-expect-error exercise invalid runtime input at the request boundary
    await expect(createDecisionSettingsRequest(fetcher)(path)).rejects.toThrow('Unsupported settings route');
    expect(fetcher).not.toHaveBeenCalled();
  },
);
