import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDecisionSettingsTransport } from './decision-settings.transport';
import { createProjectContextTransport } from './project-context.transport';

afterEach(() => vi.unstubAllGlobals());
const token = 'a'.repeat(64);
const reply = (body: unknown = {}, status = 200) => new Response(JSON.stringify(body), { status });

describe('desktop protected settings transport', () => {
  it.each(['http://tauri.localhost', 'tauri://localhost'])('authenticates settings and project context at the fixed backend from %s', async origin => {
    vi.stubGlobal('location', new URL(origin));
    await Promise.all([createDecisionSettingsTransport, createProjectContextTransport].map(async create => {
      const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(reply({}, 401))
        .mockResolvedValueOnce(reply({ token })).mockResolvedValueOnce(reply({ enabled: true }));
      const transport = create(fetcher);
      if ('getConfig' in transport) await transport.getConfig(); else await transport.getSettings();
      expect(fetcher.mock.calls[1][0]).toBe('http://127.0.0.1:4516/api/decision/desktop-auth');
      for (const [url, options] of fetcher.mock.calls) {
        expect(String(url)).toMatch(/^http:\/\/127\.0\.0\.1:4516\/api\//);
        expect(options).toMatchObject({ credentials: 'omit', redirect: 'error', cache: 'no-store' });
        expect(new Headers(options?.headers).has('Authorization')).toBe(false);
      }
      expect(new Headers(fetcher.mock.calls[2][1]?.headers).get('x-kalio-decision-session')).toBe(token);
    }));
  });

  it('rebootstraps only on explicit expiry and never replays an ambiguous desktop write', async () => {
    vi.stubGlobal('location', new URL('http://tauri.localhost'));
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(reply({}, 401)).mockResolvedValueOnce(reply({ token })).mockResolvedValueOnce(reply())
      .mockResolvedValueOnce(reply({}, 401)).mockResolvedValueOnce(reply({ token: 'b'.repeat(64) })).mockResolvedValueOnce(reply())
      .mockRejectedValueOnce(new Error('connection lost'));
    const transport = createProjectContextTransport(fetcher);
    await transport.saveSettings({ enabled: true });
    await transport.saveSettings({ enabled: false });
    expect(new Headers(fetcher.mock.calls[5][1]?.headers).get('x-kalio-decision-session')).toBe('b'.repeat(64));
    await expect(transport.refresh('project')).rejects.toThrow('connection lost');
    expect(fetcher).toHaveBeenCalledTimes(7);
  });

  it.each([403, 500])('never replays a desktop state-changing response %s', async status => {
    vi.stubGlobal('location', new URL('http://tauri.localhost'));
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(reply({}, status));
    await expect(createProjectContextTransport(fetcher).refresh('project')).rejects.toThrow();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
