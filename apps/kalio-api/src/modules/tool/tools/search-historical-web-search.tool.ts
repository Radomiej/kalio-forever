import { Injectable } from '@nestjs/common';
import type { ToolCallRequest } from '@kalio/types';
import { Tool } from '../../../common/decorators/tool.decorator';
import { WebSearchHistoryStore } from '../../search/web-search-history.store';

function getQueryArg(args: ToolCallRequest['args']): string {
  const query = args['query'];
  if (typeof query !== 'string') {
    throw new Error('INVALID_QUERY: query must be a non-empty string');
  }

  const trimmedQuery = query.trim();
  if (!trimmedQuery) {
    throw new Error('INVALID_QUERY: query must be a non-empty string');
  }

  return trimmedQuery;
}

function getLimitArg(args: ToolCallRequest['args']): number {
  const limit = args['limit'];
  if (limit === undefined) return 5;
  if (typeof limit !== 'number' || !Number.isInteger(limit) || limit < 1 || limit > 20) {
    throw new Error('INVALID_LIMIT: limit must be an integer from 1 to 20');
  }

  return limit;
}

@Injectable()
@Tool({
  name: 'search_historical_web_search',
  description:
    'Search the global persisted WebSearch history for previous Perplexity/OpenRouter queries and answers. ' +
    'Use this when memory_search does not contain enough relevant context or when you need prior web_search answers.',
  parameters: {
    type: 'object',
    required: ['query'],
    properties: {
      query: {
        type: 'string',
        description: 'Natural language query to match against persisted web search queries and answers',
      },
      limit: {
        type: 'integer',
        description: 'Maximum number of historical results to return. Default: 5',
        minimum: 1,
        maximum: 20,
      },
    },
  },
  requiresConfirmation: false,
})
export class SearchHistoricalWebSearchTool {
  constructor(private readonly historyStore: WebSearchHistoryStore) {}

  async execute(request: ToolCallRequest): Promise<object> {
    const query = getQueryArg(request.args);
    const limit = getLimitArg(request.args);
    return { historicalSearch: this.historyStore.search(query, limit) };
  }
}