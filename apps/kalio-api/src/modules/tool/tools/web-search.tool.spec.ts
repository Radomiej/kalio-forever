import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MemoryService } from '../../memory/memory.service';
import type { WebSearchService } from '../../search/web-search.service';
import type { DrizzleService } from '../../../database/drizzle.service';
import type { ToolCallRequest } from '@kalio/types';
import { WebSearchTool } from './web-search.tool';

function makeRequest(args: Record<string, unknown>): ToolCallRequest {
  return {
    callId: 'call-web-1',
    sessionId: 'session-web-1',
    toolName: 'web_search',
    args,
  };
}

function makeDrizzleMock(personaId = 'persona-web'): DrizzleService {
  const query = {
    select: vi.fn(() => query),
    from: vi.fn(() => query),
    where: vi.fn(() => query),
    get: vi.fn(() => ({ personaId })),
  };
  return { db: query } as unknown as DrizzleService;
}

describe('WebSearchTool', () => {
  let tool: WebSearchTool;
  let webSearch: Pick<WebSearchService, 'search'>;
  let memory: Pick<MemoryService, 'searchWebResults' | 'ingestWebSearchResult'>;

  beforeEach(() => {
    webSearch = { search: vi.fn() };
    memory = {
      searchWebResults: vi.fn().mockResolvedValue([]),
      ingestWebSearchResult: vi.fn(),
    };
    tool = new WebSearchTool(
      webSearch as WebSearchService,
      memory as MemoryService,
      makeDrizzleMock(),
    );
  });

  it('returns persona memory when offline_search is omitted and related entries exist', async () => {
    const memoryResults = [{
      id: 'mem-1',
      content: 'Stored web result about TypeScript 5.8',
      score: 0.9,
      metadata: { source: 'web_search' },
      createdAt: 1,
    }];
    (memory.searchWebResults as ReturnType<typeof vi.fn>).mockResolvedValue(memoryResults);

    const result = await tool.execute(makeRequest({ query: 'TypeScript latest' }));

    expect(memory.searchWebResults).toHaveBeenCalledWith('TypeScript latest', 5);
    expect(webSearch.search).not.toHaveBeenCalled();
    expect(memory.ingestWebSearchResult).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      provider: 'memory',
      model: 'persona-memory',
      offline: true,
      results: memoryResults,
    });
  });

  it('forces external search when offline_search is false and silently stores the result', async () => {
    const searchResult = {
      answer: 'Latest answer',
      citations: ['https://example.com'],
      model: 'sonar',
      provider: 'perplexity' as const,
    };
    (webSearch.search as ReturnType<typeof vi.fn>).mockResolvedValue(searchResult);
    (memory.ingestWebSearchResult as ReturnType<typeof vi.fn>).mockResolvedValue({ ids: ['mem-1'], count: 1 });

    const result = await tool.execute(makeRequest({ query: '  latest status  ', offline_search: false }));

    expect(memory.searchWebResults).not.toHaveBeenCalled();
    expect(webSearch.search).toHaveBeenCalledWith('latest status');
    expect(memory.ingestWebSearchResult).toHaveBeenCalledWith(
      expect.stringContaining('Web search query: latest status'),
      {
        source: 'web_search',
        query: 'latest status',
        persona_id: 'persona-web',
        provider: 'perplexity',
        model: 'sonar',
      },
    );
    expect(result).toEqual({ ...searchResult, offline: false, memory: { ids: ['mem-1'], count: 1 } });
  });

  it('falls back to external search and stores result when memory has no related entries', async () => {
    const searchResult = {
      answer: 'Fresh answer',
      citations: [],
      model: 'sonar',
      provider: 'perplexity' as const,
    };
    (webSearch.search as ReturnType<typeof vi.fn>).mockResolvedValue(searchResult);
    (memory.ingestWebSearchResult as ReturnType<typeof vi.fn>).mockResolvedValue({ ids: ['mem-2'], count: 1 });

    const result = await tool.execute(makeRequest({ query: 'fresh topic' }));

    expect(memory.searchWebResults).toHaveBeenCalledWith('fresh topic', 5);
    expect(webSearch.search).toHaveBeenCalledWith('fresh topic');
    expect(memory.ingestWebSearchResult).toHaveBeenCalledOnce();
    expect(result).toMatchObject({ offline: false, memory: { ids: ['mem-2'], count: 1 } });
  });

  it('continues with external search when local web-result recall throws', async () => {
    const searchResult = {
      answer: 'Fresh answer after memory failure',
      citations: ['https://example.com/fresh'],
      model: 'sonar',
      provider: 'perplexity' as const,
    };
    (memory.searchWebResults as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('local embedding failed'));
    (webSearch.search as ReturnType<typeof vi.fn>).mockResolvedValue(searchResult);
    (memory.ingestWebSearchResult as ReturnType<typeof vi.fn>).mockResolvedValue({ ids: ['mem-3'], count: 1 });

    const result = await tool.execute(makeRequest({ query: 'fresh topic despite broken local memory' }));

    expect(webSearch.search).toHaveBeenCalledWith('fresh topic despite broken local memory');
    expect(result).toMatchObject({
      ...searchResult,
      offline: false,
      memory: { ids: ['mem-3'], count: 1 },
      memory_warnings: [expect.stringContaining('Memory search failed')],
    });
  });

  it('returns the external answer even when silent web-result ingest throws', async () => {
    const searchResult = {
      answer: 'Fresh answer despite ingest failure',
      citations: ['https://example.com/answer'],
      model: 'sonar',
      provider: 'perplexity' as const,
    };
    (webSearch.search as ReturnType<typeof vi.fn>).mockResolvedValue(searchResult);
    (memory.ingestWebSearchResult as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('local embedding ingest failed'));

    const result = await tool.execute(makeRequest({ query: 'keep the answer even if ingest breaks', offline_search: false }));

    expect(result).toMatchObject({
      ...searchResult,
      offline: false,
      memory: { ids: [], count: 0 },
      memory_warnings: [expect.stringContaining('Memory ingest failed')],
    });
  });

  it.each([
    { label: 'query is missing', args: {} },
    { label: 'query is empty', args: { query: '' } },
    { label: 'query is whitespace', args: { query: '   ' } },
    { label: 'query is null', args: { query: null } },
    { label: 'query is numeric', args: { query: 123 } },
    { label: 'query is an object', args: { query: { text: 'latest status' } } },
  ])('rejects invalid query when $label (REGRESSION)', async ({ args }) => {
    await expect(tool.execute(makeRequest(args))).rejects.toThrow('INVALID_QUERY');
    expect(webSearch.search).not.toHaveBeenCalled();
    expect(memory.ingestWebSearchResult).not.toHaveBeenCalled();
  });

  it('rejects invalid offline_search', async () => {
    await expect(tool.execute(makeRequest({ query: 'latest', offline_search: 'false' }))).rejects.toThrow('INVALID_OFFLINE_SEARCH');
    expect(webSearch.search).not.toHaveBeenCalled();
    expect(memory.ingestWebSearchResult).not.toHaveBeenCalled();
  });
});
