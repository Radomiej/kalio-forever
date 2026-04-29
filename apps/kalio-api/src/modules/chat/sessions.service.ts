import { Injectable, Inject, NotFoundException } from '@nestjs/common';
import { nanoid } from 'nanoid';
import { eq, desc } from 'drizzle-orm';
import type { ChatSession, ChatMessage, CreateSessionDto } from '@kalio/types';
import { DrizzleService } from '../../database/drizzle.service';
import { sessions } from '../../database/schema';
import { SessionManagerService } from './session-manager.service';
import type { IMessageRepository } from './interfaces/message-repository.interface';
import { MESSAGE_REPOSITORY } from './chat.tokens';

const toMs = (v: number | Date): number => (v instanceof Date ? v.getTime() : v);

/**
 * REST-facing service for chat session CRUD.
 * The streaming/turn handling lives in ChatService; this service only
 * manages session lifecycle and history retrieval.
 */
@Injectable()
export class SessionsService {
  constructor(
    private readonly drizzle: DrizzleService,
    private readonly sessionManager: SessionManagerService,
    @Inject(MESSAGE_REPOSITORY) private readonly repo: IMessageRepository,
  ) {}

  async list(): Promise<ChatSession[]> {
    const rows = await this.drizzle.db
      .select()
      .from(sessions)
      .orderBy(desc(sessions.updatedAt));
    return rows.map(this.toChatSession);
  }

  async create(dto: CreateSessionDto): Promise<ChatSession> {
    const now = new Date();
    const row = {
      id: nanoid(),
      personaId: dto.personaId ?? 'default',
      title: dto.title ?? 'New Chat',
      createdAt: now,
      updatedAt: now,
    };
    await this.drizzle.db.insert(sessions).values(row);
    return this.toChatSession(row);
  }

  async getMessages(sessionId: string): Promise<ChatMessage[]> {
    await this.assertExists(sessionId);
    return this.repo.loadHistory(sessionId);
  }

  async delete(id: string): Promise<void> {
    await this.assertExists(id);
    await this.drizzle.db.delete(sessions).where(eq(sessions.id, id));
  }

  async rename(id: string, title: string): Promise<void> {
    await this.assertExists(id);
    await this.drizzle.db
      .update(sessions)
      .set({ title, updatedAt: new Date() })
      .where(eq(sessions.id, id));
  }

  async generateTitle(id: string): Promise<{ title: string }> {
    await this.assertExists(id);
    const history = await this.repo.loadHistory(id);
    const firstUser = history.find((m) => m.role === 'user');
    const title = firstUser
      ? firstUser.content.slice(0, 60).trim() + (firstUser.content.length > 60 ? '…' : '')
      : 'New Chat';
    return { title };
  }

  private async assertExists(id: string): Promise<void> {
    const [row] = await this.drizzle.db
      .select()
      .from(sessions)
      .where(eq(sessions.id, id))
      .limit(1);
    if (!row) throw new NotFoundException(`Session not found: ${id}`);
  }

  private toChatSession(row: {
    id: string;
    personaId: string;
    title: string;
    createdAt: number | Date;
    updatedAt: number | Date;
  }): ChatSession {
    return {
      id: row.id,
      personaId: row.personaId,
      title: row.title,
      createdAt: toMs(row.createdAt),
      updatedAt: toMs(row.updatedAt),
    };
  }
}
