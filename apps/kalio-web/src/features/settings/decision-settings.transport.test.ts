import { describe, expect, it, vi } from 'vitest';
import { createDecisionSettingsRequest, createDecisionSettingsTransport } from './decision-settings.transport';

const config = { provider: 'openrouter' as const, model: 'typesafe/jev-1.13', credentialId: null, endpoint: '' };
const response = (status: number, body: unknown = config) => new Response(status === 204 ? null : JSON.stringify(body), { status });

describe('scoped Decision transport', () => {
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
