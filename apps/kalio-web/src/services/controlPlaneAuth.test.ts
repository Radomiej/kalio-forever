import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { tauriInvoke, isTauri, browserFetch } = vi.hoisted(() => ({
  tauriInvoke: vi.fn(),
  isTauri: vi.fn(),
  browserFetch: vi.fn<typeof fetch>(),
}));

vi.mock('@tauri-apps/api/core', () => ({ invoke: tauriInvoke, isTauri }));

const API_BASE = 'http://127.0.0.1:3016';
const TOKEN = 'e'.repeat(64);

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  browserFetch.mockResolvedValue({ ok: true, status: 200 } as Response);
  vi.stubGlobal('fetch', browserFetch);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('control-plane browser authentication', () => {
  it('matches protected routes by exact API origin and path boundary', async () => {
    const { isControlPlaneRequest } = await import('./controlPlaneAuth');

    expect(isControlPlaneRequest(new URL(`${API_BASE}/api/credentials`), API_BASE)).toBe(true);
    expect(isControlPlaneRequest(new URL(`${API_BASE}/api/credentials-evil`), API_BASE)).toBe(false);
    expect(isControlPlaneRequest(new URL('https://untrusted.example/api/credentials'), API_BASE)).toBe(false);
    expect(isControlPlaneRequest(new URL(`${API_BASE}/api/mcp/servers`), API_BASE)).toBe(true);
    expect(isControlPlaneRequest(new URL(`${API_BASE}/api/llm/active/model`), API_BASE)).toBe(true);
    expect(isControlPlaneRequest(new URL(`${API_BASE}/api/tools/fs_read`), API_BASE)).toBe(true);
    expect(isControlPlaneRequest(new URL(`${API_BASE}/api/mcp/bridge`), API_BASE)).toBe(false);
  });

  it('adds the native token to the shared Axios client and direct fetch transport', async () => {
    isTauri.mockReturnValue(true);
    tauriInvoke.mockResolvedValue(TOKEN);

    const { apiClient } = await import('./apiClient');
    apiClient.defaults.baseURL = API_BASE;
    const axiosResponse = await apiClient.get('/api/credentials', {
      adapter: async (config) => ({
        data: [],
        status: 200,
        statusText: 'OK',
        headers: {},
        config,
      }),
    });
    expect(axiosResponse.config.headers.get('Authorization')).toBe(`Bearer ${TOKEN}`);

    const { controlPlaneFetch } = await import('./controlPlaneFetch');
    await controlPlaneFetch('/api/allowed-paths');
    const requestInit = browserFetch.mock.calls[0]?.[1] as RequestInit | undefined;
    expect(new Headers(requestInit?.headers).get('Authorization')).toBe(`Bearer ${TOKEN}`);
    expect(requestInit?.credentials).toBe('include');
  });

  it('does not request or attach the native credential to other origins', async () => {
    isTauri.mockReturnValue(true);

    const { controlPlaneFetch } = await import('./controlPlaneFetch');
    await controlPlaneFetch('https://untrusted.example/api/credentials');

    expect(tauriInvoke).not.toHaveBeenCalled();
    const requestInit = browserFetch.mock.calls[0]?.[1] as RequestInit | undefined;
    expect(new Headers(requestInit?.headers).has('Authorization')).toBe(false);
  });

  it('does not request a desktop token in browser-only mode', async () => {
    isTauri.mockReturnValue(false);

    const { controlPlaneFetch } = await import('./controlPlaneFetch');
    await controlPlaneFetch('/api/credentials');

    expect(tauriInvoke).not.toHaveBeenCalled();
    const requestInit = browserFetch.mock.calls[0]?.[1] as RequestInit | undefined;
    expect(new Headers(requestInit?.headers).has('Authorization')).toBe(false);
  });
});
