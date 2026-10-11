import { describe, expect, it, vi } from 'vitest';
import { createProjectContextRequest, createProjectContextTransport } from './project-context.transport';

const reply = (body: unknown = {}, status = 200) => new Response(JSON.stringify(body), { status });

describe('project context transport', () => {
  it('uses exact cookie auth routes and payloads without persisting consent', async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => reply());
    const transport = createProjectContextTransport(fetcher);
    await transport.getSettings(); await transport.getProjects(); await transport.getStatus('project-1');
    await transport.saveSettings({ enabled: true });
    await transport.refresh('project-1'); await transport.search('project-1', 'secret query');
    await transport.refresh('project-1', true); await transport.search('project-1', 'remote', true);
    await transport.refresh('project-1');
    expect(fetcher.mock.calls.map(([path]) => path)).toEqual([
      '/api/memory/project-context/settings', '/api/projects', '/api/memory/project-resources/project-1/status',
      '/api/memory/project-context/settings', '/api/memory/project-resources/project-1/index',
      '/api/memory/project-resources/project-1/search', '/api/memory/project-resources/project-1/index',
      '/api/memory/project-resources/project-1/search', '/api/memory/project-resources/project-1/index',
    ]);
    for (const [, options] of fetcher.mock.calls) {
      expect(options).toMatchObject({ credentials: 'same-origin', redirect: 'error', cache: 'no-store' });
    }
    expect(fetcher.mock.calls[3][1]?.body).toBe('{"enabled":true}');
    expect(fetcher.mock.calls[4][1]?.body).toBe('{}');
    expect(fetcher.mock.calls[5][1]?.body).toBe('{"query":"secret query","mode":"hybrid"}');
    expect(fetcher.mock.calls[6][1]?.body).toBe('{"allowRemoteProcessing":true}');
    expect(fetcher.mock.calls[7][1]?.body).toBe('{"query":"remote","mode":"hybrid","allowRemoteProcessing":true}');
    expect(fetcher.mock.calls[8][1]?.body).toBe('{}');
  });

  it('bootstraps once after 401 and retries with cookies and no Authorization', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(reply({}, 401)).mockResolvedValueOnce(reply()).mockResolvedValueOnce(reply());
    await createProjectContextRequest(fetcher)('/api/memory/project-context/settings', {
      method: 'PUT', body: '{}', credentials: 'omit', headers: { Authorization: 'Bearer wrong' },
    });
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(fetcher.mock.calls[1]).toEqual(['/api/decision/auth', expect.objectContaining({ method: 'POST', body: '{}', credentials: 'same-origin' })]);
    expect(fetcher.mock.calls[2][1]?.headers).toBeInstanceOf(Headers);
    expect(new Headers(fetcher.mock.calls[2][1]?.headers).has('Authorization')).toBe(false);
  });

  it('never loops when the retry remains unauthorized', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(reply({}, 401)).mockResolvedValueOnce(reply()).mockResolvedValueOnce(reply({}, 401));
    await expect(createProjectContextTransport(fetcher).getSettings()).rejects.toThrow('401');
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it.each([403, 409, 500, 503])('does not replay %s failures', async status => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(reply({ code: 'FAILURE' }, status));
    await expect(createProjectContextTransport(fetcher).refresh('p')).rejects.toThrow('FAILURE');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('explains an oversized query without repeating the failed request', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(reply({ code: 'EMBEDDING_INPUT_TOO_LONG' }, 400));
    await expect(createProjectContextTransport(fetcher).search('p', 'long')).rejects.toThrow('Use a shorter query');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('does not replay network failure or failed bootstrap', async () => {
    const network = vi.fn<typeof fetch>().mockRejectedValue(new Error('offline'));
    await expect(createProjectContextTransport(network).refresh('p')).rejects.toThrow('offline');
    expect(network).toHaveBeenCalledTimes(1);
    const rejectedAuth = vi.fn<typeof fetch>().mockResolvedValueOnce(reply({}, 401)).mockResolvedValueOnce(reply({}, 403));
    await expect(createProjectContextTransport(rejectedAuth).refresh('p')).rejects.toThrow('403');
    expect(rejectedAuth).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['/api/memory/embedding-local', 'PUT'], ['/api/decision/config', 'GET'], ['/api/projects', 'PUT'],
    ['/api/memory/project-resources/p/index', 'POST'], ['/api/memory/project-resources/p/status', 'PUT'],
    ['/api/memory/project-resources/p/search?query=secret', 'PUT'], ['/api/memory/project-resources/../search', 'PUT'],
    ['https://evil.test/api/projects', 'GET'], ['/api/memory/project-context/settings/', 'GET'],
  ])('rejects non-allowlisted %s %s before fetching', async (path, method) => {
    const fetcher = vi.fn<typeof fetch>();
    await expect(createProjectContextRequest(fetcher)(path, { method })).rejects.toThrow('Unsupported');
    expect(fetcher).not.toHaveBeenCalled();
  });
});
