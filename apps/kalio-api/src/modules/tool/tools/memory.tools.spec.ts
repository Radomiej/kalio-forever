import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemoryIngestTool, MemorySearchTool, MemoryIngestConversationTool } from './memory.tools';
import type { MemoryService } from '../../memory/memory.service';
import type { ToolCallRequest } from '@kalio/types';

function makeRequest(toolName: string, args: Record<string, unknown> = {}, sessionId = 'sess-mem'): ToolCallRequest {
  return { callId: 'call-1', sessionId, toolName, args };
}

// ── MemoryIngestTool ──────────────────────────────────────────────────────────

describe('MemoryIngestTool', () => {
  let tool: MemoryIngestTool;
  let memory: Partial<MemoryService>;

  beforeEach(() => {
    memory = {
      ingest: vi.fn(),
    };
    tool = new MemoryIngestTool(memory as MemoryService);
  });

  describe('positive scenarios', () => {
    it('calls memory.ingest and returns result', async () => {
      (memory.ingest as ReturnType<typeof vi.fn>).mockResolvedValue({ count: 3 });

      const result = await tool.execute(
        makeRequest('memory_ingest', { text: 'some knowledge', personaId: 'persona-1' }),
      );

      expect(memory.ingest).toHaveBeenCalledWith('some knowledge', 'persona-1', {});
      expect(result).toEqual({ count: 3 });
    });

    it('passes metadata to memory.ingest when provided', async () => {
      (memory.ingest as ReturnType<typeof vi.fn>).mockResolvedValue({ count: 1 });

      await tool.execute(
        makeRequest('memory_ingest', {
          text: 'fact',
          personaId: 'persona-1',
          metadata: { source: 'web', topic: 'ai' },
        }),
      );

      expect(memory.ingest).toHaveBeenCalledWith('fact', 'persona-1', { source: 'web', topic: 'ai' });
    });
  });

  describe('edge cases', () => {
    it('defaults metadata to empty object when not provided', async () => {
      (memory.ingest as ReturnType<typeof vi.fn>).mockResolvedValue({ count: 2 });

      await tool.execute(makeRequest('memory_ingest', { text: 'text', personaId: 'p1' }));

      expect(memory.ingest).toHaveBeenCalledWith('text', 'p1', {});
    });

    it('handles large text (no truncation)', async () => {
      const bigText = 'x'.repeat(10_000);
      (memory.ingest as ReturnType<typeof vi.fn>).mockResolvedValue({ count: 10 });

      await tool.execute(makeRequest('memory_ingest', { text: bigText, personaId: 'p1' }));

      expect(memory.ingest).toHaveBeenCalledWith(bigText, 'p1', {});
    });
  });

  describe('negative scenarios', () => {
    it('propagates error when memory.ingest throws', async () => {
      (memory.ingest as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('EMBED_FAILED'));

      await expect(
        tool.execute(makeRequest('memory_ingest', { text: 'x', personaId: 'p1' })),
      ).rejects.toThrow('EMBED_FAILED');
    });
  });
});

// ── MemorySearchTool ──────────────────────────────────────────────────────────

