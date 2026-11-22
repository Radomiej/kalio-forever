import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDecisionProtectedFetcher } from './decision-protected-fetch';

afterEach(() => vi.unstubAllGlobals());
describe('desktop decision purpose allowlist', () => {
  it('preserves auth capability and query for tools/goals without forwarding browser secrets', async () => {
    vi.stubGlobal('location', { origin: 'http://tauri.localhost' });
    const token = 'a'.repeat(64);
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (url) => new Response(
      String(url).endsWith('/desktop-auth') ? JSON.stringify({ token }) : '{}', { status: 200 },
    ));
    const request = createDecisionProtectedFetcher(fetcher);
    await request('/api/decision/auth', { method: 'POST' });
    for (const purpose of ['tools', 'goals']) {
      await request(`/api/decision/config?purpose=${purpose}`, {
        method: 'PUT', body: '{}', headers: { Authorization: 'ignored', Cookie: 'ignored' },
      });
    }
    expect(fetcher.mock.calls.map(([url]) => url)).toEqual([
      'http://127.0.0.1:4516/api/decision/desktop-auth',
      'http://127.0.0.1:4516/api/decision/config?purpose=tools',
      'http://127.0.0.1:4516/api/decision/config?purpose=goals',
    ]);
    for (const [, init] of fetcher.mock.calls.slice(1)) {
      expect(init).toMatchObject({ credentials: 'omit', redirect: 'error', cache: 'no-store' });
      const headers = new Headers(init?.headers);
      expect(headers.get('x-kalio-decision-session')).toBe(token);
      expect(headers.has('Authorization')).toBe(false);
      expect(headers.has('Cookie')).toBe(false);
    }
  });
  it.each([
    '/api/decision/ollama/models', '/api/decision/ollama/install',
    '/api/decision/ollama/install/12345678-1234-1234-1234-123456789abc',
    '/api/decision/ollama/install/12345678-1234-1234-1234-123456789abc/cancel',
    '/api/decision/config?purpose=invalid', '/api/decision/config?purpose=tools&extra=1',
    '/api/decision/config?purpose=tools&purpose=goals', '/api/decision/auth?purpose=tools',
    '/api/hitl/config?purpose=tools', '/api/runtime/default-profile?purpose=goals',
  ])('rejects %s before sending capability', async (url) => {
    vi.stubGlobal('location', { origin: 'http://tauri.localhost' });
    const fetcher = vi.fn<typeof fetch>();
    await expect(createDecisionProtectedFetcher(fetcher)(url)).rejects.toThrow('Unsupported desktop protected route');
    expect(fetcher).not.toHaveBeenCalled();
  });
});
