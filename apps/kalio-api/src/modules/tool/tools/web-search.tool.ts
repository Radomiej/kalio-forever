import { Injectable, Logger } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import type { MemoryIngestResult, MemorySearchResult, ToolCallRequest } from '@kalio/types';
import { Tool } from '../../../common/decorators/tool.decorator';
import { DrizzleService } from '../../../database/drizzle.service';
import { sessions } from '../../../database/schema';
import { MemoryService } from '../../memory/memory.service';
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

function formatSearchMemory(query: string, result: Awaited<ReturnType<WebSearchService['search']>>): string {
  const citations = result.citations.length > 0
    ? result.citations.map((citation, index) => `${index + 1}. ${citation}`).join('\n')
    : 'None';

  return [
    `Web search query: ${query}`,
    `Provider: ${result.provider}`,
    `Model: ${result.model}`,
    '',
    'Answer:',
    result.answer,
    '',
    'Citations:',
    citations,
  ].join('\n');
}

function formatOfflineAnswer(results: MemorySearchResult[]): string {
  return results
    .map((result, index) => {
      const source = result.metadata['source'] ? ` source=${result.metadata['source']}` : '';
      return `[${index + 1}]${source}\n${result.content}`;
    })
    .join('\n\n');
}

async function resolvePersonaId(drizzle: DrizzleService, sessionId: string): Promise<string> {
  const row = drizzle.db
    .select({ personaId: sessions.personaId })
    .from(sessions)
    .where(eq(sessions.id, sessionId))
    .get();
  if (!row) throw new Error(`Session ${sessionId} not found - cannot resolve personaId`);
  return row.personaId;
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
    const personaId = await resolvePersonaId(this.drizzle, request.sessionId);
    const memoryWarnings: string[] = [];

    if (offlineSearch) {
      try {
        const memoryResults = await this.memory.searchWebResults(query, 5);
        if (memoryResults.length > 0) {
          return {
            answer: formatOfflineAnswer(memoryResults),
            citations: [],
            model: 'persona-memory',
            provider: 'memory',
            offline: true,
            results: memoryResults,
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
    let memory: MemoryIngestResult = { ids: [], count: 0 };
    try {
      memory = await this.memory.ingestWebSearchResult(formatSearchMemory(query, result), {
        source: 'web_search',
        query,
        persona_id: personaId,
        provider: result.provider,
        model: result.model,
      });
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
      ...(memoryWarnings.length > 0 ? { memory_warnings: memoryWarnings } : {}),
    };
  }
}
