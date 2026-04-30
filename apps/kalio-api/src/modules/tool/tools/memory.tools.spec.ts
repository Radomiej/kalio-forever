import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemoryIngestTool, MemorySearchTool, MemoryIngestConversationTool } from './memory.tools';
import type { MemoryService } from '../../memory/memory.service';
import type { DrizzleService } from '../../../database/drizzle.service';
import type { ToolCallRequest } from '@kalio/types';

function makeRequest(toolName: string, args: Record<string, unknown> = {}, sessionId = 'sess-mem'): ToolCallRequest {
  return { callId: 'call-1', sessionId, toolName, args };
}

/** Creates a mock DrizzleService whose session lookup returns the given personaId. */
function makeDrizzleMock(personaId = 'persona-1'): DrizzleService {
  const mockGet = vi.fn().mockReturnValue({ personaId });
  const mockWhere = vi.fn().mockReturnValue({ get: mockGet });
  const mockFrom = vi.fn().mockReturnValue({ where: mockWhere });
  const mockSelect = vi.fn().mockReturnValue({ from: mockFrom });
  return { db: { select: mockSelect } } as unknown as DrizzleService;
}

/** Creates a mock DrizzleService that returns no session row (session not found). */
function makeDrizzleNoSessionMock(): DrizzleService {
  const mockGet = vi.fn().mockReturnValue(undefined);
  const mockWhere = vi.fn().mockReturnValue({ get: mockGet });
  const mockFrom = vi.fn().mockReturnValue({ where: mockWhere });
  const mockSelect = vi.fn().mockReturnValue({ from: mockFrom });
  return { db: { select: mockSelect } } as unknown as DrizzleService;
}

// �� MemoryIngestTool ����������������������������������������������������������

describe('MemoryIngestTool', () => {
  let tool: MemoryIngestTool;
  let memory: Partial<MemoryService>;

  beforeEach(() => {
    memory = { ingest: vi.fn() };
    tool = new MemoryIngestTool(memory as MemoryService, makeDrizzleMock('persona-1'));
  });

  describe('positive scenarios', () => {
    it('calls memory.ingest with session-resolved personaId and returns result', async () => {
      (memory.ingest as ReturnType<typeof vi.fn>).mockResolvedValue({ ids: ['a'], count: 1 });

      const result = await tool.execute(makeRequest('memory_ingest', { text: 'some knowledge' }));

      expect(memory.ingest).toHaveBeenCalledWith('some knowledge', 'persona-1', {});
      expect(result).toEqual({ ids: ['a'], count: 1 });
    });

    it('passes metadata to memory.ingest when provided', async () => {
      (memory.ingest as ReturnType<typeof vi.fn>).mockResolvedValue({ ids: ['b'], count: 1 });

      await tool.execute(
        makeRequest('memory_ingest', { text: 'fact', metadata: { source: 'web', topic: 'ai' } }),
      );

      expect(memory.ingest).toHaveBeenCalledWith('fact', 'persona-1', { source: 'web', topic: 'ai' });
    });

    it('ignores any personaId arg from LLM � always uses session-resolved value', async () => {
      (memory.ingest as ReturnType<typeof vi.fn>).mockResolvedValue({ ids: ['c'], count: 1 });

      await tool.execute(makeRequest('memory_ingest', { text: 'fact', personaId: 'user' }));

      expect(memory.ingest).toHaveBeenCalledWith('fact', 'persona-1', {});
    });
  });

  describe('edge cases', () => {
    it('defaults metadata to empty object when not provided', async () => {
      (memory.ingest as ReturnType<typeof vi.fn>).mockResolvedValue({ ids: [], count: 2 });

      await tool.execute(makeRequest('memory_ingest', { text: 'text' }));

      expect(memory.ingest).toHaveBeenCalledWith('text', 'persona-1', {});
    });

    it('handles large text without truncation', async () => {
      const bigText = 'x'.repeat(10_000);
      (memory.ingest as ReturnType<typeof vi.fn>).mockResolvedValue({ ids: [], count: 10 });

      await tool.execute(makeRequest('memory_ingest', { text: bigText }));

      expect(memory.ingest).toHaveBeenCalledWith(bigText, 'persona-1', {});
    });
  });

  describe('negative scenarios', () => {
    it('propagates error when memory.ingest throws', async () => {
      (memory.ingest as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('EMBED_FAILED'));

      await expect(tool.execute(makeRequest('memory_ingest', { text: 'x' }))).rejects.toThrow('EMBED_FAILED');
    });

    it('throws when session is not found in DB', async () => {
      const toolNoSession = new MemoryIngestTool(memory as MemoryService, makeDrizzleNoSessionMock());

      await expect(toolNoSession.execute(makeRequest('memory_ingest', { text: 'x' }))).rejects.toThrow('not found');
    });
  });
});

// �� MemorySearchTool ����������������������������������������������������������

