import { Injectable, Logger } from '@nestjs/common';
import type { MemoryIngestResult, MemorySearchResult, ToolCallRequest } from '@kalio/types';
import { Tool } from '../../../common/decorators/tool.decorator';
import { DrizzleService } from '../../../database/drizzle.service';
import { MemoryService } from '../../memory/memory.service';
import { chunkWebSearchResult, type WebSearchChunk } from '../../memory/web-search-chunking';
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

function getOfflineSearchArg(args: ToolCallRequest['args']): boolean {
  const value = args['offline_search'];
  if (value === undefined) return true;
  if (typeof value !== 'boolean') {
    throw new Error('INVALID_OFFLINE_SEARCH: offline_search must be a boolean');
  }
  return value;
}

type WebSearchResultView = {
  content: string;
  citationUrls: string[];
  blockType: WebSearchChunk['blockType'];
  headingPath: string[];
  webResultId: string;
  blockIndex: number;
  query: string;
  provider: string;
  model: string;
};

function parseJsonStringArray(raw: string | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((value): value is string => typeof value === 'string')
      : [];
  } catch {
    return [];
  }
}

function mapMemoryResultsToStructuredResults(results: MemorySearchResult[]): WebSearchResultView[] {
  return results.map((result) => ({
    content: result.content,
    citationUrls: parseJsonStringArray(result.metadata['citation_urls_json']),
    blockType: (result.metadata['block_type'] as WebSearchChunk['blockType'] | undefined) ?? 'paragraph',
    headingPath: parseJsonStringArray(result.metadata['heading_path_json']),
    webResultId: result.metadata['web_result_id'] ?? result.id,
    blockIndex: Number(result.metadata['block_index'] ?? 0),
    query: result.metadata['query'] ?? '',
    provider: result.metadata['provider'] ?? 'memory',
    model: result.metadata['model'] ?? 'persona-memory',
  }));
}

function formatOfflineAnswer(results: WebSearchResultView[]): string {
  return results
    .slice(0, 3)
    .map((result, index) => {
      const heading = result.headingPath.length > 0 ? `${result.headingPath.join(' > ')}\n` : '';
      const sources = result.citationUrls.length > 0 ? `\nSources: ${result.citationUrls.join(', ')}` : '';
      return `[${index + 1}] ${heading}${result.content}${sources}`;
    })
    .join('\n\n');
}

@Injectable()
@Tool({
  name: 'web_search',
  description:
    'Search for current information. By default this checks persona memory first and only calls external web search when no related memory exists. ' +
    'Set offline_search=false to force an external search. External results are saved silently for future memory retrieval.',
  parameters: {
    type: 'object',
    required: ['query'],
    properties: {
      query: {
        type: 'string',
        description: 'Search query - be specific for best results',
      },
      offline_search: {
        type: 'boolean',
        description: 'Defaults to true. Set false to bypass memory and force external search.',
      },
    },
  },
  requiresConfirmation: false,
})
export class WebSearchTool {
  private readonly logger = new Logger(WebSearchTool.name);

  constructor(
    private readonly webSearch: WebSearchService,
    private readonly memory: MemoryService,
    private readonly drizzle: DrizzleService,
  ) {}

  async execute(request: ToolCallRequest): Promise<object> {
    const query = getQueryArg(request.args);
    const offlineSearch = getOfflineSearchArg(request.args);
    const memoryWarnings: string[] = [];

    if (offlineSearch) {
      try {
        const memoryResults = await this.memory.searchWebResults(query, 5);
        if (memoryResults.length > 0) {
          const structuredResults = mapMemoryResultsToStructuredResults(memoryResults);
          return {
            answer: formatOfflineAnswer(structuredResults),
            citations: Array.from(new Set(structuredResults.flatMap((result) => result.citationUrls))),
            model: 'persona-memory',
            provider: 'memory',
            offline: true,
            memory: {
              ids: structuredResults.map((result) => `${result.webResultId}:${result.blockIndex}`),
              count: structuredResults.length,
            },
            results: structuredResults,
          };
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const warning = `Memory search failed: ${message}`;
        memoryWarnings.push(warning);
        this.logger.warn(`[web_search] ${warning}`);
      }
    }

    const result = await this.webSearch.search(query);
    const chunks = chunkWebSearchResult({
      query,
      answer: result.answer,
      citations: result.citations,
      provider: result.provider,
      model: result.model,
    });
    let memory: MemoryIngestResult = { ids: [], count: 0 };
    try {
      memory = await this.memory.ingestWebSearchResult(chunks);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const warning = `Memory ingest failed: ${message}`;
      memoryWarnings.push(warning);
      this.logger.warn(`[web_search] ${warning}`);
    }

    return {
      ...result,
      offline: false,
      memory,
      results: chunks,
      ...(memoryWarnings.length > 0 ? { memory_warnings: memoryWarnings } : {}),
    };
  }
}
