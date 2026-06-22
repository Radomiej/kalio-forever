import { Injectable } from '@nestjs/common';
import { and, asc, count, desc, eq, lt, or } from 'drizzle-orm';
import type { ChatMessage } from '@kalio/types';
import { DrizzleService } from '../../database/drizzle.service';
import { messages, sessions } from '../../database/schema';
import type { IMessageRepository, SessionMessagePage, SessionMessagePageOptions } from './interfaces/message-repository.interface';

const toMs = (v: number | Date): number => (v instanceof Date ? v.getTime() : v);

/**
 * Production implementation of IMessageRepository backed by Drizzle/SQLite.
 * Also upserts the session row on ensureSession() so FK constraints are met
 * before any message is inserted.
 */
@Injectable()
export class DrizzleMessageRepository implements IMessageRepository {
  constructor(private readonly drizzle: DrizzleService) {}

  private toChatMessage(row: typeof messages.$inferSelect): ChatMessage {
    return {
      id: row.id,
      sessionId: row.sessionId,
      role: row.role as ChatMessage['role'],
      content: row.content,
      turnId: row.turnId ?? undefined,
      promptMessageId: row.promptMessageId ?? undefined,
      thinking: row.thinking ?? undefined,
      toolCalls: (row.toolCalls as ChatMessage['toolCalls']) ?? undefined,
      toolCallId: row.toolCallId ?? undefined,
      attachments: (row.attachments as ChatMessage['attachments']) ?? undefined,
      createdAt: toMs(row.createdAt),
    };
  }

  /** Validates the session row exists. Throws if the session was deleted. */
  async ensureSession(sessionId: string, personaId: string): Promise<void> {
    void personaId;
    const row = await this.drizzle.db
      .select({ id: sessions.id })
      .from(sessions)
      .where(eq(sessions.id, sessionId))
      .then((r) => r[0]);
    if (!row) {
      const err = new Error(`Session ${sessionId} not found`);
      (err as NodeJS.ErrnoException).code = 'SESSION_NOT_FOUND';
      throw err;
    }
  }

  async loadHistory(sessionId: string): Promise<ChatMessage[]> {
    const rows = await this.drizzle.db
      .select()
      .from(messages)
      .where(eq(messages.sessionId, sessionId))
      .orderBy(asc(messages.createdAt));

    return rows.map((row) => this.toChatMessage(row));
  }

  async loadHistoryPage(sessionId: string, options: SessionMessagePageOptions = {}): Promise<SessionMessagePage> {
    const normalizedLimit = Number.isInteger(options.limit)
      ? Math.max(1, Math.min(100, options.limit as number))
      : 40;
    const anchorId = typeof options.beforeMessageId === 'string' && options.beforeMessageId.trim().length > 0
      ? options.beforeMessageId.trim()
      : null;
    const [{ totalCount }] = await this.drizzle.db
      .select({ totalCount: count() })
      .from(messages)
      .where(eq(messages.sessionId, sessionId));

    let anchorRow: Pick<typeof messages.$inferSelect, 'id' | 'createdAt'> | null = null;
    if (anchorId) {
      anchorRow = await this.drizzle.db
        .select({ id: messages.id, createdAt: messages.createdAt })
        .from(messages)
        .where(and(eq(messages.sessionId, sessionId), eq(messages.id, anchorId)))
        .then((rows) => rows[0] ?? null);
    }

    const pageRows = await this.drizzle.db
      .select()
      .from(messages)
      .where(anchorRow
        ? and(
          eq(messages.sessionId, sessionId),
          or(
            lt(messages.createdAt, anchorRow.createdAt),
            and(eq(messages.createdAt, anchorRow.createdAt), lt(messages.id, anchorRow.id)),
          ),
        )
        : eq(messages.sessionId, sessionId))
      .orderBy(desc(messages.createdAt), desc(messages.id))
      .limit(normalizedLimit + 1);

    const hasMoreBefore = pageRows.length > normalizedLimit;
    const trimmedRows = hasMoreBefore ? pageRows.slice(0, normalizedLimit) : pageRows;
    const orderedRows = [...trimmedRows].reverse();
    const orderedMessages = orderedRows.map((row) => this.toChatMessage(row));

    return {
      messages: orderedMessages,
      totalCount,
      hasMoreBefore,
      oldestLoadedMessageId: orderedMessages[0]?.id ?? null,
    };
  }

  async saveMessage(msg: ChatMessage): Promise<void> {
    await this.drizzle.db.insert(messages).values({
      id: msg.id,
      sessionId: msg.sessionId,
      role: msg.role,
      content: msg.content,
      turnId: msg.turnId ?? null,
      promptMessageId: msg.promptMessageId ?? null,
      thinking: msg.thinking ?? null,
      toolCalls: msg.toolCalls ?? null,
      toolCallId: msg.toolCallId ?? null,
      attachments: msg.attachments ?? null,
      createdAt: new Date(msg.createdAt),
    });
  }
}
