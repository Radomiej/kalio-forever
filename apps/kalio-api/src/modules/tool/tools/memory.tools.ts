import { Injectable, Logger } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import type { ToolCallRequest } from '@kalio/types';
import { Tool } from '../../../common/decorators/tool.decorator';
import { MemoryService } from '../../memory/memory.service';
import { DrizzleService } from '../../../database/drizzle.service';
import { sessions } from '../../../database/schema';

/** Resolves the persona that owns the current chat session from the DB. */
async function resolvePersonaId(drizzle: DrizzleService, sessionId: string): Promise<string> {
  const row = drizzle.db
    .select({ personaId: sessions.personaId })
    .from(sessions)
    .where(eq(sessions.id, sessionId))
    .get();
  if (!row) throw new Error(`Session ${sessionId} not found — cannot resolve personaId`);
  return row.personaId;
}

@Injectable()
@Tool({
  name: 'memory_ingest',
  description:
    'Store a text passage in the long-term memory for the active persona. ' +
    'The text is chunked, embedded, and indexed for future retrieval. ' +
    'The persona is resolved automatically from the current session — do not guess it.',
  parameters: {
    type: 'object',
    required: ['text'],
    properties: {
      text: {
        type: 'string',
        description: 'Text content to ingest into memory',
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

  constructor(
    private readonly memory: MemoryService,
    private readonly drizzle: DrizzleService,
  ) {}

  async execute(request: ToolCallRequest): Promise<object> {
    const text = request.args['text'] as string;
    const metadata = (request.args['metadata'] as Record<string, string> | undefined) ?? {};
    const personaId = await resolvePersonaId(this.drizzle, request.sessionId);

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
    'Returns the most relevant chunks with relevance scores. ' +
    'The persona is resolved automatically from the current session — do not guess it.',
  parameters: {
    type: 'object',
    required: ['query'],
    properties: {
      query: {
        type: 'string',
        description: 'Natural language search query',
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

  constructor(
    private readonly memory: MemoryService,
    private readonly drizzle: DrizzleService,
  ) {}

  async execute(request: ToolCallRequest): Promise<object> {
    const query = request.args['query'] as string;
    const limit = (request.args['limit'] as number | undefined) ?? 5;
    const personaId = await resolvePersonaId(this.drizzle, request.sessionId);

    const results = await this.memory.search(query, personaId, limit);
    this.logger.debug(`[memory_search] Found ${results.length} results for query="${query.slice(0, 50)}"`);
    return { results };
  }
}

@Injectable()
@Tool({
  name: 'memory_ingest_conversation',
  description:
    'Ingest an entire conversation (list of messages) into long-term memory for the active persona. ' +
    'Messages are grouped into contextual blocks before embedding. ' +
    'The persona is resolved automatically from the current session — do not guess it.',
  parameters: {
    type: 'object',
    required: ['messages'],
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
    },
  },
  requiresConfirmation: false,
})
export class MemoryIngestConversationTool {
  private readonly logger = new Logger(MemoryIngestConversationTool.name);

  constructor(
    private readonly memory: MemoryService,
    private readonly drizzle: DrizzleService,
  ) {}

  async execute(request: ToolCallRequest): Promise<object> {
    const messages = request.args['messages'] as Array<{ role: string; content: string }>;
    const personaId = await resolvePersonaId(this.drizzle, request.sessionId);

    const result = await this.memory.ingestConversation(messages, personaId);
    this.logger.debug(`[memory_ingest_conversation] Ingested ${result.count} blocks for persona=${personaId}`);
    return result;
  }
}