describe('MemorySearchTool', () => {
  let tool: MemorySearchTool;
  let memory: Partial<MemoryService>;

  beforeEach(() => {
    memory = {
      search: vi.fn(),
    };
    tool = new MemorySearchTool(memory as MemoryService);
  });

  describe('positive scenarios', () => {
    it('returns { results } from memory.search', async () => {
      const chunks = [{ text: 'relevant fact', score: 0.9 }];
      (memory.search as ReturnType<typeof vi.fn>).mockResolvedValue(chunks);

      const result = await tool.execute(
        makeRequest('memory_search', { query: 'relevant', personaId: 'persona-1' }),
      ) as { results: unknown[] };

      expect(result.results).toStrictEqual(chunks);
    });

    it('passes query, personaId, and limit to memory.search', async () => {
      (memory.search as ReturnType<typeof vi.fn>).mockResolvedValue([]);

      await tool.execute(
        makeRequest('memory_search', { query: 'cats', personaId: 'p1', limit: 10 }),
      );

      expect(memory.search).toHaveBeenCalledWith('cats', 'p1', 10);
    });
  });

  describe('edge cases', () => {
    it('defaults limit to 5 when not provided', async () => {
      (memory.search as ReturnType<typeof vi.fn>).mockResolvedValue([]);

      await tool.execute(makeRequest('memory_search', { query: 'q', personaId: 'p1' }));

      expect(memory.search).toHaveBeenCalledWith('q', 'p1', 5);
    });

    it('returns empty results array when nothing matches', async () => {
      (memory.search as ReturnType<typeof vi.fn>).mockResolvedValue([]);

      const result = await tool.execute(
        makeRequest('memory_search', { query: 'zzznomatch', personaId: 'p1' }),
      ) as { results: unknown[] };

      expect(result.results).toHaveLength(0);
    });
  });

  describe('negative scenarios', () => {
    it('propagates error when memory.search throws', async () => {
      (memory.search as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('SEARCH_FAILED'));

      await expect(
        tool.execute(makeRequest('memory_search', { query: 'x', personaId: 'p1' })),
      ).rejects.toThrow('SEARCH_FAILED');
    });
  });
});

// ── MemoryIngestConversationTool ──────────────────────────────────────────────

describe('MemoryIngestConversationTool', () => {
  let tool: MemoryIngestConversationTool;
  let memory: Partial<MemoryService>;

  beforeEach(() => {
    memory = {
      ingestConversation: vi.fn(),
    };
    tool = new MemoryIngestConversationTool(memory as MemoryService);
  });

  describe('positive scenarios', () => {
    it('calls memory.ingestConversation with messages and personaId', async () => {
      (memory.ingestConversation as ReturnType<typeof vi.fn>).mockResolvedValue({ count: 2 });

      const messages = [
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi there!' },
      ];

      const result = await tool.execute(
        makeRequest('memory_ingest_conversation', { messages, personaId: 'p1' }),
      );

      expect(memory.ingestConversation).toHaveBeenCalledWith(messages, 'p1');
      expect(result).toEqual({ count: 2 });
    });

    it('returns block count in result', async () => {
      (memory.ingestConversation as ReturnType<typeof vi.fn>).mockResolvedValue({ count: 5 });

      const result = await tool.execute(
        makeRequest('memory_ingest_conversation', {
          messages: [{ role: 'user', content: 'x' }],
          personaId: 'p1',
        }),
      ) as { count: number };

      expect(result.count).toBe(5);
    });
  });

  describe('edge cases', () => {
    it('handles empty messages array', async () => {
      (memory.ingestConversation as ReturnType<typeof vi.fn>).mockResolvedValue({ count: 0 });

      await tool.execute(
        makeRequest('memory_ingest_conversation', { messages: [], personaId: 'p1' }),
      );

      expect(memory.ingestConversation).toHaveBeenCalledWith([], 'p1');
    });

    it('handles multi-turn conversation with all roles', async () => {
      (memory.ingestConversation as ReturnType<typeof vi.fn>).mockResolvedValue({ count: 3 });

      const messages = [
        { role: 'system', content: 'Be helpful' },
        { role: 'user', content: 'Question' },
        { role: 'assistant', content: 'Answer' },
      ];

      await tool.execute(
        makeRequest('memory_ingest_conversation', { messages, personaId: 'p1' }),
      );

      expect(memory.ingestConversation).toHaveBeenCalledWith(messages, 'p1');
    });
  });

  describe('negative scenarios', () => {
    it('propagates error when memory.ingestConversation throws', async () => {
      (memory.ingestConversation as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('INGEST_CONV_ERROR'));

      await expect(
        tool.execute(
          makeRequest('memory_ingest_conversation', {
            messages: [{ role: 'user', content: 'x' }],
            personaId: 'p1',
          }),
        ),
      ).rejects.toThrow('INGEST_CONV_ERROR');
    });
  });
});
