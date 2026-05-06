import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WebSearchService } from './web-search.service';

function makeService(
  dbProvider: string | null,
  dbApiKey: string | null,
  envProvider = 'perplexity',
  envApiKey = '',
  webSearchTimeoutMs = 120_000,
) {
  const appSettings = {
    get: vi.fn().mockImplementation((key: string) => {
      if (key === 'search.provider') return Promise.resolve(dbProvider);
      if (key === 'search.api_key') return Promise.resolve(dbApiKey);
      return Promise.resolve(null);
    }),
  };
  const configService = {
    get: vi.fn().mockImplementation((key: string, def?: string) => {
      if (key === 'PERPLEXITY_PROVIDER') return envProvider;
      if (key === 'PERPLEXITY_API_KEY') return envApiKey;
      return def ?? '';
    }),
  };
  const timeoutSettings = {
    getWebSearchTimeoutMs: vi.fn().mockResolvedValue(webSearchTimeoutMs),
  };
  return new WebSearchService(configService as never, appSettings as never, timeoutSettings as never);
}

describe('WebSearchService', () => {
  describe('getConfig()', () => {
    it('returns stored DB provider and apiKey when set', async () => {
      const svc = makeService('perplexity-openrouter', 'db-api-key');
      const cfg = await svc.getConfig();
      expect(cfg.provider).toBe('perplexity-openrouter');
      expect(cfg.apiKey).toBe('db-api-key');
    });

    it('falls back to env provider when DB has none', async () => {
      const svc = makeService(null, null, 'perplexity', 'env-key');
      const cfg = await svc.getConfig();
      expect(cfg.provider).toBe('perplexity');
      expect(cfg.apiKey).toBe('env-key');
    });

    it('returns null apiKey when no key configured', async () => {
      const svc = makeService(null, null, 'perplexity', '');
      const cfg = await svc.getConfig();
      expect(cfg.apiKey).toBeNull();
    });

    it('returns null apiKey when DB key is empty string', async () => {
      const svc = makeService('perplexity', '', 'perplexity', '');
      const cfg = await svc.getConfig();
      expect(cfg.apiKey).toBeNull();
    });

    it('defaults to perplexity provider when nothing is set', async () => {
      const svc = makeService(null, null, undefined as unknown as string, '');
      const cfg = await svc.getConfig();
      expect(cfg.provider).toBe('perplexity');
    });
  });

  describe('search()', () => {
    let svc: WebSearchService;

    beforeEach(() => {
      svc = makeService('perplexity', 'test-api-key');
    });

    it('throws when no API key configured', async () => {
      const noKeySvc = makeService(null, null, 'perplexity', '');
      await expect(noKeySvc.search('test query')).rejects.toThrow(
        'Web search not configured',
      );
    });

    it('calls perplexity URL for perplexity provider', async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          choices: [{ message: { content: 'answer text' } }],
          citations: ['https://example.com'],
          model: 'sonar',
        }),
      });
      vi.stubGlobal('fetch', fetchMock);

      const result = await svc.search('what is TypeScript?');
      expect(result.answer).toBe('answer text');
      expect(result.citations).toEqual(['https://example.com']);
      expect(result.provider).toBe('perplexity');
      expect(fetchMock).toHaveBeenCalledWith(
        'https://api.perplexity.ai/chat/completions',
        expect.objectContaining({ method: 'POST' }),
      );
      vi.unstubAllGlobals();
    });

    it('calls openrouter URL for perplexity-openrouter provider', async () => {
      const svcOR = makeService('perplexity-openrouter', 'or-key');
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          choices: [{ message: { content: 'openrouter answer' } }],
          citations: [],
          model: 'perplexity/sonar',
        }),
      });
      vi.stubGlobal('fetch', fetchMock);

      const result = await svcOR.search('what is AI?');
      expect(result.provider).toBe('perplexity-openrouter');
      expect(fetchMock).toHaveBeenCalledWith(
        'https://openrouter.ai/api/v1/chat/completions',
        expect.anything(),
      );
      vi.unstubAllGlobals();
    });

    it('throws on non-ok HTTP response', async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        text: () => Promise.resolve('Unauthorized'),
      });
      vi.stubGlobal('fetch', fetchMock);

      await expect(svc.search('query')).rejects.toThrow('Search API error 401');
      vi.unstubAllGlobals();
    });

    it('returns empty answer and citations when response fields missing', async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ choices: [] }),
      });
      vi.stubGlobal('fetch', fetchMock);

      const result = await svc.search('query');
      expect(result.answer).toBe('');
      expect(result.citations).toEqual([]);
      vi.unstubAllGlobals();
    });

    it('uses configured web search timeout', async () => {
      const timeoutSpy = vi.spyOn(AbortSignal, 'timeout');
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          choices: [{ message: { content: 'answer text' } }],
          citations: [],
          model: 'sonar',
        }),
      });
      vi.stubGlobal('fetch', fetchMock);
      const timeoutSvc = makeService('perplexity', 'test-api-key', 'perplexity', '', 180_000);

      await timeoutSvc.search('long web query');

      expect(timeoutSpy).toHaveBeenCalledWith(180_000);
      vi.unstubAllGlobals();
      timeoutSpy.mockRestore();
    });
  });
});