describe('MemorySearchTool', () => {
  let tool: MemorySearchTool;
  let memory: Partial<MemoryService>;

  beforeEach(() => {
    memory = { search: vi.fn() };
    tool = new MemorySearchTool(memory as MemoryService, makeDrizzleMock('persona-1'));
  });

  describe('positive scenarios', () => {
    it('returns { results } from memory.search with session-resolved personaId', async () => {
      const chunks = [{ id: '1', content: 'relevant fact', score: 0.9, metadata: {}, createdAt: 0 }];
      (memory.search as ReturnType<typeof vi.fn>).mockResolvedValue(chunks);

      const result = await tool.execute(
        makeRequest('memory_search', { query: 'relevant' }),
      ) as { results: unknown[] };

      expect(memory.search).toHaveBeenCalledWith('relevant', 'persona-1', 5);
      expect(result.results).toStrictEqual(chunks);
    });

    it('passes custom limit to memory.search', async () => {
      (memory.search as ReturnType<typeof vi.fn>).mockResolvedValue([]);

      await tool.execute(makeRequest('memory_search', { query: 'cats', limit: 10 }));

      expect(memory.search).toHaveBeenCalledWith('cats', 'persona-1', 10);
    });
  });

  describe('edge cases', () => {
    it('defaults limit to 5 when not provided', async () => {
      (memory.search as ReturnType<typeof vi.fn>).mockResolvedValue([]);

      await tool.execute(makeRequest('memory_search', { query: 'q' }));

      expect(memory.search).toHaveBeenCalledWith('q', 'persona-1', 5);
    });

    it('returns empty results array when nothing matches', async () => {
      (memory.search as ReturnType<typeof vi.fn>).mockResolvedValue([]);

      const result = await tool.execute(
        makeRequest('memory_search', { query: 'zzznomatch' }),
      ) as { results: unknown[] };

      expect(result.results).toHaveLength(0);
    });
  });

  describe('negative scenarios', () => {
    it('propagates error when memory.search throws', async () => {
      (memory.search as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('SEARCH_FAILED'));

      await expect(tool.execute(makeRequest('memory_search', { query: 'x' }))).rejects.toThrow('SEARCH_FAILED');
    });

    it('throws when session is not found in DB', async () => {
      const toolNoSession = new MemorySearchTool(memory as MemoryService, makeDrizzleNoSessionMock());

      await expect(toolNoSession.execute(makeRequest('memory_search', { query: 'x' }))).rejects.toThrow('not found');
    });
  });
});

// �� MemoryIngestConversationTool ����������������������������������������������

describe('MemoryIngestConversationTool', () => {
  let tool: MemoryIngestConversationTool;
  let memory: Partial<MemoryService>;

  beforeEach(() => {
    memory = { ingestConversation: vi.fn() };
    tool = new MemoryIngestConversationTool(memory as MemoryService, makeDrizzleMock('persona-1'));
  });

  describe('positive scenarios', () => {
    it('calls memory.ingestConversation with messages and session-resolved personaId', async () => {
      (memory.ingestConversation as ReturnType<typeof vi.fn>).mockResolvedValue({ ids: [], count: 2 });

      const messages = [
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi there!' },
      ];

      const result = await tool.execute(
        makeRequest('memory_ingest_conversation', { messages }),
      );

      expect(memory.ingestConversation).toHaveBeenCalledWith(messages, 'persona-1');
      expect(result).toEqual({ ids: [], count: 2 });
    });

    it('returns block count in result', async () => {
      (memory.ingestConversation as ReturnType<typeof vi.fn>).mockResolvedValue({ ids: [], count: 5 });

      const result = await tool.execute(
        makeRequest('memory_ingest_conversation', { messages: [{ role: 'user', content: 'x' }] }),
      ) as { count: number };

      expect(result.count).toBe(5);
    });
  });

  describe('edge cases', () => {
    it('handles empty messages array', async () => {
      (memory.ingestConversation as ReturnType<typeof vi.fn>).mockResolvedValue({ ids: [], count: 0 });

      await tool.execute(makeRequest('memory_ingest_conversation', { messages: [] }));

      expect(memory.ingestConversation).toHaveBeenCalledWith([], 'persona-1');
    });

    it('handles multi-turn conversation with all roles', async () => {
      (memory.ingestConversation as ReturnType<typeof vi.fn>).mockResolvedValue({ ids: [], count: 3 });

      const messages = [
        { role: 'system', content: 'Be helpful' },
        { role: 'user', content: 'Question' },
        { role: 'assistant', content: 'Answer' },
      ];

      await tool.execute(makeRequest('memory_ingest_conversation', { messages }));

      expect(memory.ingestConversation).toHaveBeenCalledWith(messages, 'persona-1');
    });
  });

  describe('negative scenarios', () => {
    it('propagates error when memory.ingestConversation throws', async () => {
      (memory.ingestConversation as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('INGEST_CONV_ERROR'));

      await expect(
        tool.execute(makeRequest('memory_ingest_conversation', { messages: [{ role: 'user', content: 'x' }] })),
      ).rejects.toThrow('INGEST_CONV_ERROR');
    });

    it('throws when session is not found in DB', async () => {
      const toolNoSession = new MemoryIngestConversationTool(memory as MemoryService, makeDrizzleNoSessionMock());

      await expect(
        toolNoSession.execute(makeRequest('memory_ingest_conversation', { messages: [] })),
      ).rejects.toThrow('not found');
    });
  });
});
