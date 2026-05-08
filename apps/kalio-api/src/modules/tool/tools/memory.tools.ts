import { Injectable, Logger } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import type { ToolCallRequest } from '@kalio/types';
import { Tool, ConfirmedTool } from '../../../common/decorators/tool.decorator';
import { MemoryService } from '../../memory/memory.service';
import { DrizzleService } from '../../../database/drizzle.service';
import { sessions } from '../../../database/schema';

function getTextArg(args: ToolCallRequest['args']): string {
  const rawText = args['text'];
  if (typeof rawText !== 'string' || rawText.trim().length === 0) {
    throw new Error('INVALID_TEXT: text must be a non-empty string');
  }
  return rawText;
}

function getMetadataArg(args: ToolCallRequest['args']): Record<string, string> {
  const rawMetadata = args['metadata'];
  if (rawMetadata === undefined) {
    return {};
  }
  if (
    rawMetadata === null ||
    typeof rawMetadata !== 'object' ||
    Array.isArray(rawMetadata) ||
    Object.values(rawMetadata).some((value) => typeof value !== 'string')
  ) {
    throw new Error('INVALID_METADATA: metadata must be an object with string values');
  }
  return rawMetadata as Record<string, string>;
}

function getQueryArg(args: ToolCallRequest['args']): string {
  const rawQuery = args['query'];
  if (typeof rawQuery !== 'string' || rawQuery.trim().length === 0) {
    throw new Error('INVALID_QUERY: query must be a non-empty string');
  }
  return rawQuery;
}

function getLimitArg(args: ToolCallRequest['args']): number {
  const rawLimit = args['limit'];
  if (rawLimit === undefined) {
    return 5;
  }
  if (typeof rawLimit !== 'number' || !Number.isInteger(rawLimit) || rawLimit < 1 || rawLimit > 20) {
    throw new Error('INVALID_LIMIT: limit must be an integer between 1 and 20');
  }
  return rawLimit;
}

function getMessagesArg(args: ToolCallRequest['args']): Array<{ role: string; content: string }> {
  const rawMessages = args['messages'];
  if (!Array.isArray(rawMessages)) {
    throw new Error('INVALID_MESSAGES: messages must be an array');
  }

  const messages = rawMessages as Array<Record<string, unknown>>;
  for (const message of messages) {
    if (
      !message ||
      typeof message !== 'object' ||
      typeof message['role'] !== 'string' ||
      message['role'].trim().length === 0 ||
      typeof message['content'] !== 'string' ||
      message['content'].trim().length === 0
    ) {
      throw new Error('INVALID_MESSAGE: each message must include non-empty string role and content');
    }
  }

  return messages as Array<{ role: string; content: string }>;
}

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
@ConfirmedTool({
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
})
export class MemoryIngestTool {
  private readonly logger = new Logger(MemoryIngestTool.name);

  constructor(
    private readonly memory: MemoryService,
    private readonly drizzle: DrizzleService,
  ) {}

  async execute(request: ToolCallRequest): Promise<object> {
    const text = getTextArg(request.args);
    const metadata = getMetadataArg(request.args);
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
    const query = getQueryArg(request.args);
    const limit = getLimitArg(request.args);
    const personaId = await resolvePersonaId(this.drizzle, request.sessionId);

    const results = await this.memory.search(query, personaId, limit);
    this.logger.debug(`[memory_search] Found ${results.length} results for query="${query.slice(0, 50)}"`);
    return { results };
  }
}

@Injectable()
@ConfirmedTool({
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
})
export class MemoryIngestConversationTool {
  private readonly logger = new Logger(MemoryIngestConversationTool.name);

  constructor(
    private readonly memory: MemoryService,
    private readonly drizzle: DrizzleService,
  ) {}

  async execute(request: ToolCallRequest): Promise<object> {
    const messages = getMessagesArg(request.args);
    const personaId = await resolvePersonaId(this.drizzle, request.sessionId);

    const result = await this.memory.ingestConversation(messages, personaId);
    this.logger.debug(`[memory_ingest_conversation] Ingested ${result.count} blocks for persona=${personaId}`);
    return result;
  }
}
