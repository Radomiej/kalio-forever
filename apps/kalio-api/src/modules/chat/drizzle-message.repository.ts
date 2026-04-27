import { Injectable } from '@nestjs/common';
import { eq, asc } from 'drizzle-orm';
import type { ChatMessage } from '@kalio/types';
import { DrizzleService } from '../../database/drizzle.service';
import { messages, sessions } from '../../database/schema';
import type { IMessageRepository } from './interfaces/message-repository.interface';

const toMs = (v: number | Date): number => (v instanceof Date ? v.getTime() : v);

/**
 * Production implementation of IMessageRepository backed by Drizzle/SQLite.
 * Also upserts the session row on ensureSession() so FK constraints are met
 * before any message is inserted.
 */
@Injectable()
export class DrizzleMessageRepository implements IMessageRepository {
  constructor(private readonly drizzle: DrizzleService) {}

  /** Creates the session row if it does not already exist (idempotent). */
  async ensureSession(sessionId: string, personaId: string): Promise<void> {
    const now = new Date();
    await this.drizzle.db
      .insert(sessions)
      .values({ id: sessionId, personaId, title: '', createdAt: now, updatedAt: now })
      .onConflictDoNothing();
  }

  async loadHistory(sessionId: string): Promise<ChatMessage[]> {
    const rows = await this.drizzle.db
      .select()
      .from(messages)
      .where(eq(messages.sessionId, sessionId))
      .orderBy(asc(messages.createdAt));

    return rows.map(row => ({
      id: row.id,
      sessionId: row.sessionId,
      role: row.role as ChatMessage['role'],
      content: row.content,
      thinking: row.thinking ?? undefined,
      toolCalls: (row.toolCalls as ChatMessage['toolCalls']) ?? undefined,
      toolCallId: row.toolCallId ?? undefined,
      attachments: (row.attachments as ChatMessage['attachments']) ?? undefined,
      createdAt: toMs(row.createdAt),
    }));
  }

  async saveMessage(msg: ChatMessage): Promise<void> {
    await this.drizzle.db.insert(messages).values({
      id: msg.id,
      sessionId: msg.sessionId,
      role: msg.role,
      content: msg.content,
      thinking: msg.thinking ?? null,
      toolCalls: msg.toolCalls ?? null,
      toolCallId: msg.toolCallId ?? null,
      attachments: msg.attachments ?? null,
      createdAt: new Date(msg.createdAt),
    });
  }
}
