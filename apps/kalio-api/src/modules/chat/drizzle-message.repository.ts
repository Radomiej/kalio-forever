import { Injectable, Logger } from '@nestjs/common';
import { and, asc, count, desc, eq, gt, gte, inArray, isNull, lt, or, sql } from 'drizzle-orm';
import type { ChatMessage } from '@kalio/types';
import { DrizzleService } from '../../database/drizzle.service';
import { messages, sessions } from '../../database/schema';
import type { IMessageRepository, SessionMessagePage, SessionMessagePageOptions } from './interfaces/message-repository.interface';
import { SessionEventsService } from './session-events.service';
import { toChatSession } from './session-row';

const toMs = (v: number | Date): number => (v instanceof Date ? v.getTime() : v);
type MessageCursor = Pick<typeof messages.$inferSelect, 'id' | 'createdAt'>;
const beforeMessage = (row: MessageCursor) => or(
  lt(messages.createdAt, row.createdAt),
  and(eq(messages.createdAt, row.createdAt), lt(messages.id, row.id)),
);

/**
 * Production implementation of IMessageRepository backed by Drizzle/SQLite.
 * Also upserts the session row on ensureSession() so FK constraints are met
 * before any message is inserted.
 */
@Injectable()
export class DrizzleMessageRepository implements IMessageRepository {
  private readonly logger = new Logger(DrizzleMessageRepository.name);

  constructor(
    private readonly drizzle: DrizzleService,
    private readonly sessionEvents: SessionEventsService,
  ) {}

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
    // A synchronous read transaction keeps count, context and cursor on one snapshot.
    return this.drizzle.db.transaction((db) => {
      const [{ totalCount }] = db.select({ totalCount: count() }).from(messages)
        .where(eq(messages.sessionId, sessionId)).all();
      const anchorRow = anchorId ? db.select({ id: messages.id, createdAt: messages.createdAt })
        .from(messages).where(and(eq(messages.sessionId, sessionId), eq(messages.id, anchorId))).get() : undefined;
      const pageRows = db.select().from(messages)
        .where(and(eq(messages.sessionId, sessionId), anchorRow ? beforeMessage(anchorRow) : undefined))
        .orderBy(desc(messages.createdAt), desc(messages.id)).limit(normalizedLimit + 1).all();
      let hasMoreBefore = pageRows.length > normalizedLimit;
      let orderedRows = [...(hasMoreBefore ? pageRows.slice(0, normalizedLimit) : pageRows)].reverse();

      // The limit is a target. Close every linked turn encountered in the contiguous page.
      while (hasMoreBefore && orderedRows.length > 0) {
        const oldestRow = orderedRows[0];
        const turnIds = [...new Set(orderedRows.flatMap((row) => row.turnId ? [row.turnId] : []))];
        const promptIds = [...new Set(orderedRows.flatMap((row) => row.promptMessageId ? [row.promptMessageId] : []))];
        let boundary = oldestRow;
        // At most 750 linkage bindings per query, below the portable SQLite parameter limit.
        for (let offset = 0; offset < Math.max(turnIds.length, promptIds.length); offset += 250) {
          const turns = turnIds.slice(offset, offset + 250);
          const prompts = promptIds.slice(offset, offset + 250);
          const earlier = db.select().from(messages).where(and(
            eq(messages.sessionId, sessionId), beforeMessage(boundary), or(
              turns.length > 0 ? inArray(messages.turnId, turns) : undefined,
              prompts.length > 0 ? inArray(messages.promptMessageId, prompts) : undefined,
              prompts.length > 0 ? inArray(messages.id, prompts) : undefined,
            ),
          )).orderBy(asc(messages.createdAt), asc(messages.id)).limit(1).get();
          if (earlier) boundary = earlier;
        }
        // TODO: legacy fallback - wholly unlinked historical rows retain ordinary paging.
        if (boundary === oldestRow) break;
        const contextRows = db.select().from(messages).where(and(
          eq(messages.sessionId, sessionId), beforeMessage(oldestRow),
          or(gt(messages.createdAt, boundary.createdAt),
            and(eq(messages.createdAt, boundary.createdAt), gte(messages.id, boundary.id))),
        )).orderBy(asc(messages.createdAt), asc(messages.id)).all();
        orderedRows = [...contextRows, ...orderedRows];
        hasMoreBefore = Boolean(db.select({ id: messages.id }).from(messages)
          .where(and(eq(messages.sessionId, sessionId), beforeMessage(orderedRows[0]))).limit(1).get());
      }
      const orderedMessages = orderedRows.map((row) => this.toChatMessage(row));
      return {
        messages: orderedMessages,
        totalCount,
        hasMoreBefore,
        oldestLoadedMessageId: orderedMessages[0]?.id ?? null,
      };
    });
  }

  async saveMessage(msg: ChatMessage): Promise<void> {
    const updatedSession = this.drizzle.db.transaction((db) => {
      const existing = db.select({ id: messages.id }).from(messages).where(eq(messages.id, msg.id)).get();
      const insert = db.insert(messages).values({
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
      if (msg.role !== 'assistant') {
        insert.run();
      } else {
        const result = insert.onConflictDoUpdate({
          target: messages.id,
          set: {
            content: msg.content,
            thinking: msg.thinking ?? null,
            toolCalls: msg.toolCalls ?? null,
            toolCallId: msg.toolCallId ?? null,
            attachments: msg.attachments ?? null,
            turnId: sql`coalesce(${messages.turnId}, ${msg.turnId ?? null})`,
            promptMessageId: sql`coalesce(${messages.promptMessageId}, ${msg.promptMessageId ?? null})`,
          },
          setWhere: and(
            eq(messages.sessionId, msg.sessionId),
            eq(messages.role, 'assistant'),
            msg.turnId == null ? undefined : or(isNull(messages.turnId), eq(messages.turnId, msg.turnId)),
            msg.promptMessageId == null ? undefined : or(isNull(messages.promptMessageId), eq(messages.promptMessageId, msg.promptMessageId)),
          ),
        }).run();
        if (result.changes !== 1) {
          throw new Error(`Message ${msg.id} conflicts with existing ownership or turn linkage`);
        }
      }
      // Assistant finalization/replay keeps the original message creation time and recency.
      if (existing) return undefined;
      const row = db.update(sessions).set({ updatedAt: new Date(msg.createdAt) })
        .where(and(eq(sessions.id, msg.sessionId), lt(sessions.updatedAt, new Date(msg.createdAt))))
        .returning().get();
      return row ? toChatSession(row) : undefined;
    });
    if (updatedSession) {
      try {
        this.sessionEvents.emitSessionUpdated(updatedSession);
      } catch {
        this.logger.warn(`Session update publication failed after commit for session ${updatedSession.id}`);
      }
    }
  }
}
