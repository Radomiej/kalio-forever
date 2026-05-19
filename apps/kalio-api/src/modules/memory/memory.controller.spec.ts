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
    getConfigById: vi.fn().mockResolvedValue({
      id: 'ec-1',
      apiKey: 'sk-key',
      baseUrl: 'https://api.openai.com/v1',
      model: 'text-embedding-3-small',
      dimensions: 1536,
    }),
  };
}

describe('MemoryController', () => {
  let controller: MemoryController;
  let memorySvc: ReturnType<typeof makeMemoryService>;
  let embeddingCreds: ReturnType<typeof makeEmbeddingCredentials>;

  beforeEach(() => {
    memorySvc = makeMemoryService();
    embeddingCreds = makeEmbeddingCredentials();
    controller = new MemoryController(memorySvc as never, embeddingCreds as never);
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

  describe('setActiveEmbeddingCredential()', () => {
    it('reloads embedding provider config before returning fresh status', async () => {
      const result = await controller.setActiveEmbeddingCredential('ec-1');
      expect(embeddingCreds.setActive).toHaveBeenCalledWith('ec-1');
      expect(memorySvc.getEmbeddingService().reloadFromCredential).toHaveBeenCalled();
      expect(result).toEqual(mockStatus);
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
