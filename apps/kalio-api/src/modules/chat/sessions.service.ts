import { Injectable, Inject, NotFoundException } from '@nestjs/common';
import { nanoid } from 'nanoid';
import { eq, desc, isNull } from 'drizzle-orm';
import type { ChatSession, ChatMessage, ChatSessionKind, CreateSessionDto, SessionRuntimeContext } from '@kalio/types';
import { DrizzleService } from '../../database/drizzle.service';
import { sessions } from '../../database/schema';
import { SessionManagerService } from './session-manager.service';
import type { IMessageRepository } from './interfaces/message-repository.interface';
import { MESSAGE_REPOSITORY } from './chat.tokens';
import { SessionEventsService } from './session-events.service';

const toMs = (v: number | Date): number => (v instanceof Date ? v.getTime() : v);

@Injectable()
export class SessionsService {
  constructor(
    private readonly drizzle: DrizzleService,
    private readonly sessionManager: SessionManagerService,
    private readonly sessionEvents: SessionEventsService,
    @Inject(MESSAGE_REPOSITORY) private readonly repo: IMessageRepository,
  ) {}

  async list(options: { includeArchived?: boolean } = {}): Promise<ChatSession[]> {
    const query = this.drizzle.db
      .select()
      .from(sessions);
    const rows = await (options.includeArchived
      ? query.orderBy(desc(sessions.updatedAt))
      : query.where(isNull(sessions.archivedAt)).orderBy(desc(sessions.updatedAt)));
    return rows.map(this.toChatSession);
  }

  async create(dto: CreateSessionDto): Promise<ChatSession> {
    return this.createWithId(nanoid(), dto);
  }

  async createWithId(id: string, dto: CreateSessionDto): Promise<ChatSession> {
    const now = new Date();
    const row = {
      id,
      personaId: dto.personaId ?? 'default',
      title: dto.title ?? 'New Chat',
      kind: dto.kind ?? 'chat',
      parentSessionId: dto.parentSessionId ?? null,
      parentTurnId: dto.parentTurnId ?? null,
      parentToolCallId: dto.parentToolCallId ?? null,
      runtimeContext: dto.runtimeContext ?? null,
      createdAt: now,
      updatedAt: now,
    };
    await this.drizzle.db.insert(sessions).values(row);
    const session = this.toChatSession(row);
    this.sessionEvents.emitSessionCreated(session);
    return session;
  }

  async get(id: string): Promise<ChatSession> {
    const row = await this.getRow(id);
    return this.toChatSession(row);
  }

  async getMessages(sessionId: string): Promise<ChatMessage[]> {
    await this.assertExists(sessionId);
    return this.repo.loadHistory(sessionId);
  }

  async listChildren(parentSessionId: string): Promise<ChatSession[]> {
    const rows = await this.drizzle.db
      .select()
      .from(sessions)
      .where(eq(sessions.parentSessionId, parentSessionId));
    return rows.map(this.toChatSession);
  }

  async delete(id: string): Promise<void> {
    await this.assertExists(id);
    await this.drizzle.db.delete(sessions).where(eq(sessions.id, id));
  }

  async archive(id: string): Promise<void> {
    await this.assertExists(id);
    const now = new Date();
    await this.drizzle.db
      .update(sessions)
      .set({ archivedAt: now, updatedAt: now })
      .where(eq(sessions.id, id));
    this.sessionEvents.emitSessionUpdated(await this.get(id));
  }

  async restore(id: string): Promise<void> {
    await this.assertExists(id);
    await this.drizzle.db
      .update(sessions)
      .set({ archivedAt: null, updatedAt: new Date() })
      .where(eq(sessions.id, id));
    this.sessionEvents.emitSessionUpdated(await this.get(id));
  }

  async rename(id: string, title: string): Promise<void> {
    await this.update(id, { title });
  }

  async update(id: string, patch: { title?: string; personaId?: string; runtimeContext?: SessionRuntimeContext }): Promise<void> {
    await this.assertExists(id);
    const hasPatch = patch.title !== undefined || patch.personaId !== undefined || patch.runtimeContext !== undefined;
    if (hasPatch) {
      const set: Record<string, unknown> = { updatedAt: new Date() };
      if (patch.title !== undefined) set.title = patch.title;
      if (patch.personaId !== undefined) set.personaId = patch.personaId;
      if (patch.runtimeContext !== undefined) set.runtimeContext = patch.runtimeContext;
      await this.drizzle.db.update(sessions).set(set).where(eq(sessions.id, id));
      this.sessionEvents.emitSessionUpdated(await this.get(id));
    }
  }

  async updateRuntimeContext(id: string, runtimeContext: SessionRuntimeContext): Promise<void> {
    await this.assertExists(id);
    await this.drizzle.db
      .update(sessions)
      .set({ runtimeContext, updatedAt: new Date() })
      .where(eq(sessions.id, id));
    this.sessionEvents.emitSessionUpdated(await this.get(id));
  }

  async generateTitle(id: string): Promise<{ title: string }> {
    await this.assertExists(id);
    const history = await this.repo.loadHistory(id);
    const firstUser = history.find((message) => message.role === 'user');
    const normalized = firstUser?.content.replace(/\s+/g, ' ').trim() ?? '';
    const title = normalized.length === 0
      ? 'New Chat'
      : normalized.length > 60
        ? `${normalized.slice(0, 60).trimEnd()}…`
        : normalized;
    await this.update(id, { title });
    return { title };
  }

  private async assertExists(id: string): Promise<void> {
    await this.getRow(id);
  }

  private async getRow(id: string): Promise<{
    id: string;
    personaId: string;
    title: string;
    kind?: ChatSessionKind;
    parentSessionId?: string | null;
    parentTurnId?: string | null;
    parentToolCallId?: string | null;
    runtimeContext?: SessionRuntimeContext | null;
    createdAt: number | Date;
    updatedAt: number | Date;
  }> {
    const [row] = await this.drizzle.db
      .select()
      .from(sessions)
      .where(eq(sessions.id, id))
      .limit(1);
    if (!row) throw new NotFoundException(`Session not found: ${id}`);
    return row;
  }

  private toChatSession(row: {
    id: string;
    personaId: string;
    title: string;
    kind?: ChatSessionKind;
    parentSessionId?: string | null;
    parentTurnId?: string | null;
    parentToolCallId?: string | null;
    runtimeContext?: SessionRuntimeContext | null;
    createdAt: number | Date;
    updatedAt: number | Date;
  }): ChatSession {
    return {
      id: row.id,
      personaId: row.personaId,
      title: row.title,
      kind: row.kind ?? 'chat',
      parentSessionId: row.parentSessionId ?? undefined,
      parentTurnId: row.parentTurnId ?? undefined,
      parentToolCallId: row.parentToolCallId ?? undefined,
      runtimeContext: row.runtimeContext ?? undefined,
      createdAt: toMs(row.createdAt),
      updatedAt: toMs(row.updatedAt),
    };
  }
}
