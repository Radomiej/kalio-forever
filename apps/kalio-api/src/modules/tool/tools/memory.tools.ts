import { Injectable, Logger } from '@nestjs/common';
import type { ToolCallRequest } from '@kalio/types';
import { Tool } from '../../../common/decorators/tool.decorator';
import { MemoryService } from '../../memory/memory.service';

@Injectable()
@Tool({
  name: 'memory_ingest',
  description:
    'Store a text passage in the long-term memory for a persona. ' +
    'The text is chunked, embedded, and indexed for future retrieval.',
  parameters: {
    type: 'object',
    required: ['text', 'personaId'],
    properties: {
      text: {
        type: 'string',
        description: 'Text content to ingest into memory',
      },
      personaId: {
        type: 'string',
        description: 'Persona identifier whose memory store to update',
      },
      metadata: {
        type: 'object',
        description: 'Optional key-value metadata to attach to the memory chunks',
        additionalProperties: { type: 'string' },
      },
    },
  },
  requiresConfirmation: false,
})
export class MemoryIngestTool {
  private readonly logger = new Logger(MemoryIngestTool.name);

  constructor(private readonly memory: MemoryService) {}

  async execute(request: ToolCallRequest): Promise<object> {
    const text = request.args['text'] as string;
    const personaId = request.args['personaId'] as string;
    const metadata = (request.args['metadata'] as Record<string, string> | undefined) ?? {};

    const result = await this.memory.ingest(text, personaId, metadata);
    this.logger.debug(`[memory_ingest] Ingested ${result.count} chunks for persona=${personaId}`);
    return result;
  }
}

@Injectable()
@Tool({
  name: 'memory_search',
  description:
    'Search long-term memory for passages related to a query. ' +
    'Returns the most relevant chunks with relevance scores.',
  parameters: {
    type: 'object',
    required: ['query', 'personaId'],
    properties: {
      query: {
        type: 'string',
        description: 'Natural language search query',
      },
      personaId: {
        type: 'string',
        description: 'Persona identifier whose memory to search',
      },
      limit: {
        type: 'integer',
        description: 'Maximum number of results to return. Default: 5',
        minimum: 1,
        maximum: 20,
      },
    },
  },
  requiresConfirmation: false,
})
export class MemorySearchTool {
  private readonly logger = new Logger(MemorySearchTool.name);

  constructor(private readonly memory: MemoryService) {}

  async execute(request: ToolCallRequest): Promise<object> {
    const query = request.args['query'] as string;
    const personaId = request.args['personaId'] as string;
    const limit = (request.args['limit'] as number | undefined) ?? 5;

    const results = await this.memory.search(query, personaId, limit);
    this.logger.debug(`[memory_search] Found ${results.length} results for query="${query.slice(0, 50)}"`);
    return { results };
  }
}

@Injectable()
@Tool({
  name: 'memory_ingest_conversation',
  description:
    'Ingest an entire conversation (list of messages) into long-term memory for a persona. ' +
    'Messages are grouped into contextual blocks before embedding.',
  parameters: {
    type: 'object',
    required: ['messages', 'personaId'],
    properties: {
      messages: {
        type: 'array',
        description: 'List of conversation messages to ingest',
        items: {
          type: 'object',
          required: ['role', 'content'],
          properties: {
            role: { type: 'string', description: 'Message role: user, assistant, system' },
            content: { type: 'string', description: 'Message content' },
          },
        },
      },
      personaId: {
        type: 'string',
        description: 'Persona identifier whose memory store to update',
      },
    },
  },
  requiresConfirmation: false,
})
export class MemoryIngestConversationTool {
  private readonly logger = new Logger(MemoryIngestConversationTool.name);

  constructor(private readonly memory: MemoryService) {}

  async execute(request: ToolCallRequest): Promise<object> {
    const messages = request.args['messages'] as Array<{ role: string; content: string }>;
    const personaId = request.args['personaId'] as string;

    const result = await this.memory.ingestConversation(messages, personaId);
    this.logger.debug(`[memory_ingest_conversation] Ingested ${result.count} blocks for persona=${personaId}`);
    return result;
  }
}
