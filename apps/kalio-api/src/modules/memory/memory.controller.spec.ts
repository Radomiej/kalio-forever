import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { MemoryController } from './memory.controller';

const mockStatus = { ready: true, model: 'text-embedding-3-small', dimensions: 1536 };

function makeMemoryService() {
  const embeddingServiceMock = {
    getStatus: vi.fn().mockResolvedValue(mockStatus),
    reloadFromCredential: vi.fn().mockResolvedValue(undefined),
  };
  return {
    ingest: vi.fn().mockResolvedValue({ id: 'mem-1', chunks: 1 }),
    ingestConversation: vi.fn().mockResolvedValue({ id: 'mem-2', chunks: 2 }),
    search: vi.fn().mockResolvedValue([{ id: 'mem-1', score: 0.9, text: 'test' }]),
    searchFTS: vi.fn().mockResolvedValue([{ id: 'mem-1', score: 1.0, text: 'test' }]),
    hybridSearch: vi.fn().mockResolvedValue([{ id: 'mem-1', score: 0.95, text: 'test' }]),
    searchWebResults: vi.fn().mockResolvedValue([{ id: 'web-1', score: 0.8, text: 'web' }]),
    getAllWebResults: vi.fn().mockResolvedValue([{ id: 'web-1', score: 1, text: 'web' }]),
    getSummary: vi.fn().mockReturnValue({
      totalCount: 2,
      totalSize: 8,
      webSearch: { id: 'web_search', label: 'Web search', count: 1, size: 3 },
      personas: [{ id: 'p-1', label: 'Default', count: 1, size: 5 }],
    }),
    getEmbeddingService: vi.fn().mockReturnValue(embeddingServiceMock),
    getAll: vi.fn().mockResolvedValue([{ id: 'mem-1', score: 1.0, text: 'text' }]),
    deleteAll: vi.fn().mockReturnValue(undefined),
    delete: vi.fn().mockReturnValue(true),
    _embedding: embeddingServiceMock,
  };
}

function makeEmbeddingCredentials() {
  return {
    findAll: vi.fn().mockResolvedValue([]),
    create: vi.fn().mockResolvedValue({ id: 'ec-1', name: 'Test' }),
    clearActive: vi.fn().mockResolvedValue(undefined),
    setActive: vi.fn().mockResolvedValue(undefined),
    remove: vi.fn().mockResolvedValue(undefined),
    getLocalConfig: vi.fn().mockImplementation(async (defaults) => defaults),
    getConfigById: vi.fn().mockResolvedValue({
      id: 'ec-1',
      apiKey: 'sk-key',
      baseUrl: 'https://api.openai.com/v1',
      model: 'text-embedding-3-small',
      dimensions: 1536,
    }),
  };
}

function makeConfigService() {
  return {
    get: vi.fn().mockImplementation((_key: string, def?: unknown) => def),
  };
}

function makeLocalEmbeddingInstall() {
  return {
    getAvailability: vi.fn().mockResolvedValue({
      status: 'ready',
      installed: true,
      model: 'Xenova/multilingual-e5-small',
      dimensions: 384,
      backend: 'cpu',
      message: 'Model installed and ready.',
    }),
    install: vi.fn().mockResolvedValue({
      status: 'installing',
      installed: false,
      model: 'Xenova/multilingual-e5-small',
      dimensions: 384,
      backend: 'cpu',
      message: 'Installing local model...',
    }),
  };
}

