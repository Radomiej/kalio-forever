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

  describe('ingest()', () => {
    it('delegates to memoryService.ingest', async () => {
      const result = await controller.ingest({ text: 'hello world', personaId: 'p-1' });
      expect(memorySvc.ingest).toHaveBeenCalledWith('hello world', 'p-1', undefined);
      expect(result).toEqual({ id: 'mem-1', chunks: 1 });
    });
  });

  describe('ingestConversation()', () => {
    it('delegates to memoryService.ingestConversation', async () => {
      const msgs = [{ role: 'user' as const, content: 'hi' }];
      const result = await controller.ingestConversation({ messages: msgs, personaId: 'p-1' });
      expect(memorySvc.ingestConversation).toHaveBeenCalledWith(msgs, 'p-1');
      expect(result).toEqual({ id: 'mem-2', chunks: 2 });
    });
  });

  describe('search()', () => {
    it('defaults to hybridSearch', async () => {
      const result = await controller.search('query', 'p-1');
      expect(memorySvc.hybridSearch).toHaveBeenCalledWith('query', 'p-1', 5);
      expect(result).toHaveLength(1);
    });

    it('uses vector search when mode=vector', async () => {
      await controller.search('query', 'p-1', '10', 'vector');
      expect(memorySvc.search).toHaveBeenCalledWith('query', 'p-1', 10);
    });

    it('uses FTS search when mode=fts', async () => {
      await controller.search('query', 'p-1', '3', 'fts');
      expect(memorySvc.searchFTS).toHaveBeenCalledWith('query', 'p-1', 3);
    });
  });

  describe('getEmbeddingStatus()', () => {
    it('returns embedding service status', async () => {
      const result = await controller.getEmbeddingStatus();
      expect(memorySvc.getEmbeddingService).toHaveBeenCalled();
      expect(result).toEqual(mockStatus);
    });
  });

  describe('listEmbeddingCredentials()', () => {
    it('returns all embedding credentials', async () => {
      const result = await controller.listEmbeddingCredentials();
      expect(embeddingCreds.findAll).toHaveBeenCalled();
      expect(result).toEqual([]);
    });
  });

  describe('createEmbeddingCredential()', () => {
    it('creates and returns credential', async () => {
      const dto = {
        name: 'Test',
        provider: 'openai' as const,
        baseUrl: 'https://api.openai.com/v1',
        model: 'text-embedding-3-small',
        dimensions: 1536,
        apiKey: 'sk-key',
      };
      const result = await controller.createEmbeddingCredential(dto);
      expect(embeddingCreds.create).toHaveBeenCalledWith(dto);
      expect(result).toEqual({ id: 'ec-1', name: 'Test' });
    });
  });

  describe('setActiveEmbeddingCredential()', () => {
    it('sets active credential and reloads', async () => {
      const result = await controller.setActiveEmbeddingCredential('ec-1');
      expect(embeddingCreds.setActive).toHaveBeenCalledWith('ec-1');
      expect(memorySvc.getEmbeddingService().reloadFromCredential).toHaveBeenCalled();
      expect(result).toEqual(mockStatus);
    });
  });

  describe('clearActiveEmbeddingCredential()', () => {
    it('clears active credential and reloads', async () => {
      const result = await controller.clearActiveEmbeddingCredential();
      expect(embeddingCreds.clearActive).toHaveBeenCalled();
      expect(result).toEqual(mockStatus);
    });
  });

  describe('removeEmbeddingCredential()', () => {
    it('removes credential and reloads', async () => {
      const result = await controller.removeEmbeddingCredential('ec-1');
      expect(embeddingCreds.remove).toHaveBeenCalledWith('ec-1');
      expect(result).toEqual(mockStatus);
    });
  });

  describe('testEmbeddingCredential()', () => {
    it('throws NotFoundException when credential not found', async () => {
      embeddingCreds.getConfigById.mockResolvedValue(null);
      await expect(controller.testEmbeddingCredential('missing')).rejects.toThrow(NotFoundException);
    });
  });

  describe('getAll()', () => {
    it('returns all memories for a persona', async () => {
      const result = await controller.getAll('p-1');
      expect(memorySvc.getAll).toHaveBeenCalledWith('p-1');
      expect(result).toHaveLength(1);
    });
  });

  describe('deleteAll()', () => {
    it('deletes all memories for a persona', async () => {
      await controller.deleteAll('p-1');
      expect(memorySvc.deleteAll).toHaveBeenCalledWith('p-1');
    });
  });

  describe('delete()', () => {
    it('deletes a specific memory', async () => {
      const result = await controller.delete('p-1', 'mem-1');
      expect(memorySvc.delete).toHaveBeenCalledWith('mem-1', 'p-1');
      expect(result).toEqual({ deleted: true });
    });
  });
});
