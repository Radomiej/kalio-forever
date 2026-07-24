import { BadRequestException, ConflictException, Injectable, Inject, Logger, NotFoundException, Optional } from '@nestjs/common';
import { nanoid } from 'nanoid';
import { eq, desc, inArray, isNull } from 'drizzle-orm';
import type {
  AssignSessionProjectDto,
  ChatSession,
  ChatMessage,
  ChatSessionKind,
  CreateSessionDto,
  SessionRuntimeContext,
} from '@kalio/types';
import { DrizzleService } from '../../database/drizzle.service';
import { sessions } from '../../database/schema';
import { SessionManagerService } from './session-manager.service';
import type { IMessageRepository } from './interfaces/message-repository.interface';
import { MESSAGE_REPOSITORY } from './chat.tokens';
import { SessionEventsService } from './session-events.service';
import { LLMService } from '../llm/llm.service';
import type { ContextManagedLLMMessage } from '../../common/utils/context-managed-llm-message.util';
import { AllowedPathsService } from '../allowed-paths/allowed-paths.service';
import { ProjectsService, SYSTEM_PROJECT_IDS } from './projects.service';
import type { SessionMessagePage } from './interfaces/message-repository.interface';
import { ActiveSessionRegistry } from './active-session-registry.service';

const toMs = (v: number | Date): number => (v instanceof Date ? v.getTime() : v);
const DEFAULT_SESSION_TITLE = 'New Chat';
const DEFAULT_ACTIVE_SESSION_LIST_LIMIT = 250;
const MAX_SESSION_LIST_LIMIT = 500;
const MAX_TITLE_LENGTH = 60;
interface SessionRuntimeScopeOptions {
  registerRuntimeProjectPath?: boolean;
}

interface SessionListOptions {
  includeArchived?: boolean;
  limit?: number;
}

const TITLE_SYSTEM_PROMPT = [
  'Generate a concise conversation title.',
  'Summarize the real user goal instead of copying the prompt.',
  'Return plain title text only.',
  'Use 2 to 6 words when possible.',
  `Never exceed ${MAX_TITLE_LENGTH} characters.`,
  'No quotes, markdown, or trailing punctuation.',
].join(' ');
const TITLE_STOPWORDS = new Set([
  'a', 'an', 'and', 'as', 'at', 'be', 'by', 'do', 'for', 'from', 'if', 'in', 'into', 'is', 'it', 'its', 'of', 'ok',
  'on', 'or', 'out', 'reply', 'that', 'the', 'this', 'to', 'use', 'with', 'without', 'you',
  'ale', 'bo', 'by', 'co', 'czy', 'dla', 'do', 'i', 'jak', 'na', 'nie', 'oraz', 'po', 'to', 'użyj', 'uzyj', 'w',
  'we', 'z',
]);

@Injectable()
export class SessionsService {
  private readonly logger = new Logger(SessionsService.name);

  constructor(
    private readonly drizzle: DrizzleService,
    private readonly sessionManager: SessionManagerService,
    private readonly sessionEvents: SessionEventsService,
    @Inject(MESSAGE_REPOSITORY) private readonly repo: IMessageRepository,
    private readonly llm: LLMService,
    private readonly allowedPaths: AllowedPathsService,
    private readonly projects: ProjectsService,
    @Optional() private readonly activeSessionRegistry?: ActiveSessionRegistry,
  ) {}

  async list(options: SessionListOptions = {}): Promise<ChatSession[]> {
    const limit = normalizeSessionListLimit(options);
    const query = this.drizzle.db
      .select()
      .from(sessions);
    const orderedQuery = options.includeArchived
      ? query.orderBy(desc(sessions.updatedAt))
      : query.where(isNull(sessions.archivedAt)).orderBy(desc(sessions.updatedAt));
    const rows = await (limit === undefined ? orderedQuery : orderedQuery.limit(limit));
    return rows.map(this.toChatSession);
  }

