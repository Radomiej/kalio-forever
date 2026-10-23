import { BadRequestException, ConflictException, Injectable, Inject, Logger, NotFoundException, Optional } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { nanoid } from 'nanoid';
import { eq, desc, inArray, isNull } from 'drizzle-orm';
import type {
  AssignSessionProjectDto,
  ChatSession,
  ChatMessage,
  CreateSessionDto,
  SessionRuntimeContext,
  ExecutionProfileLookupPort,
} from '@kalio/types';
import { EXECUTION_PROFILE_LOOKUP } from '@kalio/types';
import { DrizzleService } from '../../database/drizzle.service';
import { sessions } from '../../database/schema';
import { SessionManagerService } from './session-manager.service';
import type { IMessageRepository } from './interfaces/message-repository.interface';
import { MESSAGE_REPOSITORY } from './chat.tokens';
import { SessionEventsService } from './session-events.service';
import { toChatSession } from './session-row';
import { DEFAULT_SESSION_TITLE, insertSessionRecord, runtimeProjectPath } from './session-creation';
import { sessionDescendantIds } from './session-tree.utils';
import { sessionTreeStopAdmission, type SessionTreeStopClaim } from '../../database/session-tree-stop-admission';
import { LLMService } from '../llm/llm.service';
import { AllowedPathsService } from '../allowed-paths/allowed-paths.service';
import { ProjectsService, SYSTEM_PROJECT_IDS } from './projects.service';
import type { SessionMessagePage } from './interfaces/message-repository.interface';
import { ActiveSessionRegistry } from './active-session-registry.service';
import { PersonaService } from '../persona/persona.service';
import { prepareSessionProfileUpdate } from './session-profile-update';
import { SessionProfileAdmissionService } from './session-profile-admission.service';
import { ARCHITECTURE_RUNTIME_STOP, type ArchitectureRuntimeStopPort } from './architecture-runtime-stop.port';
import {
  buildTitlePrompt as buildSessionTitlePrompt,
  deriveFallbackTitle as deriveSessionFallbackTitle,
  normalizeGeneratedTitle as normalizeSessionTitle,
  normalizedUserPrompt as normalizeSessionPrompt,
} from './sessions-title.utils';

const MAX_SESSION_LIST_LIMIT = 500;
interface SessionRuntimeScopeOptions {
  registerRuntimeProjectPath?: boolean;
}

