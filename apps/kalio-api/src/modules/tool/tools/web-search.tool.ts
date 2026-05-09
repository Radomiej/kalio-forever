import { Injectable } from '@nestjs/common';
import type { ToolCallRequest } from '@kalio/types';
import { Tool } from '../../../common/decorators/tool.decorator';
import { WebSearchService } from '../../search/web-search.service';

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

@Injectable()
@Tool({
  name: 'web_search',
  description:
    'Search the web for up-to-date information using Perplexity AI. ' +
    'Returns a concise answer with source citations. ' +
    'Requires a Perplexity API key configured in Settings → Web Search.',
  parameters: {
    type: 'object',
    required: ['query'],
    properties: {
      query: {
        type: 'string',
        description: 'Search query — be specific for best results',
      },
    },
  },
  requiresConfirmation: false,
})
export class WebSearchTool {
  constructor(private readonly webSearch: WebSearchService) {}

  async execute(request: ToolCallRequest): Promise<object> {
    const query = getQueryArg(request.args);
    const result = await this.webSearch.search(query);
    return result;
  }
}
