import { Injectable } from '@nestjs/common';
import type { ChatMessage, ChatSession, LLMToolCall } from '@kalio/types';
import { and, asc, desc, eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { DrizzleService } from '../../database/drizzle.service';
import { messages, sessions } from '../../database/schema';

const toMs = (value: number | Date): number => (value instanceof Date ? value.getTime() : value);
const CLI_AGENT_METADATA_PREFIX = '__kalio_cli_agent_meta__:';

interface CreateChildSessionParams {
  parentSessionId: string;
  parentToolCallId: string;
  agentId: string;
  title: string;
}

interface CLIAgentSessionMetadata {
  agentId: string;
  workdir: string;
}

@Injectable()
export class CLIAgentSessionService {
  constructor(private readonly drizzle: DrizzleService) {}

  async createChildSession(params: CreateChildSessionParams): Promise<ChatSession> {
    const [parentSession] = await this.drizzle.db
      .select({ personaId: sessions.personaId })
      .from(sessions)
      .where(eq(sessions.id, params.parentSessionId))
      .limit(1);

    const now = new Date();
    const row = {
      id: nanoid(),
      personaId: parentSession?.personaId ?? 'default',
      title: params.title || `${params.agentId} CLI`,
      kind: 'cli-agent' as const,
      parentSessionId: params.parentSessionId,
      parentTurnId: null,
      parentToolCallId: params.parentToolCallId,
      createdAt: now,
      updatedAt: now,
    };

    await this.drizzle.db.insert(sessions).values(row);

    return {
      id: row.id,
      personaId: row.personaId,
      title: row.title,
      kind: row.kind,
      parentSessionId: row.parentSessionId,
      parentToolCallId: row.parentToolCallId,
      createdAt: toMs(row.createdAt),
      updatedAt: toMs(row.updatedAt),
    };
  }

  async persistUserMessage(sessionId: string, content: string): Promise<void> {
    await this.insertMessage({
      sessionId,
      role: 'user',
      content,
    });
  }

  async persistAssistantToolCallMessage(
    sessionId: string,
    toolCallId: string,
    args: Record<string, unknown>,
  ): Promise<void> {
    const toolCalls: LLMToolCall[] = [{ id: toolCallId, name: 'run_cli_agent', args }];

    await this.insertMessage({
      sessionId,
      role: 'assistant',
      content: '',
      toolCalls,
    });
  }

  async persistAssistantMessage(sessionId: string, content: string): Promise<void> {
    await this.insertMessage({
      sessionId,
      role: 'assistant',
      content,
    });
  }

  async saveSessionMetadata(sessionId: string, metadata: CLIAgentSessionMetadata): Promise<void> {
    await this.insertMessage({
      sessionId,
      role: 'system',
      content: `${CLI_AGENT_METADATA_PREFIX}${JSON.stringify(metadata)}`,
    });
  }

  async loadSessionMetadata(sessionId: string): Promise<CLIAgentSessionMetadata | null> {
    const rows = await this.drizzle.db
      .select({ content: messages.content })
      .from(messages)
      .where(and(eq(messages.sessionId, sessionId), eq(messages.role, 'system')))
      .orderBy(desc(messages.createdAt));

    for (const row of rows) {
      if (!row.content.startsWith(CLI_AGENT_METADATA_PREFIX)) {
        continue;
      }

      try {
        const parsed = JSON.parse(row.content.slice(CLI_AGENT_METADATA_PREFIX.length)) as Record<string, unknown>;
        if (typeof parsed['agentId'] === 'string' && typeof parsed['workdir'] === 'string') {
          return {
            agentId: parsed['agentId'],
            workdir: parsed['workdir'],
          };
        }
      } catch {
        continue;
      }
    }

    return null;
  }

  async getChildSession(parentSessionId: string, childSessionId: string): Promise<ChatSession | null> {
    const [row] = await this.drizzle.db
      .select()
      .from(sessions)
      .where(and(eq(sessions.id, childSessionId), eq(sessions.parentSessionId, parentSessionId)))
      .limit(1);

    return row ? this.toChatSession(row) : null;
  }

  async listMessages(sessionId: string): Promise<ChatMessage[]> {
    const rows = await this.drizzle.db
      .select()
      .from(messages)
      .where(eq(messages.sessionId, sessionId))
      .orderBy(asc(messages.createdAt));

    return rows.map((row) => ({
      id: row.id,
      sessionId: row.sessionId,
      role: row.role,
      content: row.content,
      thinking: row.thinking ?? undefined,
      toolCalls: row.toolCalls ?? undefined,
      toolCallId: row.toolCallId ?? undefined,
      attachments: row.attachments ?? undefined,
      createdAt: toMs(row.createdAt),
    }));
  }

  async loadLatestToolResult(sessionId: string): Promise<ChatMessage | null> {
    const [row] = await this.drizzle.db
      .select()
      .from(messages)
      .where(and(eq(messages.sessionId, sessionId), eq(messages.role, 'tool_result')))
      .orderBy(desc(messages.createdAt))
      .limit(1);

    if (!row) {
      return null;
    }

    return {
      id: row.id,
      sessionId: row.sessionId,
      role: row.role,
      content: row.content,
      toolCallId: row.toolCallId ?? undefined,
      createdAt: toMs(row.createdAt),
    };
  }

  async saveToolResult(sessionId: string, toolCallId: string, content: string): Promise<void> {
    await this.insertMessage({
      sessionId,
      role: 'tool_result',
      content,
      toolCallId,
    });
  }

  private async insertMessage(params: {
    sessionId: string;
    role: 'user' | 'assistant' | 'tool_result' | 'system';
    content: string;
    toolCallId?: string;
    toolCalls?: LLMToolCall[];
  }): Promise<void> {
    const now = new Date();

    await this.drizzle.db.insert(messages).values({
      id: nanoid(),
      sessionId: params.sessionId,
      role: params.role,
      content: params.content,
      toolCalls: params.toolCalls ?? null,
      toolCallId: params.toolCallId ?? null,
      createdAt: now,
    });

    await this.drizzle.db
      .update(sessions)
      .set({ updatedAt: now })
      .where(eq(sessions.id, params.sessionId));
  }

  private toChatSession(row: {
    id: string;
    personaId: string;
    title: string;
    kind: 'chat' | 'subagent' | 'cli-agent';
    parentSessionId?: string | null;
    parentTurnId?: string | null;
    parentToolCallId?: string | null;
    createdAt: number | Date;
    updatedAt: number | Date;
  }): ChatSession {
    return {
      id: row.id,
      personaId: row.personaId,
      title: row.title,
      kind: row.kind,
      parentSessionId: row.parentSessionId ?? undefined,
      parentTurnId: row.parentTurnId ?? undefined,
      parentToolCallId: row.parentToolCallId ?? undefined,
      createdAt: toMs(row.createdAt),
      updatedAt: toMs(row.updatedAt),
    };
  }
}
