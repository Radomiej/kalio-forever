import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ToolCallRequest } from '@kalio/types';
import type { WebSearchService } from '../../search/web-search.service';
import { WebSearchTool } from './web-search.tool';

function makeRequest(query: unknown): ToolCallRequest {
  return {
    callId: 'call-web-1',
    sessionId: 'session-web-1',
    toolName: 'web_search',
    args: { query },
  };
}

function makeRawRequest(args: Record<string, unknown> = {}): ToolCallRequest {
  return {
    callId: 'call-web-1',
    sessionId: 'session-web-1',
    toolName: 'web_search',
    args,
  };
}

describe('WebSearchTool', () => {
  let tool: WebSearchTool;
  let webSearch: Pick<WebSearchService, 'search'>;

  beforeEach(() => {
    webSearch = {
      search: vi.fn(),
    };
    tool = new WebSearchTool(webSearch as WebSearchService);
  });

  it('passes a trimmed query to the search service', async () => {
    const resultPayload = {
      result: {
        answer: 'Latest answer',
        citations: ['https://example.com'],
        model: 'sonar',
        provider: 'perplexity' as const,
      },
      historicalSearch: [
        {
          id: 'history-1',
          query: 'previous latest status',
          answer: 'Earlier answer',
          citations: [],
          model: 'sonar',
          provider: 'perplexity' as const,
          createdAt: 1_713_000_000_000,
          score: 0.66,
        },
      ],
    };
    (webSearch.search as ReturnType<typeof vi.fn>).mockResolvedValue(resultPayload);

    const result = await tool.execute(makeRequest('  latest status  '));

    expect(webSearch.search).toHaveBeenCalledWith('latest status');
    expect(result).toEqual(resultPayload);
  });

  it.each([
    { label: 'query is missing', request: makeRawRequest() },
    { label: 'query is empty', request: makeRequest('') },
    { label: 'query is whitespace', request: makeRequest('   ') },
    { label: 'query is null', request: makeRequest(null) },
    { label: 'query is numeric', request: makeRequest(123) },
    { label: 'query is an object', request: makeRequest({ text: 'latest status' }) },
  ])('rejects invalid query when $label (REGRESSION)', async ({ request }) => {
    await expect(tool.execute(request)).rejects.toThrow('INVALID_QUERY');
    expect(webSearch.search).not.toHaveBeenCalled();
  });
});