  async create(dto: CreateSessionDto): Promise<ChatSession> {
    return this.createWithId(nanoid(), dto);
  }

  async createWithId(
    id: string,
    dto: CreateSessionDto,
    options: SessionRuntimeScopeOptions = {},
  ): Promise<ChatSession> {
    const scope = await this.resolveProjectScope(dto);
    await this.registerRuntimeProjectPathIfRequested(scope.runtimeContext ?? undefined, options);
    const now = new Date();
    const row = {
      id,
      personaId: dto.personaId ?? 'default',
      title: dto.title ?? DEFAULT_SESSION_TITLE,
      kind: dto.kind ?? 'chat',
      parentSessionId: dto.parentSessionId ?? null,
      parentTurnId: dto.parentTurnId ?? null,
      parentToolCallId: dto.parentToolCallId ?? null,
      projectId: scope.projectId,
      runtimeContext: scope.runtimeContext ?? null,
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

  async getMessagePage(
    sessionId: string,
    options: { limit?: number; beforeMessageId?: string } = {},
  ): Promise<SessionMessagePage> {
    await this.assertExists(sessionId);
    return this.repo.loadHistoryPage(sessionId, options);
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
    return this.updateWithOptions(id, patch);
  }


  async assignProject(id: string, dto: AssignSessionProjectDto): Promise<ChatSession> {
    await this.assertExists(id);
    const projectId = dto.projectId.trim();
    if (!projectId) {
      throw new BadRequestException('Project id is required.');
    }
    const project = projectId === SYSTEM_PROJECT_IDS.none
      ? undefined
      : await this.projects.assertAssignable(projectId);
    if (projectId === SYSTEM_PROJECT_IDS.none && dto.pathOverride?.trim()) {
      throw new BadRequestException('The no-project session cannot have a path override.');
    }
    const current = await this.get(id);
    const hasPathChange = dto.pathOverride !== undefined;
    const path = hasPathChange
      ? (dto.pathOverride?.trim() || project?.path) ?? null
      : undefined;
    if (path && hasPathChange) {
      await this.allowedPaths.ensurePath(path);
    }

    const descendants = await this.collectDescendantIds(id);
    const activeSessionId = descendants.find((sessionId) => this.activeSessionRegistry?.isActive(sessionId));
    if (activeSessionId) {
      throw new ConflictException({
        message: 'Project cannot be changed while this conversation is generating.',
        sessionId: activeSessionId,
      });
    }
    const runtimeContext = hasPathChange
      ? this.applyProjectPath(current.runtimeContext, path ?? null)
      : undefined;
    const affectedSessions = hasPathChange
      ? await Promise.all(descendants.map((sessionId) => this.get(sessionId)))
      : [];
    this.drizzle.db.transaction((tx) => {
      tx.update(sessions)
        .set({ projectId })
        .where(inArray(sessions.id, descendants))
        .run();
      if (runtimeContext !== undefined) {
        for (const affectedSession of affectedSessions) {
          tx.update(sessions)
            .set({ runtimeContext: this.applyProjectPath(affectedSession.runtimeContext, path ?? null) })
            .where(eq(sessions.id, affectedSession.id))
            .run();
        }
      }
    });
    for (const descendantId of descendants) {
      const session = await this.get(descendantId);
      this.sessionEvents.emitSessionUpdated(session);
    }
    return this.get(id);
  }

  async updateWithOptions(
    id: string,
    patch: { title?: string; personaId?: string; runtimeContext?: SessionRuntimeContext },
    options: SessionRuntimeScopeOptions = {},
  ): Promise<void> {
    await this.assertExists(id);
    const hasPatch = patch.title !== undefined || patch.personaId !== undefined || patch.runtimeContext !== undefined;
    if (hasPatch) {
      await this.registerRuntimeProjectPathIfRequested(patch.runtimeContext, options);
      const set: Record<string, unknown> = { updatedAt: new Date() };
      if (patch.title !== undefined) set.title = patch.title;
      if (patch.personaId !== undefined) set.personaId = patch.personaId;
      if (patch.runtimeContext !== undefined) set.runtimeContext = patch.runtimeContext;
      await this.drizzle.db.update(sessions).set(set).where(eq(sessions.id, id));
      this.sessionEvents.emitSessionUpdated(await this.get(id));
    }
  }

  async updateRuntimeContext(
    id: string,
    runtimeContext: SessionRuntimeContext,
    options: SessionRuntimeScopeOptions = {},
  ): Promise<void> {
    await this.assertExists(id);
    await this.registerRuntimeProjectPathIfRequested(runtimeContext, options);
    await this.drizzle.db
      .update(sessions)
      .set({ runtimeContext, updatedAt: new Date() })
      .where(eq(sessions.id, id));
    this.sessionEvents.emitSessionUpdated(await this.get(id));
  }

  async registerRuntimeProjectPathForSession(id: string): Promise<void> {
    const row = await this.getRow(id);
    await this.registerRuntimeProjectPathIfRequested(row.runtimeContext ?? undefined, {
      registerRuntimeProjectPath: true,
    });
  }

  async generateTitle(id: string): Promise<{ title: string }> {
    const row = await this.getRow(id);
    const history = await this.repo.loadHistory(id);
    const firstUser = history.find((message) => message.role === 'user');
    if (!firstUser) {
      await this.update(id, { title: DEFAULT_SESSION_TITLE });
      return { title: DEFAULT_SESSION_TITLE };
    }

    const generated = await this.tryGenerateConversationTitle(id, history);
    const title = normalizeGeneratedTitle(generated) ?? deriveFallbackTitle(history, row.runtimeContext);
    await this.update(id, { title });
    return { title };
  }

  private async tryGenerateConversationTitle(id: string, history: ChatMessage[]): Promise<string | null> {
    const messages = buildTitlePrompt(history);
    let rawResponse = '';

    try {
      await this.llm.streamChat(messages, [], {
        sessionId: `session-title:${id}`,
        messageId: nanoid(),
        onChunk: (chunk) => {
          if (!chunk.thinking) {
            rawResponse += chunk.delta;
          }
        },
      });
    } catch (error) {
      this.logger.warn(`Conversation title generation failed for ${id}: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }

    const normalized = normalizeGeneratedTitle(rawResponse);
    if (!normalized) {
      return null;
    }

    const promptText = normalizedUserPrompt(history);
    if (normalized.startsWith('[MockLLM] Echo:')) {
      return null;
    }
    if (promptText && normalized.toLowerCase() === (normalizeGeneratedTitle(promptText)?.toLowerCase() ?? '')) {
      return null;
    }
    return normalized;
  }

  private async resolveProjectScope(dto: CreateSessionDto): Promise<{
    projectId: string;
    runtimeContext: SessionRuntimeContext | null | undefined;
  }> {
    const requestedProjectId = dto.projectId?.trim() || undefined;
    const hostSessionId = dto.runtimeContext?.architectureContext?.hostSessionId;
    const parentSessionId = dto.parentSessionId ?? hostSessionId;
    const parent = parentSessionId ? await this.get(parentSessionId) : undefined;
    const inheritedProjectId = parent?.projectId ?? SYSTEM_PROJECT_IDS.none;
    if (parent && requestedProjectId && requestedProjectId !== inheritedProjectId) {
      throw new BadRequestException('A child session must use its host project.');
    }

    const projectId = inheritedProjectId !== SYSTEM_PROJECT_IDS.none && parent
      ? inheritedProjectId
      : requestedProjectId ?? inheritedProjectId;
    if (projectId === SYSTEM_PROJECT_IDS.none) {
      if (requestedProjectId === SYSTEM_PROJECT_IDS.none && dto.projectPathOverride?.trim()) {
        throw new BadRequestException('The no-project session cannot have a path override.');
      }
      return {
        projectId,
        runtimeContext: requestedProjectId === SYSTEM_PROJECT_IDS.none
          ? this.clearProjectPath(dto.runtimeContext)
          : dto.runtimeContext,
      };
    }

    const project = await this.projects.assertAssignable(projectId);
    const path = dto.projectPathOverride === undefined ? project.path : dto.projectPathOverride.trim() || null;
    if (dto.projectPathOverride !== undefined && path) {
      await this.allowedPaths.ensurePath(path);
    }
    return {
      projectId,
      runtimeContext: this.applyProjectPath(dto.runtimeContext, path),
    };
  }

  private applyProjectPath(
    runtimeContext: SessionRuntimeContext | null | undefined,
    path: string | null,
  ): SessionRuntimeContext | null | undefined {
    if (!path) return this.clearProjectPath(runtimeContext);
    const architectureContext = {
      ...(runtimeContext?.architectureContext ?? {}),
      projectPath: path,
      executionCwd: path,
    };
    return {
      ...(runtimeContext ?? { runtimeKind: 'chat' }),
      architectureContext,
    };
  }

  private clearProjectPath(
    runtimeContext: SessionRuntimeContext | null | undefined,
  ): SessionRuntimeContext | null | undefined {
    if (!runtimeContext?.architectureContext) return runtimeContext;
    const architectureContext = { ...runtimeContext.architectureContext };
    delete architectureContext.projectPath;
    delete architectureContext.executionCwd;
    return {
      ...runtimeContext,
      architectureContext,
    };
  }

  private async collectDescendantIds(id: string): Promise<string[]> {
    const rows = await this.drizzle.db
      .select({ id: sessions.id, parentSessionId: sessions.parentSessionId })
      .from(sessions);
    const childrenByParent = new Map<string, string[]>();
    for (const row of rows) {
      if (!row.parentSessionId) continue;
      childrenByParent.set(row.parentSessionId, [
        ...(childrenByParent.get(row.parentSessionId) ?? []),
        row.id,
      ]);
    }
    const result: string[] = [];
    const pending = [id];
    const visited = new Set<string>();
    while (pending.length > 0) {
      const currentId = pending.shift();
      if (!currentId || visited.has(currentId)) continue;
      visited.add(currentId);
      result.push(currentId);
      pending.push(...(childrenByParent.get(currentId) ?? []));
    }
    return result;
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
    projectId?: string | null;
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

  private async registerRuntimeProjectPathIfRequested(
    runtimeContext: SessionRuntimeContext | undefined,
    options: SessionRuntimeScopeOptions,
  ): Promise<void> {
    if (!options.registerRuntimeProjectPath) {
      return;
    }
    const projectPath = projectPathFromRuntimeContext(runtimeContext);
    if (!projectPath) {
      return;
    }
    await this.allowedPaths.ensurePath(projectPath);
  }

  private toChatSession(row: {
    id: string;
    personaId: string;
    title: string;
    kind?: ChatSessionKind;
    parentSessionId?: string | null;
    parentTurnId?: string | null;
    parentToolCallId?: string | null;
    projectId?: string | null;
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
      ...(row.projectId ? { projectId: row.projectId } : {}),
      runtimeContext: row.runtimeContext ?? undefined,
      createdAt: toMs(row.createdAt),
      updatedAt: toMs(row.updatedAt),
    };
  }
}

function projectPathFromRuntimeContext(runtimeContext: SessionRuntimeContext | null | undefined): string | undefined {
  const projectPath = runtimeContext?.architectureContext?.['projectPath'];
  if (typeof projectPath === 'string' && projectPath.trim().length > 0) {
    return projectPath.trim();
  }

  const executionCwd = runtimeContext?.architectureContext?.['executionCwd'];
  if (typeof executionCwd === 'string' && executionCwd.trim().length > 0) {
    return executionCwd.trim();
  }

  return undefined;
}

function normalizeSessionListLimit(options: SessionListOptions): number | undefined {
  if (typeof options.limit === 'number' && Number.isFinite(options.limit)) {
    return Math.min(MAX_SESSION_LIST_LIMIT, Math.max(1, Math.trunc(options.limit)));
  }
  return options.includeArchived ? undefined : DEFAULT_ACTIVE_SESSION_LIST_LIMIT;
}

function buildTitlePrompt(history: ChatMessage[]): ContextManagedLLMMessage[] {
  const userPrompt = normalizedUserPrompt(history);
  const latestAssistant = [...history]
    .reverse()
    .find((message) => message.role === 'assistant' && normalizeConversationLine(message.content).length > 0);

  return [
    {
      role: 'system',
      content: TITLE_SYSTEM_PROMPT,
    },
    {
      role: 'user',
      content: JSON.stringify({
        firstUserMessage: userPrompt,
        latestAssistantMessage: latestAssistant ? normalizeConversationLine(latestAssistant.content).slice(0, 600) : null,
      }),
    },
  ];
}

function normalizedUserPrompt(history: ChatMessage[]): string {
  const firstUser = history.find((message) => message.role === 'user');
  return firstUser ? stripArchitecturePrefix(normalizeConversationLine(firstUser.content)) : '';
}

function normalizeConversationLine(content: unknown): string {
  if (typeof content !== 'string') {
    return '';
  }

  return content.replace(/\s+/g, ' ').trim();
}

function normalizeGeneratedTitle(raw: string | null | undefined): string | null {
  if (!raw) {
    return null;
  }

  const normalized = raw
    .replace(/^```[\w-]*\s*/i, '')
    .replace(/\s*```$/i, '')
    .replace(/^["'`]+|["'`]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[.?!,:;\-–—]+$/u, '')
    .trim();

  if (normalized.length === 0) {
    return null;
  }

  const bounded = normalized.length > MAX_TITLE_LENGTH
    ? normalized.slice(0, MAX_TITLE_LENGTH).trimEnd()
    : normalized;
  return bounded.length > 0 ? bounded : null;
}

function deriveFallbackTitle(history: ChatMessage[], runtimeContext: SessionRuntimeContext | null | undefined): string {
  const firstUser = normalizedUserPrompt(history);
  if (!firstUser) {
    return DEFAULT_SESSION_TITLE;
  }

  const projectName = projectNameFromRuntimeContext(runtimeContext);
  if (/(architektur|architecture)/iu.test(firstUser)) {
    const architectureTitle = projectName ? `Architecture Review ${projectName}` : 'Architecture Review';
    return normalizeGeneratedTitle(architectureTitle) ?? DEFAULT_SESSION_TITLE;
  }

  const firstSentence = firstUser.split(/[.!?]/u).find((segment) => segment.trim().length > 0)?.trim() ?? firstUser;
  const titleTokens = (firstSentence.match(/[\p{L}\p{N}][\p{L}\p{N}_-]*/gu) ?? [])
    .filter((token) => token.length > 1)
    .filter((token) => !TITLE_STOPWORDS.has(token.toLowerCase()))
    .slice(0, 4);

  if (titleTokens.length > 0) {
    const candidate = titleTokens.map(titleTokenCase).join(' ');
    return normalizeGeneratedTitle(candidate) ?? DEFAULT_SESSION_TITLE;
  }

  return normalizeGeneratedTitle(firstSentence) ?? DEFAULT_SESSION_TITLE;
}

function stripArchitecturePrefix(content: string): string {
  return content.replace(/^\[Architecture:\s*[^\]]+\]\s*/i, '').trim();
}

function projectNameFromRuntimeContext(runtimeContext: SessionRuntimeContext | null | undefined): string | null {
  const projectPath = projectPathFromRuntimeContext(runtimeContext);
  if (!projectPath) {
    return null;
  }
  const normalized = projectPath.replaceAll('\\', '/').split('/').filter(Boolean);
  return normalized.at(-1) ?? null;
}

function titleTokenCase(token: string): string {
  if (token.toUpperCase() === token) {
    return token;
  }
  return `${token[0]?.toUpperCase() ?? ''}${token.slice(1).toLowerCase()}`;
}