interface SessionListOptions {
  includeArchived?: boolean;
  limit?: number;
}

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
    @Optional() @Inject(ActiveSessionRegistry) private readonly activeSessionRegistry: ActiveSessionRegistry | undefined,
    @Optional() @Inject(ModuleRef) private readonly moduleRef: ModuleRef | undefined,
    @Optional() @Inject(PersonaService) private readonly personas: PersonaService | undefined,
    @Optional() @Inject(EXECUTION_PROFILE_LOOKUP) private readonly executionProfiles: ExecutionProfileLookupPort | undefined,
    private readonly profileAdmission: SessionProfileAdmissionService,
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
    return rows.map(toChatSession);
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
    const session = insertSessionRecord(this.drizzle.db, id, dto, scope);
    this.sessionEvents.emitSessionCreated(session);
    return session;
  }

  async get(id: string): Promise<ChatSession> {
    const row = await this.getRow(id);
    return toChatSession(row);
  }

  claimTreeStop(id: string): SessionTreeStopClaim {
    return sessionTreeStopAdmission(this.drizzle.db).claim(id);
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
    return rows.map(toChatSession);
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

  async update(id: string, patch: { title?: string; personaId?: string; executionProfileId?: string; runtimeContext?: SessionRuntimeContext }): Promise<void> {
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
    const targetExecutionProfileId = project?.defaultExecutionProfileId ?? 'local-direct-default';
    const affectedSessionsForProfile = await Promise.all((await this.collectDescendantIds(id)).map((sessionId) => this.get(sessionId)));
    const profileMismatch = affectedSessionsForProfile.find((session) => (
      session.executionProfileId !== undefined
      && session.executionProfileId !== targetExecutionProfileId
    ));
    if (profileMismatch) {
      throw new ConflictException('A session is bound to another execution profile; create a new chat to change it.');
    }
    const hasPathChange = dto.pathOverride !== undefined;
    const path = hasPathChange
      ? (dto.pathOverride?.trim() || project?.path) ?? null
      : undefined;
    if (path && hasPathChange) {
      await this.allowedPaths.ensurePath(path);
    }

    const descendants = await this.collectDescendantIds(id);
    const activeSessionId = descendants.find((sessionId) => this.activeSessionRegistry?.isActive(sessionId))
      ?? this.getArchitectureRuntimeStopPort()?.findActiveSessionIdForSessions?.(descendants);
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
    patch: { title?: string; personaId?: string; executionProfileId?: string; runtimeContext?: SessionRuntimeContext },
    options: SessionRuntimeScopeOptions = {},
  ): Promise<void> {
    // Path registration may notify other consumers; keep it outside admission.
    await this.registerRuntimeProjectPathIfRequested(patch.runtimeContext, options);
    const updated = await this.profileAdmission.runMutation(id, async assertNotStopped => {
      const current = await this.get(id);
      const assertMutable = () => {
        assertNotStopped();
        if (this.activeSessionRegistry?.isActive(id)) {
          throw new ConflictException('Execution profile cannot change while this conversation is generating.');
        }
      };
      const nextExecutionProfileId = await prepareSessionProfileUpdate({
        current, patch, repository: this.repo, profiles: this.executionProfiles,
        personaProfile: async personaId => (await this.personas?.getSessionConfig(personaId))?.executionProfileId,
        assertMutable,
      });
      const hasPatch = patch.title !== undefined || patch.personaId !== undefined || nextExecutionProfileId !== undefined || patch.runtimeContext !== undefined;
      if (!hasPatch) return undefined;
      if (nextExecutionProfileId !== undefined) assertMutable();
      const set: Record<string, unknown> = { updatedAt: new Date() };
      if (patch.title !== undefined) set.title = patch.title;
      if (patch.personaId !== undefined) set.personaId = patch.personaId;
      if (nextExecutionProfileId !== undefined) set.executionProfileId = nextExecutionProfileId;
      if (patch.runtimeContext !== undefined) set.runtimeContext = patch.runtimeContext;
      this.drizzle.db.update(sessions).set(set).where(eq(sessions.id, id)).run();
      return this.get(id);
    });
    if (updated) this.sessionEvents.emitSessionUpdated(updated);
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

  async bindExternalThread(
    id: string,
    externalThreadId: string,
    binding: { toolsetFingerprint?: string; policyFingerprint?: string } = {},
  ): Promise<void> {
    await this.assertExists(id);
    await this.drizzle.db
      .update(sessions)
      .set({
        externalThreadId,
        ...(binding.toolsetFingerprint ? { toolsetFingerprint: binding.toolsetFingerprint } : {}),
        ...(binding.policyFingerprint ? { policyFingerprint: binding.policyFingerprint } : {}),
        runtimeBindingVersion: 1,
        updatedAt: new Date(),
      })
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
    const title = normalizeSessionTitle(generated)
      ?? deriveSessionFallbackTitle(history, row.runtimeContext, DEFAULT_SESSION_TITLE);
    await this.update(id, { title });
    return { title };
  }

  private async tryGenerateConversationTitle(id: string, history: ChatMessage[]): Promise<string | null> {
    const messages = buildSessionTitlePrompt(history);
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

    const normalized = normalizeSessionTitle(rawResponse);
    if (!normalized) {
      return null;
    }

    const promptText = normalizeSessionPrompt(history);
    if (normalized.startsWith('[MockLLM] Echo:')) {
      return null;
    }
    if (promptText && normalized.toLowerCase() === (normalizeSessionTitle(promptText)?.toLowerCase() ?? '')) {
      return null;
    }
    return normalized;
  }

  private async resolveProjectScope(dto: CreateSessionDto): Promise<{
    projectId: string;
    executionProfileId: string;
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
    const explicitProfileId = dto.executionProfileId?.trim() || undefined;
    const parentProfileId = parent?.executionProfileId?.trim() || undefined;
    if (parent && explicitProfileId && parentProfileId && explicitProfileId !== parentProfileId) {
      throw new BadRequestException('A child session must use its host execution profile.');
    }
    const personaProfileId = parent
      ? undefined
      : (await this.personas?.getSessionConfig(dto.personaId))?.executionProfileId;
    const defaultProfileId = parent ? undefined : await this.executionProfiles?.getDefaultId();
    if (projectId === SYSTEM_PROJECT_IDS.none) {
      if (requestedProjectId === SYSTEM_PROJECT_IDS.none && dto.projectPathOverride?.trim()) {
        throw new BadRequestException('The no-project session cannot have a path override.');
      }
      return {
        projectId,
        executionProfileId: this.resolveProfileId({
          explicitProfileId: parentProfileId ?? explicitProfileId,
          personaProfileId: defaultProfileId ?? personaProfileId,
          projectProfileId: 'local-direct-default',
        }),
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
      executionProfileId: this.resolveProfileId({
        explicitProfileId: parentProfileId ?? explicitProfileId,
        personaProfileId: defaultProfileId ?? personaProfileId,
        projectProfileId: project.defaultExecutionProfileId,
      }),
      runtimeContext: this.applyProjectPath(dto.runtimeContext, path),
    };
  }

  private resolveProfileId(selection: Parameters<ExecutionProfileLookupPort['resolveId']>[0]): string {
    if (!this.executionProfiles) throw new ConflictException('Execution profile selection is unavailable.');
    return this.executionProfiles.resolveId(selection);
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
    return sessionDescendantIds(id, rows);
  }

  private async assertExists(id: string): Promise<void> {
    await this.getRow(id);
  }

  private async getRow(id: string): Promise<Parameters<typeof toChatSession>[0]> {
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
    const projectPath = runtimeProjectPath(runtimeContext);
    if (!projectPath) {
      return;
    }
    await this.allowedPaths.ensurePath(projectPath);
  }

  private getArchitectureRuntimeStopPort(): ArchitectureRuntimeStopPort | undefined {
    try {
      return this.moduleRef?.get<ArchitectureRuntimeStopPort>(ARCHITECTURE_RUNTIME_STOP, { strict: false });
    } catch {
      return undefined;
    }
  }
}

function normalizeSessionListLimit(options: SessionListOptions): number | undefined {
  if (typeof options.limit === 'number' && Number.isFinite(options.limit)) {
    return Math.min(MAX_SESSION_LIST_LIMIT, Math.max(1, Math.trunc(options.limit)));
  }
  return undefined;
}
