import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SearchController } from './search.controller';

function makeWebSearch(config = { provider: 'perplexity' as const, apiKey: 'sk-test1234' }) {
  return {
    getConfig: vi.fn().mockResolvedValue(config),
    search: vi.fn().mockResolvedValue('some results'),
  };
}

function makeAppSettings() {
  return {
    set: vi.fn().mockResolvedValue(undefined),
  };
}

describe('SearchController', () => {
  let controller: SearchController;
  let webSearch: ReturnType<typeof makeWebSearch>;
  let appSettings: ReturnType<typeof makeAppSettings>;

  beforeEach(() => {
    webSearch = makeWebSearch();
    appSettings = makeAppSettings();
    controller = new SearchController(webSearch as never, appSettings as never);
  });

  describe('getConfig()', () => {
    it('returns provider with masked api key', async () => {
      const result = await controller.getConfig();
      expect(result.provider).toBe('perplexity');
      expect(result.configured).toBe(true);
      expect(result.apiKeyMasked).toMatch(/^sk-test/);
    });

    it('returns configured=false when no api key', async () => {
      webSearch.getConfig.mockResolvedValue({ provider: 'perplexity', apiKey: null });
      const result = await controller.getConfig();
      expect(result.configured).toBe(false);
      expect(result.apiKeyMasked).toBeNull();
    });
  });

  describe('setConfig()', () => {
    it('saves provider and apiKey then returns config', async () => {
      const result = await controller.setConfig({ provider: 'perplexity', apiKey: 'sk-newkey' });
      expect(appSettings.set).toHaveBeenCalledWith('search.provider', 'perplexity');
      expect(appSettings.set).toHaveBeenCalledWith('search.api_key', 'sk-newkey');
      expect(result.provider).toBe('perplexity');
    });

    it('only saves provider when no apiKey provided', async () => {
      await controller.setConfig({ provider: 'perplexity' });
      expect(appSettings.set).toHaveBeenCalledTimes(1);
      expect(appSettings.set).toHaveBeenCalledWith('search.provider', 'perplexity');
    });
  });

  describe('testConnection()', () => {
    it('returns ok=true when search succeeds', async () => {
      const result = await controller.testConnection();
      expect(webSearch.search).toHaveBeenCalled();
      expect(result).toEqual({ ok: true });
    });

    it('returns ok=false when search throws', async () => {
      webSearch.search.mockRejectedValue(new Error('API error'));
      const result = await controller.testConnection();
      expect(result).toEqual({ ok: false, error: 'API error' });
    });

    it('handles non-Error exceptions', async () => {
      webSearch.search.mockRejectedValue('string error');
      const result = await controller.testConnection();
      expect(result).toEqual({ ok: false, error: 'string error' });
    });
  });
});
