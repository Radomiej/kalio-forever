import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ToolCallRequest } from '@kalio/types';
import type { WebSearchHistoryStore } from '../../search/web-search-history.store';
import { SearchHistoricalWebSearchTool } from './search-historical-web-search.tool';

function makeRequest(args: Record<string, unknown>): ToolCallRequest {
  return {
    callId: 'call-history-1',
    sessionId: 'session-history-1',
    toolName: 'search_historical_web_search',
    args,
  };
}

describe('SearchHistoricalWebSearchTool', () => {
  let tool: SearchHistoricalWebSearchTool;
  let historyStore: Pick<WebSearchHistoryStore, 'search'>;

  beforeEach(() => {
    historyStore = {
      search: vi.fn().mockReturnValue([
        {
          id: 'history-1',
          query: 'Perplexity OpenRouter setup',
          answer: 'Historical setup answer',
          citations: ['https://example.com/setup'],
          model: 'perplexity/sonar',
          provider: 'perplexity-openrouter',
          createdAt: 1_713_000_000_000,
          score: 0.8,
        },
      ]),
    };
    tool = new SearchHistoricalWebSearchTool(historyStore as WebSearchHistoryStore);
  });

  it('returns matching historical web searches with a bounded limit', async () => {
    const result = await tool.execute(makeRequest({ query: 'OpenRouter setup', limit: 3 }));

    expect(historyStore.search).toHaveBeenCalledWith('OpenRouter setup', 3);
    expect(result).toEqual({
      historicalSearch: [
        {
          id: 'history-1',
          query: 'Perplexity OpenRouter setup',
          answer: 'Historical setup answer',
          citations: ['https://example.com/setup'],
          model: 'perplexity/sonar',
          provider: 'perplexity-openrouter',
          createdAt: 1_713_000_000_000,
          score: 0.8,
        },
      ],
    });
  });

  it('uses the default limit when none is supplied', async () => {
    await tool.execute(makeRequest({ query: 'OpenRouter setup' }));

    expect(historyStore.search).toHaveBeenCalledWith('OpenRouter setup', 5);
  });

  it.each([
    { label: 'query is missing', args: {} },
    { label: 'query is empty', args: { query: '' } },
    { label: 'query is whitespace', args: { query: '   ' } },
    { label: 'query is numeric', args: { query: 123 } },
  ])('rejects invalid query when $label', async ({ args }) => {
    await expect(tool.execute(makeRequest(args))).rejects.toThrow('INVALID_QUERY');
    expect(historyStore.search).not.toHaveBeenCalled();
  });

  it.each([
    { label: 'limit is zero', limit: 0 },
    { label: 'limit is negative', limit: -1 },
    { label: 'limit is too high', limit: 21 },
    { label: 'limit is fractional', limit: 1.5 },
    { label: 'limit is a string', limit: '5' },
  ])('rejects invalid limit when $label', async ({ limit }) => {
    await expect(tool.execute(makeRequest({ query: 'OpenRouter setup', limit }))).rejects.toThrow('INVALID_LIMIT');
    expect(historyStore.search).not.toHaveBeenCalled();
  });
});