describe('MemoryController', () => {
  let controller: MemoryController;
  let memorySvc: ReturnType<typeof makeMemoryService>;
  let embeddingCreds: ReturnType<typeof makeEmbeddingCredentials>;
  let config: ReturnType<typeof makeConfigService>;
  let localInstall: ReturnType<typeof makeLocalEmbeddingInstall>;

  beforeEach(() => {
    memorySvc = makeMemoryService();
    embeddingCreds = makeEmbeddingCredentials();
    config = makeConfigService();
    localInstall = makeLocalEmbeddingInstall();
    controller = new MemoryController(memorySvc as never, embeddingCreds as never, config as never, localInstall as never);
  });

  describe('search()', () => {
    it('uses hybrid search with the default limit when mode is omitted', async () => {
      const result = await controller.search('query', 'p-1');
      expect(memorySvc.hybridSearch).toHaveBeenCalledWith('query', 'p-1', 5);
      expect(result).toEqual([{ id: 'mem-1', score: 0.95, text: 'test' }]);
    });

    it('routes vector and FTS modes to their dedicated search implementations', async () => {
      await controller.search('query', 'p-1', '10', 'vector');
      await controller.search('query', 'p-1', '3', 'fts');

      expect(memorySvc.search).toHaveBeenCalledWith('query', 'p-1', 10);
      expect(memorySvc.searchFTS).toHaveBeenCalledWith('query', 'p-1', 3);
    });
  });

  describe('summary()', () => {
    it('summarizes only persona scopes passed by the UI', () => {
      const result = controller.getSummary('p-1,p-2', 'Default,Web Research');

      expect(memorySvc.getSummary).toHaveBeenCalledWith([
        { id: 'p-1', name: 'Default' },
        { id: 'p-2', name: 'Web Research' },
      ]);
      expect(result.personas).toEqual([{ id: 'p-1', label: 'Default', count: 1, size: 5 }]);
    });
  });

  describe('getWebSearch()', () => {
    it('browses web search memories when no query is provided', async () => {
      const result = await controller.getWebSearch();

      expect(memorySvc.getAllWebResults).toHaveBeenCalled();
      expect(result).toEqual([{ id: 'web-1', score: 1, text: 'web' }]);
    });

    it('searches web memories when query is provided', async () => {
      const result = await controller.getWebSearch('rss', '7');

      expect(memorySvc.searchWebResults).toHaveBeenCalledWith('rss', 7);
      expect(result).toEqual([{ id: 'web-1', score: 0.8, text: 'web' }]);
    });

    it('falls back to the default limit when the UI sends an invalid web-search limit', async () => {
      await controller.getWebSearch('rss', 'abc');

      expect(memorySvc.searchWebResults).toHaveBeenCalledWith('rss', 20);
    });
  });

  describe('setActiveEmbeddingCredential()', () => {
    it('reloads embedding provider config before returning fresh status', async () => {
      const result = await controller.setActiveEmbeddingCredential('ec-1');
      expect(embeddingCreds.setActive).toHaveBeenCalledWith('ec-1');
      expect(memorySvc.getEmbeddingService().reloadFromCredential).toHaveBeenCalled();
      expect(result).toEqual(mockStatus);
    });
  });

  describe('local embedding install routes', () => {
    it('returns local availability for the persisted local config', async () => {
      const result = await controller.getLocalEmbeddingAvailability();

      expect(localInstall.getAvailability).toHaveBeenCalledWith(expect.objectContaining({
        model: 'Xenova/multilingual-e5-small',
        dimensions: 384,
        backend: 'cpu',
      }));
      expect(result).toMatchObject({
        status: 'ready',
        installed: true,
      });
    });

    it('starts an explicit local install for the current form config', async () => {
      const result = await controller.installLocalEmbeddingModel({
        enabled: true,
        model: 'Xenova/multilingual-e5-base',
        dimensions: 768,
        backend: 'cpu',
      });

      expect(localInstall.install).toHaveBeenCalledWith(expect.objectContaining({
        model: 'Xenova/multilingual-e5-base',
        dimensions: 768,
        backend: 'cpu',
      }));
      expect(result).toMatchObject({
        status: 'installing',
        installed: false,
      });
    });
  });

  describe('testEmbeddingCredential()', () => {
    it('throws NotFoundException when credential not found', async () => {
      embeddingCreds.getConfigById.mockResolvedValue(null);
      await expect(controller.testEmbeddingCredential('missing')).rejects.toThrow(NotFoundException);
    });
  });

  describe('delete()', () => {
    it('wraps the service deletion boolean in the HTTP response shape', async () => {
      const result = await controller.delete('p-1', 'mem-1');
      expect(memorySvc.delete).toHaveBeenCalledWith('mem-1', 'p-1');
      expect(result).toEqual({ deleted: true });
    });
  });
});
