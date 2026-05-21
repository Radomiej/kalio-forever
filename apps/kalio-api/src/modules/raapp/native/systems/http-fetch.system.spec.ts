import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NativeSystemRegistry } from '../native-system-registry.service';
import { HttpFetchSystem } from './http-fetch.system';

describe('HttpFetchSystem', () => {
  let registry: NativeSystemRegistry;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    registry = new NativeSystemRegistry();
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    new HttpFetchSystem(registry).onModuleInit();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('registers http_fetch as a non-approval read-only native system', () => {
    expect(registry.getAll()).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'http_fetch', approval_required: false }),
    ]));
  });

  it('executes public GET requests and keeps only string headers', async () => {
    fetchMock.mockResolvedValue(new Response('ok', { status: 200 }));

    const response = await registry.execute(
      'http_fetch',
      {
        url: 'https://example.com/api',
        headers: {
          Authorization: 'Bearer token',
          ignored: 123,
        },
      },
      { sessionId: 'session-1' },
    );

    expect(fetchMock).toHaveBeenCalledWith('https://example.com/api', expect.objectContaining({
      method: 'GET',
      redirect: 'manual',
      headers: { Authorization: 'Bearer token' },
      signal: expect.any(AbortSignal),
    }));
    expect(response).toEqual({
      result: {
        url: 'https://example.com/api',
        status: 200,
        ok: true,
        content: 'ok',
        truncated: false,
      },
      approval_required: false,
    });
  });

  it('blocks private input URLs before fetch is called', async () => {
    await expect(
      registry.execute('http_fetch', { url: 'http://127.0.0.1/admin' }, { sessionId: 'session-1' }),
    ).rejects.toThrow('private/internal URLs are not allowed');

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('blocks redirects to private URLs', async () => {
    fetchMock.mockResolvedValue(new Response('', {
      status: 302,
      headers: { Location: 'http://127.0.0.1/secret' },
    }));

    await expect(
      registry.execute('http_fetch', { url: 'https://example.com/redirect' }, { sessionId: 'session-1' }),
    ).rejects.toThrow('redirect to private/internal URL blocked');
  });

  it('truncates large responses for graph/tool safety', async () => {
    fetchMock.mockResolvedValue(new Response('x'.repeat(10005), { status: 200 }));

    const response = await registry.execute('http_fetch', { url: 'https://example.com/large' }, { sessionId: 'session-1' });

    expect(response.result).toMatchObject({
      url: 'https://example.com/large',
      status: 200,
      ok: true,
      truncated: true,
    });
    expect((response.result as { content: string }).content).toHaveLength(10000);
  });
});
