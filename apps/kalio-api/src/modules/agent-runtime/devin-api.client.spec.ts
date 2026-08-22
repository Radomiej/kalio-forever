import { afterEach, describe, expect, it, vi } from 'vitest';
import { DevinApiClient, DevinApiError } from './devin-api.client';

const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
  vi.restoreAllMocks();
});

describe('DevinApiClient', () => {
  it('reports only safe configuration metadata', () => {
    process.env['DEVIN_API_KEY'] = 'cog_secret-value';
    process.env['DEVIN_ORG_ID'] = 'org-123456789';
    process.env['DEVIN_MAX_ACU_LIMIT'] = '3';

    expect(new DevinApiClient().getIntegrationStatus()).toEqual({
      configured: true,
      organizationId: 'org-…6789',
      maxAcuLimit: 3,
    });
  });

  it('creates a bounded session without bypassing Devin approval or forwarding local context', async () => {
    process.env['NODE_ENV'] = 'test';
    process.env['DEVIN_API_KEY'] = 'cog_secret-value';
    process.env['DEVIN_ORG_ID'] = 'org-123456789';
    process.env['DEVIN_MAX_ACU_LIMIT'] = '4';
    process.env['DEVIN_API_BASE_URL'] = 'https://devin.test';
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ session_id: 'devin-1', status: 'new', url: 'https://app.devin.ai/sessions/devin-1' }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(new DevinApiClient().createSession('USER:\nInspect the issue.')).resolves.toMatchObject({ sessionId: 'devin-1', status: 'new' });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://devin.test/v3/organizations/org-123456789/sessions');
    expect(init.headers).toMatchObject({ Authorization: 'Bearer cog_secret-value', 'Content-Type': 'application/json' });
    expect(JSON.parse(String(init.body))).toEqual({ prompt: 'USER:\nInspect the issue.', bypass_approval: false, max_acu_limit: 4 });
  });

  it('redacts the API key from upstream errors', async () => {
    process.env['DEVIN_API_KEY'] = 'cog_secret-value';
    process.env['DEVIN_ORG_ID'] = 'org-123456789';
    process.env['DEVIN_MAX_ACU_LIMIT'] = '1';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ detail: 'token cog_secret-value rejected' }), { status: 401 })));

    await expect(new DevinApiClient().getSession('devin-1')).rejects.toEqual(expect.objectContaining<Partial<DevinApiError>>({
      name: 'DevinApiError',
      status: 401,
      message: 'token [REDACTED] rejected',
    }));
  });
});
