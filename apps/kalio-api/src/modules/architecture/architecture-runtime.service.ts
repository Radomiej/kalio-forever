import { BadRequestException, Inject, Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import { nanoid } from 'nanoid';
import type {
  AgentFlowContinuationCursor,
  ArchitectureChatProjection,
  ArchitectureChildAgentProjection,
  ArchitectureExecutionMode,
  ArchitectureExecutionEvent,
  ArchitectureExecutionEventType,
  ChatMessage,
  ArchitectureGraphProjection,
  ArchitectureRoleSlot,
  ArchitectureRouteDecision,
  ArchitectureRouterOutput,
  ArchitectureSchema,
  ArchitectureRun,
  ArchitectureSchemaEdge,
  ArchitectureSchemaNode,
  CreateArchitectureRunDto,
} from '@kalio/types';
import { SessionsService } from '../chat/sessions.service';
import { SessionManagerService } from '../chat/session-manager.service';
import { AuditService, type AuditLogEntry } from '../chat/audit.service';
import { VFSService } from '../vfs/vfs.service';
import { ArchitectureRegistryService } from './architecture-registry.service';
import {
  ARCHITECTURE_ROLE_EXECUTOR,
  type ArchitectureRoleExecutionInput,
  type ArchitectureRoleExecutor,
} from './architecture-role-executor';
import { CLIAgentConfigService } from '../cli-agent/cli-agent-config.service';
import { mergeChildAgentStatus } from './architecture-cli-child-status';
import { createArchitectureGraphEvents } from './architecture-graph-runtime';
import { buildArchitectureGraphProjection } from './architecture-graph-projection';
import { reconstructDurableArchitectureGraph } from './architecture-durable-graph';
import { architectureActionFieldsForEvent, architectureActionSummaryForEvent } from './architecture-action-summary';
import { buildArchitectureParentChatMessages } from './architecture-parent-chat-projection';
import { hydrateArchitectureRootVfs, type ArchitectureVfsHydrationResult } from './architecture-vfs-hydration';
import { extractAllowanceContext } from '../agent-flow/agent-flow-launch-context';
import {
  createArchitectureBranchSessionRuntimeContext,
  createArchitectureRootSessionRuntimeContext,
  getArchitectureHistorySessionId,
  getArchitectureHostSessionId,
  getArchitectureParentSessionId,
  getArchitectureParentToolCallId,
} from './architecture-session-context';

const ARCHITECTURE_PERSONA_ALIASES: Record<string, string> = {
  'persona.pragmatist': 'dev',
  'persona.delivery_pragmatist': 'dev',
  'persona.innovator': 'jony',
  'persona.product_innovator': 'jony',
  'persona.analyst': 'web-research',
  'persona.cost_analyst': 'web-research',
  'persona.data_analyst': 'web-research',
  'persona.user_advocate': 'designer',
  'persona.power_user_advocate': 'designer',
  'persona.shadow': 'orchestrator',
  'persona.general_shadow': 'orchestrator',
  'persona.security_shadow': 'orchestrator',
  'persona.decision_router': 'orchestrator',
  'persona.conservative_architecture_router': 'orchestrator',
  'persona.security_router': 'orchestrator',
  'persona.adr_writer': 'dev',
};
const PERSISTED_GRAPH_RECOVERY_TIMEOUT_MS = 1500;
const ARCHITECTURE_CLI_AGENT_IDS = ['copilot', 'codex', 'gemini', 'claude'] as const;

@Injectable()
export class ArchitectureRuntimeService {
  private readonly logger = new Logger(ArchitectureRuntimeService.name);
  private readonly runs = new Map<string, ArchitectureRun>();
  private readonly eventsByRunId = new Map<string, ArchitectureExecutionEvent[]>();
  private readonly schemasByRunId = new Map<string, ArchitectureSchema>();
  private readonly stoppedRunIds = new Set<string>();

  constructor(
    private readonly registry: ArchitectureRegistryService,
    private readonly sessions: SessionsService,
    private readonly sessionManager: SessionManagerService,
    @Inject(ARCHITECTURE_ROLE_EXECUTOR) private readonly roleExecutor: ArchitectureRoleExecutor,
    @Optional() private readonly audit?: AuditService,
    @Optional() private readonly vfs?: VFSService,
    @Optional() private readonly cliAgentConfig?: Pick<CLIAgentConfigService, 'getConfig'>,
  ) {}

  async createRun(dto: CreateArchitectureRunDto, emit?: ArchitectureRoleExecutionInput['emit']): Promise<ArchitectureRun> {
    const prepared = await this.prepareRun(dto, 'running');
    return this.executePreparedRun(prepared, emit);
  }

  async createRunAsync(dto: CreateArchitectureRunDto, emit?: ArchitectureRoleExecutionInput['emit']): Promise<ArchitectureRun> {
    const prepared = await this.prepareRun(dto, 'running');
    const liveEvents: ArchitectureExecutionEvent[] = [];
    this.runs.set(prepared.run.id, prepared.run);
    this.schemasByRunId.set(prepared.run.id, this.cloneSchema(prepared.schema));
    this.eventsByRunId.set(prepared.run.id, liveEvents);
    await this.persistParentChatProjectionSafely(prepared.schema, prepared.run, liveEvents);

    void this.executePreparedRun(prepared, emit, liveEvents).catch(async (error: unknown) => {
      if (prepared.run.status !== 'running' || this.stoppedRunIds.has(prepared.run.id)) {
        return;
      }
      const now = Date.now();
      const errorMessage = error instanceof Error ? error.message : 'Unknown architecture runtime error';
      prepared.run.status = 'failed';
      prepared.run.updatedAt = now;
      prepared.run.completedAt = now;
      liveEvents.push({
        id: `${prepared.run.id}:event:${liveEvents.length + 1}`,
        runId: prepared.run.id,
        sequence: liveEvents.length + 1,
        type: 'router_decision',
        message: 'Architecture run failed.',
        data: {
          error: errorMessage,
        },
        createdAt: now,
      });
      this.runs.set(prepared.run.id, prepared.run);
      this.eventsByRunId.set(prepared.run.id, liveEvents);
      this.auditArchitectureFailure(prepared.schema, prepared.run, errorMessage);
      this.auditArchitectureRun(prepared.schema, prepared.run, liveEvents);
      await this.persistParentChatProjectionSafely(prepared.schema, prepared.run, liveEvents);
    });

    return prepared.run;
  }

  private async prepareRun(
    dto: CreateArchitectureRunDto,
    status: ArchitectureRun['status'],
  ): Promise<{ schema: ArchitectureSchema; run: ArchitectureRun; hydration: ArchitectureVfsHydrationResult | null }> {
    const normalizedDto = await this.normalizeCreateRunDto(dto);
    const baseSchema = this.registry.findOne(normalizedDto.schemaId);
    if (!baseSchema) throw new NotFoundException(`Architecture schema ${normalizedDto.schemaId} not found`);
    const schema = normalizedDto.schema ?? baseSchema;
    this.validateCreateRunSlotOverrides(schema, normalizedDto.slotOverrides);

    const now = Date.now();
    const runId = nanoid();
    const rootSessionId = `arch-${runId}-root`;
    const branchSessionIds = await this.createBranchSessions(schema, runId, rootSessionId, normalizedDto);
    const hydration = hydrateArchitectureRootVfs(this.vfs, rootSessionId, normalizedDto.context);
    const contextWithEvidence = await this.addCliAgentPreferencesToContext(
      this.addVfsEvidenceToContext(normalizedDto.context, rootSessionId, hydration),
    );
    const run: ArchitectureRun = {
      id: runId,
      schemaId: normalizedDto.schemaId,
      prompt: normalizedDto.prompt,
      executionMode: normalizedDto.executionMode ?? 'session_branches',
      context: contextWithEvidence,
      slotOverrides: normalizedDto.slotOverrides,
      rootSessionId,
      branchSessionIds,
      status,
      createdAt: now,
      updatedAt: now,
    };
    return { schema, run, hydration };
  }

  private async addCliAgentPreferencesToContext(
    context: Record<string, unknown> | undefined,
  ): Promise<Record<string, unknown> | undefined> {
    if (!this.cliAgentConfig || context?.['cliAgentToolPreferences'] !== undefined || context?.['availableCliAgents'] !== undefined) {
      return context;
    }
    const preferences: Record<string, { model?: string; preference?: string }> = {};
    const availableCliAgents: string[] = [];
    for (const agentId of ARCHITECTURE_CLI_AGENT_IDS) {
      const config = await this.cliAgentConfig.getConfig(agentId);
      if (!config.enabled) {
        continue;
      }
      availableCliAgents.push(agentId);
      const model = typeof config.model === 'string' && config.model.trim().length > 0
        ? config.model.trim()
        : undefined;
      const preference = typeof config.architecturePreference === 'string' && config.architecturePreference.trim().length > 0
        ? config.architecturePreference.trim()
        : undefined;
      if (model || preference) {
        preferences[agentId] = { ...(model ? { model } : {}), ...(preference ? { preference } : {}) };
      }
    }
    return {
      ...(context ?? {}),
      availableCliAgents,
      architectureCliAgentsEnabled: availableCliAgents.length > 0,
      ...(Object.keys(preferences).length > 0 ? { cliAgentToolPreferences: preferences } : {}),
    };
  }

  private async normalizeCreateRunDto(dto: CreateArchitectureRunDto): Promise<CreateArchitectureRunDto> {
    const validated = this.validateCreateRunDto(dto);
    const inheritedContext = await this.inheritAllowanceContext(validated.context);
    const contextWithPromptScope = this.addPromptProjectScope(inheritedContext, validated.prompt);
    return {
      ...validated,
      ...(contextWithPromptScope ? { context: contextWithPromptScope } : {}),
    };
  }

  private async inheritAllowanceContext(
    context: Record<string, unknown> | undefined,
  ): Promise<Record<string, unknown> | undefined> {
    if (!context) {
      return context;
    }
    const parentSessionId = getArchitectureParentSessionId(context);
    if (!parentSessionId) {
      return context;
    }

    const inherited = await this.resolveParentAllowanceBaseline(parentSessionId);
    if (Object.keys(inherited).length === 0) {
      return context;
    }
    return {
      ...inherited,
      ...context,
    };
  }

  private async resolveParentAllowanceBaseline(parentSessionId: string): Promise<Record<string, unknown>> {
    const baseline: Record<string, unknown> = {};
    const visited = new Set<string>();
    let currentSessionId: string | undefined = parentSessionId;

    while (currentSessionId && !visited.has(currentSessionId)) {
      visited.add(currentSessionId);
      try {
        const session = await this.sessions.get(currentSessionId);
        const allowanceContext = extractAllowanceContext(session.runtimeContext?.architectureContext);
        for (const [key, value] of Object.entries(allowanceContext)) {
          if (!(key in baseline)) {
            baseline[key] = value;
          }
        }
        currentSessionId = session.parentSessionId;
      } catch {
        break;
      }
    }

    return baseline;
  }

  private addPromptProjectScope(
    context: Record<string, unknown> | undefined,
    prompt: string,
  ): Record<string, unknown> | undefined {
    if (this.hasProjectScope(context)) {
      return context;
    }
    const inferredProjectPath = inferLocalProjectPathFromPrompt(prompt);
    if (!inferredProjectPath) {
      return context;
    }
    return {
      ...(context ?? {}),
      projectPath: inferredProjectPath,
      executionCwd: inferredProjectPath,
    };
  }

  private hasProjectScope(context: Record<string, unknown> | undefined): boolean {
    const projectPath = context?.['projectPath'];
    if (typeof projectPath === 'string' && projectPath.trim().length > 0) {
      return true;
    }
    const executionCwd = context?.['executionCwd'];
    return typeof executionCwd === 'string' && executionCwd.trim().length > 0;
  }

  private addVfsEvidenceToContext(
    context: Record<string, unknown> | undefined,
    rootSessionId: string,
    hydration: ArchitectureVfsHydrationResult | null,
  ): Record<string, unknown> | undefined {
    if (!hydration || !this.vfs || hydration.copiedFiles.length === 0) {
      return context;
    }

    const maxFiles = 12;
    const maxExcerptBytes = 1600;
    const maxTotalBytes = 12_000;
    let totalBytes = 0;
    const files: Array<{ path: string; sizeBytes: number; excerpt: string; truncated: boolean }> = [];
    for (const file of hydration.copiedFiles.slice(0, maxFiles)) {
      if (totalBytes >= maxTotalBytes) break;
      const buffer = this.vfs.readBinary(rootSessionId, file.toPath);
      const remainingBytes = Math.max(0, maxTotalBytes - totalBytes);
      const excerptBytes = Math.min(maxExcerptBytes, remainingBytes, buffer.length);
      const excerpt = buffer.subarray(0, excerptBytes).toString('utf8');
      files.push({
        path: file.toPath,
        sizeBytes: file.sizeBytes,
        excerpt,
        truncated: excerptBytes < buffer.length,
      });
      totalBytes += excerptBytes;
    }

    return {
      ...(context ?? {}),
      architectureVfsEvidence: {
        rootSessionId,
        sourceSessionId: hydration.fromSessionId,
        totalCopiedFiles: hydration.copiedFiles.length,
        files,
      },
    };
  }

  private async executePreparedRun(
    prepared: { schema: ArchitectureSchema; run: ArchitectureRun; hydration: ArchitectureVfsHydrationResult | null },
    emit?: ArchitectureRoleExecutionInput['emit'],
    liveEvents?: ArchitectureExecutionEvent[],
    priorEvents?: ArchitectureExecutionEvent[],
    resumeFrom?: AgentFlowContinuationCursor,
  ): Promise<ArchitectureRun> {
    const { hydration, run, schema } = prepared;
    const events = await createArchitectureGraphEvents({
      schema,
      run,
      now: run.createdAt,
      roleExecutor: this.roleExecutor,
      personaForSlot: (slot) => this.personaForRunSlot(run, slot),
      priorEvents,
      resumeFrom,
      emit,
      onEvent: liveEvents ? (event) => {
        if (this.stoppedRunIds.has(run.id)) {
          throw new Error(`Architecture run ${run.id} was stopped by the user.`);
        }
        liveEvents.push(event);
        run.updatedAt = Date.now();
        this.runs.set(run.id, run);
        this.auditArchitectureEvent(schema, run, event);
      } : undefined,
    });
    if (this.stoppedRunIds.has(run.id) || run.status !== 'running') {
      return run;
    }
    const completedAt = Date.now();
    run.status = this.statusFromEvents(events);
    run.updatedAt = completedAt;
    run.completedAt = run.status === 'running' ? undefined : completedAt;
    this.runs.set(run.id, run);
    this.schemasByRunId.set(run.id, this.cloneSchema(schema));
    this.eventsByRunId.set(run.id, events);
    this.auditArchitectureHydration(run, hydration);
    this.auditArchitectureRun(schema, run, events, liveEvents === undefined);
    await this.persistParentChatProjection(schema, run, events);
    return run;
  }

  findRun(id: string): ArchitectureRun | null {
    return this.runs.get(id) ?? null;
  }

  async findRunDurable(id: string): Promise<ArchitectureRun | null> {
    return this.findRun(id) ?? this.reconstructRunFromAudit(id);
  }

  async stopRun(id: string): Promise<ArchitectureRun> {
    const run = await this.findRunDurable(id);
    if (!run) {
      throw new NotFoundException(`Architecture run ${id} not found`);
    }
    const now = Date.now();
    const stoppedRun: ArchitectureRun = {
      ...run,
      status: 'cancelled',
      updatedAt: now,
      completedAt: now,
    };
    this.stoppedRunIds.add(id);
    this.runs.set(id, stoppedRun);
    const events = this.eventsByRunId.get(id) ?? await this.getEventsDurable(id);
    const stopEvent: ArchitectureExecutionEvent = {
      id: `${id}:event:${events.length + 1}`,
      runId: id,
      sequence: events.length + 1,
      type: 'run_stopped',
      message: 'Architecture run stopped by user.',
      actionSummary: architectureActionSummaryForEvent('run_stopped'),
      data: {
        reasonCode: 'user_stop',
        stoppedByUser: true,
        previousStatus: run.status,
        source: 'user',
      },
      createdAt: now,
    };
    const nextEvents = [...events, stopEvent];
    this.eventsByRunId.set(id, nextEvents);
    const schema = this.schemasByRunId.get(id) ?? this.registry.findOne(stoppedRun.schemaId);
    if (schema) {
      this.auditArchitectureEvent(schema, stoppedRun, stopEvent);
      this.auditArchitectureRun(schema, stoppedRun, nextEvents);
      await this.persistParentChatProjectionSafely(schema, stoppedRun, nextEvents);
    }
    return stoppedRun;
  }

  getEvents(runId: string): ArchitectureExecutionEvent[] {
    return this.eventsByRunId.get(runId) ?? [];
  }

  async getEventsDurable(runId: string): Promise<ArchitectureExecutionEvent[]> {
    const liveEvents = this.getEvents(runId);
    if (liveEvents.length > 0) {
      return liveEvents;
    }
    return this.reconstructEventsFromAudit(runId);
  }

  async resumeRun(
    runId: string,
    dto: { input?: string; context?: Record<string, unknown>; maxSteps?: number; continuation?: AgentFlowContinuationCursor },
    emit?: ArchitectureRoleExecutionInput['emit'],
  ): Promise<ArchitectureRun> {
    const existing = await this.findRunDurable(runId);
    if (!existing) {
      throw new NotFoundException(`Architecture run ${runId} not found`);
    }
    const schema = this.schemasByRunId.get(runId) ?? this.registry.findOne(existing.schemaId);
    if (!schema) {
      throw new NotFoundException(`Architecture schema ${existing.schemaId} not found`);
    }
    const now = Date.now();
    const context = {
      ...(existing.context ?? {}),
      ...(dto.context ?? {}),
      ...(dto.maxSteps !== undefined ? { maxArchitectureSteps: dto.maxSteps } : {}),
    };
    const run: ArchitectureRun = {
      ...existing,
      prompt: dto.input?.trim()
        ? `${existing.prompt}\n\nResume input: ${dto.input.trim()}`
        : existing.prompt,
      context,
      status: 'running',
      updatedAt: now,
      completedAt: undefined,
    };
    this.runs.set(run.id, run);
    this.schemasByRunId.set(run.id, this.cloneSchema(schema));
    const priorEvents = await this.getEventsDurable(runId);
    this.eventsByRunId.set(run.id, []);
    return this.executePreparedRun({ schema, run, hydration: null }, emit, [], priorEvents, dto.continuation);
  }

  getGraph(runId: string): ArchitectureGraphProjection | null {
    const run = this.findRun(runId);
    if (!run) return null;
    const schema = this.schemasByRunId.get(runId) ?? this.registry.findOne(run.schemaId);
    if (!schema) return null;

    return buildArchitectureGraphProjection(runId, schema, this.getEvents(runId), run.status);
  }

  async getGraphDurable(runId: string): Promise<ArchitectureGraphProjection | null> {
    const liveEvents = this.getEvents(runId);
    const liveGraph = liveEvents.length > 0 ? this.getGraph(runId) : null;
    const persistedGraph = await this.reconstructPersistedGraphSafely(runId);
    if (liveGraph) {
      return this.mergePersistedChildAgents(liveGraph, persistedGraph);
    }

    const run = await this.findRunDurable(runId);
    if (!run) return persistedGraph;
    const schema = this.schemasByRunId.get(runId) ?? this.registry.findOne(run.schemaId);
    const auditEvents = await this.reconstructEventsFromAudit(runId);
    if (schema && auditEvents.length > 0) {
      return this.mergePersistedChildAgents(
        buildArchitectureGraphProjection(runId, schema, auditEvents, run.status),
        persistedGraph,
      );
    }

    if (persistedGraph) {
      return persistedGraph;
    }

    if (!schema) return null;
    const events = await this.getEventsDurable(runId);
    if (events.length === 0) return null;
    return buildArchitectureGraphProjection(runId, schema, events, run.status);
  }

  private mergePersistedChildAgents(
    liveGraph: ArchitectureGraphProjection,
    persistedGraph: ArchitectureGraphProjection | null,
  ): ArchitectureGraphProjection {
    const persistedChildAgents = persistedGraph?.childAgents ?? [];
    if (persistedChildAgents.length === 0) {
      return liveGraph;
    }
    const childAgents = new Map<string, NonNullable<ArchitectureGraphProjection['childAgents']>[number]>();
    for (const childAgent of liveGraph.childAgents ?? []) {
      childAgents.set(childAgent.id, childAgent);
    }
    for (const childAgent of persistedChildAgents) {
      childAgents.set(childAgent.id, this.mergeChildAgentProjection(childAgents.get(childAgent.id), childAgent));
    }
    return {
      ...liveGraph,
      childAgents: [...childAgents.values()],
    };
  }

  private mergeChildAgentProjection(
    current: ArchitectureChildAgentProjection | undefined,
    incoming: ArchitectureChildAgentProjection,
  ): ArchitectureChildAgentProjection {
    return {
      id: incoming.id,
      parentNodeId: incoming.parentNodeId ?? current?.parentNodeId,
      parentRoleSlotId: incoming.parentRoleSlotId ?? current?.parentRoleSlotId,
      parentEventId: incoming.parentEventId ?? current?.parentEventId,
      kind: incoming.kind ?? current?.kind ?? 'cli-agent',
      backend: incoming.backend ?? current?.backend,
      status: mergeChildAgentStatus(current?.status, incoming.status),
      toolName: incoming.toolName ?? current?.toolName,
      workdir: incoming.workdir ?? current?.workdir,
      targetPaths: incoming.targetPaths ?? current?.targetPaths,
      updatedAt: incoming.updatedAt ?? current?.updatedAt,
    };
  }

  private async reconstructPersistedGraphSafely(runId: string): Promise<ArchitectureGraphProjection | null> {
    try {
      return await this.withTimeout(
        reconstructDurableArchitectureGraph(runId, this.sessions, this.registry),
        PERSISTED_GRAPH_RECOVERY_TIMEOUT_MS,
        `persisted architecture graph recovery timed out after ${PERSISTED_GRAPH_RECOVERY_TIMEOUT_MS}ms`,
      );
    } catch (error) {
      this.logger.warn(
        `Failed to reconstruct architecture graph from persisted chat for run ${runId}: ${this.errorMessage(error)}`,
      );
      return null;
    }
  }

  private async withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
    let timeout: ReturnType<typeof setTimeout> | null = null;
    try {
      return await Promise.race([
        promise,
        new Promise<T>((_resolve, reject) => {
          timeout = setTimeout(() => reject(new Error(message)), timeoutMs);
          timeout.unref?.();
        }),
      ]);
    } finally {
      if (timeout) {
        clearTimeout(timeout);
      }
    }
  }

  getChat(runId: string): ArchitectureChatProjection | null {
    if (!this.findRun(runId)) return null;
    return {
      runId,
      messages: this.getEvents(runId)
        .filter((event) => this.isChatProjectionEvent(event))
        .map((event) => ({
          id: `${event.id}:message`,
          eventId: event.id,
          speaker: this.toSpeaker(event),
          content: event.message,
          actionSummary: architectureActionFieldsForEvent(event).actionSummary,
          action: architectureActionFieldsForEvent(event).action,
          detail: architectureActionFieldsForEvent(event).detail,
          roleSlotId: event.roleSlotId,
          route: event.route,
          incompleteReason: this.incompleteReasonFromEvent(event),
          createdAt: event.createdAt,
        })),
    };
  }

  async getChatDurable(runId: string): Promise<ArchitectureChatProjection | null> {
    if (this.findRun(runId)) {
      return this.getChat(runId);
    }
    const run = await this.findRunDurable(runId);
    if (!run) return null;
    const events = await this.getEventsDurable(runId);
    return {
      runId,
      messages: events
        .filter((event) => this.isChatProjectionEvent(event))
        .map((event) => ({
          id: `${event.id}:message`,
          eventId: event.id,
          speaker: this.toSpeaker(event),
          content: event.message,
          actionSummary: architectureActionFieldsForEvent(event).actionSummary,
          action: architectureActionFieldsForEvent(event).action,
          detail: architectureActionFieldsForEvent(event).detail,
          roleSlotId: event.roleSlotId,
          route: event.route,
          incompleteReason: this.incompleteReasonFromEvent(event),
          createdAt: event.createdAt,
        })),
    };
  }

  private incompleteReasonFromEvent(event: ArchitectureExecutionEvent): string | undefined {
    const reason = event.data?.['incompleteReason'];
    return typeof reason === 'string' && reason.trim().length > 0 ? reason : undefined;
  }

  private async createBranchSessions(
    schema: ArchitectureSchema,
    runId: string,
    rootSessionId: string,
    dto: CreateArchitectureRunDto,
  ): Promise<Record<string, string>> {
    const isAgentFlowRoot = this.isAgentFlowContext(dto.context);
    const hostSessionId = getArchitectureHostSessionId(dto.context);
    const historySessionId = getArchitectureHistorySessionId(dto.context);
    await this.sessions.createWithId(rootSessionId, {
      personaId: 'default',
      title: this.toRunSessionTitle(dto.prompt),
      kind: isAgentFlowRoot ? 'agent-flow' : 'chat',
      parentSessionId: getArchitectureParentSessionId(dto.context),
      parentToolCallId: getArchitectureParentToolCallId(dto.context),
      runtimeContext: createArchitectureRootSessionRuntimeContext({
        runId,
        schemaId: schema.id,
        schemaName: schema.name,
        hostSessionId,
        historySessionId,
      }),
    });

    const executableSlots = schema.roleSlots.filter((slot) => this.shouldCreateBranch(slot, schema, dto.executionMode));
    const pairs = await Promise.all(
      executableSlots.map(async (slot) => {
        const sessionId = `arch-${runId}-${slot.id}`;
        const personaId = this.resolveArchitecturePersonaId(dto.slotOverrides?.[slot.id] ?? slot.defaultPersonaId);
        await this.sessions.createWithId(sessionId, {
          personaId,
          title: `${schema.name}: ${slot.label}`,
          kind: 'subagent',
          parentSessionId: rootSessionId,
          runtimeContext: createArchitectureBranchSessionRuntimeContext({
            runId,
            schemaId: schema.id,
            schemaName: schema.name,
            rootSessionId,
            slot,
            hostSessionId,
            historySessionId,
          }),
        });
        return [slot.id, sessionId] as const;
      }),
    );

    return Object.fromEntries(pairs);
  }

  private shouldCreateBranch(
    slot: ArchitectureRoleSlot,
    schema: ArchitectureSchema,
    executionMode: ArchitectureExecutionMode | undefined,
  ): boolean {
    if (executionMode === 'subagent_execution') {
      return schema.nodes.some((node) => node.roleSlotId === slot.id);
    }
    return slot.slotType === 'participant'
      || slot.slotType === 'critic'
      || slot.slotType === 'tool_executor';
  }

  private personaForRunSlot(run: ArchitectureRun, slot: ArchitectureRoleSlot): string {
    return this.resolveArchitecturePersonaId(run.slotOverrides?.[slot.id] ?? slot.defaultPersonaId);
  }

  private resolveArchitecturePersonaId(personaId: string): string {
    return ARCHITECTURE_PERSONA_ALIASES[personaId] ?? personaId;
  }

  private isAgentFlowContext(context: Record<string, unknown> | undefined): boolean {
    return this.isPlainRecord(context?.['subAgentFlow']);
  }

  private async persistParentChatProjection(
    schema: ArchitectureSchema,
    run: ArchitectureRun,
    events: ArchitectureExecutionEvent[],
  ): Promise<void> {
    const projectionSessionId = getArchitectureParentSessionId(run.context) ?? run.rootSessionId;
    if (!projectionSessionId) {
      return;
    }
    let targetSessionId = projectionSessionId;
    let existingMessages: ChatMessage[];
    try {
      existingMessages = await this.sessions.getMessages(targetSessionId);
    } catch (error) {
      if (!run.rootSessionId || targetSessionId === run.rootSessionId) {
        throw error;
      }
      targetSessionId = run.rootSessionId;
      existingMessages = await this.sessions.getMessages(targetSessionId);
    }
    const messages = buildArchitectureParentChatMessages(schema, run, targetSessionId, events, Date.now());
    const existingMessageIds = new Set(existingMessages.map((message) => message.id));
    await Promise.all(
      messages
        .filter((message) => !existingMessageIds.has(message.id))
        .map((message) => this.sessionManager.persistMessage(message)),
    );
  }

  private async persistParentChatProjectionSafely(
    schema: ArchitectureSchema,
    run: ArchitectureRun,
    events: ArchitectureExecutionEvent[],
  ): Promise<void> {
    try {
      await this.persistParentChatProjection(schema, run, events);
    } catch (error) {
      this.logger.warn(
        `Failed to persist architecture failure projection for run ${run.id}: ${this.errorMessage(error)}`,
      );
    }
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }

  private auditArchitectureRun(
    schema: ArchitectureSchema,
    run: ArchitectureRun,
    events: ArchitectureExecutionEvent[],
    auditEvents = true,
  ): void {
    if (!this.audit) return;
    const sessionId = getArchitectureParentSessionId(run.context) ?? run.rootSessionId;
    void this.audit.log({
      sessionId,
      type: 'tool_result',
      label: `architecture:${schema.id}:${run.id}`,
      data: {
        domain: 'architecture',
        kind: 'architecture_runtime',
        runId: run.id,
        schemaId: schema.id,
        executionMode: run.executionMode,
        rootSessionId: run.rootSessionId,
        branchSessionIds: run.branchSessionIds,
        eventCount: events.length,
        events: events.map((event) => ({
          id: event.id,
          type: event.type,
          nodeId: event.nodeId,
          roleSlotId: event.roleSlotId,
          route: event.route,
        })),
      },
    });
    if (!auditEvents) {
      return;
    }
    events.forEach((event) => {
      this.auditArchitectureEvent(schema, run, event);
    });
  }

  private auditArchitectureEvent(
    schema: ArchitectureSchema,
    run: ArchitectureRun,
    event: ArchitectureExecutionEvent,
  ): void {
    if (!this.audit) return;
    const actionFields = architectureActionFieldsForEvent(event);
    void this.audit.log({
      sessionId: getArchitectureParentSessionId(run.context) ?? run.rootSessionId,
      type: 'architecture_event',
      label: `architecture_event:${event.type}:${event.nodeId ?? 'runtime'}`,
      data: {
        domain: 'architecture',
        kind: 'architecture_event',
        runId: run.id,
        architectureRunId: run.id,
        schemaId: schema.id,
        executionMode: run.executionMode,
        eventId: event.id,
        eventType: event.type,
        sequence: event.sequence,
        nodeId: event.nodeId,
        roleSlotId: event.roleSlotId,
        incompleteReason: typeof event.data?.['incompleteReason'] === 'string' ? event.data['incompleteReason'] : undefined,
        runtimeGuard: typeof event.data?.['runtimeGuard'] === 'string' ? event.data['runtimeGuard'] : undefined,
        toolEvidence: this.toolEvidenceForAudit(event),
        route: event.route,
        routerOutput: event.routerOutput,
        messagePreview: event.message.slice(0, 800),
        actionSummary: actionFields.actionSummary,
        action: actionFields.action,
        detail: actionFields.detail,
      },
    });
  }

  private toolEvidenceForAudit(event: ArchitectureExecutionEvent): Record<string, unknown> | undefined {
    const value = event.data?.['toolEvidence'];
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
  }

  private auditArchitectureFailure(
    schema: ArchitectureSchema,
    run: ArchitectureRun,
    errorMessage: string,
  ): void {
    if (!this.audit) return;
    void this.audit.log({
      sessionId: getArchitectureParentSessionId(run.context) ?? run.rootSessionId,
      type: 'error',
      label: `architecture:error:${schema.id}:${run.id}`,
      data: {
        domain: 'architecture',
        kind: 'architecture_error',
        runId: run.id,
        architectureRunId: run.id,
        schemaId: schema.id,
        executionMode: run.executionMode,
        rootSessionId: run.rootSessionId,
        branchSessionIds: run.branchSessionIds,
        status: run.status,
        errorMessage,
      },
    });
  }

  private auditArchitectureHydration(
    run: ArchitectureRun,
    hydration: ArchitectureVfsHydrationResult | null,
  ): void {
    if (!this.audit || !hydration) return;
    void this.audit.log({
      sessionId: getArchitectureParentSessionId(run.context) ?? run.rootSessionId,
      type: 'tool_result',
      label: `architecture_hydration:${run.id}`,
      data: {
        domain: 'architecture',
        kind: 'architecture_hydration',
        runId: run.id,
        architectureRunId: run.id,
        rootSessionId: run.rootSessionId,
        fromSessionId: hydration.fromSessionId,
        targetPrefix: hydration.targetPrefix,
        requestedPaths: hydration.requestedPaths,
        copiedFiles: hydration.copiedFiles,
        copiedCount: hydration.copiedFiles.length,
        skippedPaths: hydration.skippedPaths,
        skippedCount: hydration.skippedPaths.length,
      },
    });
  }

  private async reconstructRunFromAudit(runId: string): Promise<ArchitectureRun | null> {
    const rows = await this.auditRowsForRun(runId);
    if (rows.length === 0) {
      return null;
    }

    const records = rows.map((row) => this.auditData(row));
    const summary = records.find((record) => record.kind === 'architecture_runtime');
    const error = records.find((record) => record.kind === 'architecture_error');
    const firstEvent = records.find((record) => record.kind === 'architecture_event');
    const source = summary ?? error ?? firstEvent;
    if (!source) {
      return null;
    }

    const schemaId = this.stringField(source, 'schemaId');
    if (!schemaId) {
      return null;
    }

    const eventTypes = records
      .map((record) => this.stringField(record, 'eventType'))
      .filter((type): type is string => Boolean(type));
    const events = records
      .map((record) => ({
        type: this.stringField(record, 'eventType'),
        message: this.stringField(record, 'messagePreview') ?? '',
      }))
      .filter((event): event is { type: string; message: string } =>
        event.type !== undefined && this.isArchitectureExecutionEventType(event.type));
    const hasFinalArtifact = eventTypes.includes('final_artifact');
    const hasError = Boolean(error);
    const status: ArchitectureRun['status'] = hasError ? 'failed' : hasFinalArtifact ? 'completed' : this.statusFromEventSummary(events);
    const createdAt = Math.min(...rows.map((row) => row.createdAt));
    const updatedAt = Math.max(...rows.map((row) => row.createdAt));
    const executionMode = this.executionModeFromAudit(source);
    const rootSessionId = this.stringField(source, 'rootSessionId') ?? rows.find((row) => row.sessionId)?.sessionId ?? undefined;

    return {
      id: runId,
      schemaId,
      prompt: this.promptFromAudit(records) ?? `Recovered architecture run ${runId}`,
      executionMode,
      rootSessionId,
      branchSessionIds: this.stringRecordField(source, 'branchSessionIds'),
      status,
      createdAt,
      updatedAt,
      completedAt: status === 'running' ? undefined : updatedAt,
    };
  }

  private statusFromEvents(events: ArchitectureExecutionEvent[]): ArchitectureRun['status'] {
    if (events.some((event) => event.type === 'final_artifact')) {
      return 'completed';
    }
    return this.statusFromEventSummary(events.map((event) => ({
      type: event.type,
      message: event.message,
    })));
  }

  private statusFromEventSummary(events: Array<{ type: string; message: string }>): ArchitectureRun['status'] {
    for (let index = events.length - 1; index >= 0; index -= 1) {
      const event = events[index];
      if (event?.type === 'run_stopped') {
        return 'cancelled';
      }
      if (
        event?.type === 'router_decision'
        && event.message.startsWith('Runtime stopped after ')
        && (event.message.includes(' graph steps.') || event.message.includes('max node visits'))
      ) {
        return 'failed';
      }
      if (event) {
        return 'running';
      }
    }
    return 'running';
  }

  private async reconstructEventsFromAudit(runId: string): Promise<ArchitectureExecutionEvent[]> {
    const rows = await this.auditRowsForRun(runId);
    const eventRows = rows
      .map((row) => ({ row, data: this.auditData(row) }))
      .filter(({ data }) =>
        data.kind === 'architecture_event'
        && this.isArchitectureExecutionEventType(data.eventType));

    return eventRows.map(({ row, data }, index) => {
      const eventId = this.stringField(data, 'eventId') ?? `${runId}:audit:${row.id}`;
      const eventType = data.eventType;
      if (!this.isArchitectureExecutionEventType(eventType)) {
        throw new Error(`Invalid recovered architecture event type for run ${runId}`);
      }
      const route = this.routeDecisionField(data, 'route');
      const routerOutput = this.routerOutputField(data, 'routerOutput');
      // TODO: legacy fallback - older audit rows only persisted messagePreview/actionSummary, so rebuild action/detail from structured route/routerOutput when needed.
      const actionFields = architectureActionFieldsForEvent({
        type: eventType,
        actionSummary: this.stringField(data, 'actionSummary'),
        action: this.eventActionField(data, 'action'),
        detail: this.stringField(data, 'detail'),
        route,
        routerOutput,
        data,
      });
      return {
        id: eventId,
        runId,
        sequence: this.numberField(data, 'sequence') ?? index + 1,
        type: eventType,
        message: this.stringField(data, 'messagePreview') ?? row.label,
        actionSummary: actionFields.actionSummary,
        action: actionFields.action,
        detail: actionFields.detail,
        nodeId: this.stringField(data, 'nodeId'),
        roleSlotId: this.stringField(data, 'roleSlotId'),
        route,
        routerOutput,
        data,
        createdAt: row.createdAt,
      };
    });
  }

  private async auditRowsForRun(runId: string): Promise<AuditLogEntry[]> {
    if (!this.audit) {
      return [];
    }
    const rows = await this.audit.listEntries({
      limit: 5000,
      source: 'all',
    });
    return rows
      .filter((row) => {
        const data = this.auditData(row);
        return data.runId === runId || data.architectureRunId === runId;
      })
      .sort((left, right) => {
        if (left.createdAt !== right.createdAt) {
          return left.createdAt - right.createdAt;
        }
        const leftSequence = this.numberField(this.auditData(left), 'sequence') ?? 0;
        const rightSequence = this.numberField(this.auditData(right), 'sequence') ?? 0;
        return leftSequence - rightSequence;
      });
  }

  private auditData(row: AuditLogEntry): Record<string, unknown> {
    return row.data && this.isPlainRecord(row.data) ? row.data : {};
  }

  private promptFromAudit(records: Array<Record<string, unknown>>): string | undefined {
    const created = records.find((record) => record.eventType === 'run_created');
    const message = created ? this.stringField(created, 'messagePreview') : undefined;
    const prefix = 'Architecture run created for: ';
    if (!message) {
      return undefined;
    }
    return message.startsWith(prefix) ? message.slice(prefix.length) : message;
  }

  private executionModeFromAudit(record: Record<string, unknown>): ArchitectureExecutionMode {
    const value = record.executionMode;
    return this.isExecutionMode(value) ? value : 'session_branches';
  }

  private stringRecordField(record: Record<string, unknown>, key: string): Record<string, string> | undefined {
    const value = record[key];
    return this.isStringRecord(value) ? value : undefined;
  }

  private stringField(record: Record<string, unknown>, key: string): string | undefined {
    const value = record[key];
    return typeof value === 'string' && value.length > 0 ? value : undefined;
  }

  private numberField(record: Record<string, unknown>, key: string): number | undefined {
    const value = record[key];
    return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
  }

  private routeDecisionField(record: Record<string, unknown>, key: string): ArchitectureRouteDecision | undefined {
    const value = record[key];
    return this.isArchitectureRouteDecision(value) ? value : undefined;
  }

  private routerOutputField(record: Record<string, unknown>, key: string): ArchitectureRouterOutput | undefined {
    const value = record[key];
    return this.isArchitectureRouterOutput(value) ? value : undefined;
  }

  private eventActionField(record: Record<string, unknown>, key: string): ArchitectureExecutionEvent['action'] {
    const value = record[key];
    return value === 'run_created'
      || value === 'run_stopped'
      || value === 'participant_completed'
      || value === 'participant_incomplete'
      || value === 'router_selected'
      || value === 'router_returned_to_orchestrator'
      || value === 'router_incomplete'
      || value === 'router_synthesized'
      || value === 'finalizer_completed'
      ? value
      : undefined;
  }

  private isArchitectureExecutionEventType(value: unknown): value is ArchitectureExecutionEventType {
    return value === 'run_created'
      || value === 'node_started'
      || value === 'agent_started'
      || value === 'participant_output'
      || value === 'router_decision'
      || value === 'router_output'
      || value === 'tool_call'
      || value === 'human_gate'
      || value === 'artifact_created'
      || value === 'memory_persisted'
      || value === 'final_artifact'
      || value === 'node_completed'
      || value === 'run_stopped';
  }

  private isArchitectureRouteDecision(value: unknown): value is ArchitectureRouteDecision {
    return this.isPlainRecord(value)
      && (value.source === 'agent' || value.source === 'router' || value.source === 'parallel' || value.source === 'runtime_fallback')
      && this.isNonEmptyString(value.fromNodeId)
      && Array.isArray(value.selectedNodeIds)
      && value.selectedNodeIds.every((nodeId) => typeof nodeId === 'string')
      && (value.rejectedNodeIds === undefined || (Array.isArray(value.rejectedNodeIds) && value.rejectedNodeIds.every((nodeId) => typeof nodeId === 'string')))
      && (value.nextNodeId === undefined || typeof value.nextNodeId === 'string')
      && (value.convergeToNodeId === undefined || typeof value.convergeToNodeId === 'string')
      && (value.mode === undefined || this.isNodeBehaviorMode(value.mode))
      && (value.response === undefined || typeof value.response === 'string');
  }

  private isArchitectureRouterOutput(value: unknown): value is ArchitectureRouterOutput {
    return this.isPlainRecord(value)
      && typeof value.selectedStrategy === 'string'
      && typeof value.mergedDecision === 'string'
      && Array.isArray(value.acceptedInputs)
      && Array.isArray(value.rejectedInputs)
      && Array.isArray(value.unresolvedConflicts)
      && Array.isArray(value.risks)
      && typeof value.confidence === 'number'
      && Number.isFinite(value.confidence)
      && (
        value.nextAction === 'finalize'
        || value.nextAction === 'ask_human'
        || value.nextAction === 'run_more_research'
        || value.nextAction === 'rerun_with_different_personas'
      );
  }

  private toRunSessionTitle(prompt: string): string {
    const trimmed = prompt.trim();
    const summary = trimmed.length > 56 ? `${trimmed.slice(0, 56)}...` : trimmed;
    return `Architecture: ${summary || 'Untitled run'}`;
  }

  private validateCreateRunDto(dto: CreateArchitectureRunDto): CreateArchitectureRunDto {
    if (!this.isNonEmptyString(dto?.schemaId)) {
      throw new BadRequestException('schemaId must be a non-empty string');
    }
    if (!this.isNonEmptyString(dto?.prompt)) {
      throw new BadRequestException('prompt must be a non-empty string');
    }
    if (dto?.context !== undefined && !this.isPlainRecord(dto.context)) {
      throw new BadRequestException('context must be an object when provided');
    }
    if (dto?.slotOverrides !== undefined && !this.isStringRecord(dto.slotOverrides)) {
      throw new BadRequestException('slotOverrides must map slot ids to persona ids');
    }
    if (dto?.executionMode !== undefined && !this.isExecutionMode(dto.executionMode)) {
      throw new BadRequestException('executionMode must be session_branches or subagent_execution');
    }
    if (dto?.schema !== undefined && !this.isArchitectureSchema(dto.schema)) {
      throw new BadRequestException('schema must be a valid architecture schema when provided');
    }
    return dto;
  }

  private validateCreateRunSlotOverrides(
    schema: ArchitectureSchema,
    slotOverrides: Record<string, string> | undefined,
  ): void {
    if (!slotOverrides) {
      return;
    }

    const slotById = new Map(schema.roleSlots.map((slot) => [slot.id, slot]));
    for (const slotId of Object.keys(slotOverrides)) {
      const slot = slotById.get(slotId);
      if (!slot) {
        throw new BadRequestException(`Unknown role slot ${slotId}`);
      }
      if (!slot.canOverrideAtRunStart) {
        throw new BadRequestException(`Role slot ${slotId} cannot be overridden`);
      }
    }
  }

  private cloneSchema(schema: ArchitectureSchema): ArchitectureSchema {
    return {
      ...schema,
      roleSlots: schema.roleSlots.map((slot) => ({ ...slot })),
      nodes: schema.nodes.map((node) => ({ ...node })),
      edges: schema.edges.map((edge) => ({ ...edge })),
      routerPolicy: { ...schema.routerPolicy },
      contextPolicy: {
        ...schema.contextPolicy,
        perSlotOverrides: schema.contextPolicy.perSlotOverrides
          ? Object.fromEntries(Object.entries(schema.contextPolicy.perSlotOverrides).map(([slotId, override]) => [
              slotId,
              { ...override },
            ]))
          : undefined,
      },
      memoryPolicy: { ...schema.memoryPolicy },
    };
  }

  private isArchitectureSchema(value: unknown): value is ArchitectureSchema {
    return this.isPlainRecord(value)
      && this.isNonEmptyString(value.id)
      && this.isNonEmptyString(value.name)
      && typeof value.description === 'string'
      && this.isNonEmptyString(value.version)
      && Array.isArray(value.roleSlots)
      && value.roleSlots.every((slot) => this.isArchitectureRoleSlot(slot))
      && Array.isArray(value.nodes)
      && value.nodes.every((node) => this.isArchitectureSchemaNode(node))
      && Array.isArray(value.edges)
      && value.edges.every((edge) => this.isArchitectureSchemaEdge(edge))
      && this.hasValidNodeBehaviorTopology(value.nodes)
      && this.hasValidGraphTopology(value.nodes, value.edges)
      && this.isRouterPolicy(value.routerPolicy)
      && this.isContextPolicy(value.contextPolicy)
      && this.isMemoryPolicy(value.memoryPolicy)
      && typeof value.outputArtifactSchema === 'string';
  }

  private isArchitectureRoleSlot(value: unknown): value is ArchitectureRoleSlot {
    return this.isPlainRecord(value)
      && this.isNonEmptyString(value.id)
      && this.isNonEmptyString(value.label)
      && typeof value.description === 'string'
      && this.isSlotType(value.slotType)
      && this.isNonEmptyString(value.defaultPersonaId)
      && Array.isArray(value.allowedPersonaTags)
      && value.allowedPersonaTags.every((tag) => typeof tag === 'string')
      && typeof value.required === 'boolean'
      && typeof value.canOverrideAtRunStart === 'boolean';
  }

  private isArchitectureSchemaNode(value: unknown): value is ArchitectureSchemaNode {
    return this.isPlainRecord(value)
      && this.isNonEmptyString(value.id)
      && this.isNonEmptyString(value.label)
      && this.isNodeKind(value.kind)
      && (value.roleSlotId === undefined || typeof value.roleSlotId === 'string')
      && (value.maxToolAttempts === undefined || (typeof value.maxToolAttempts === 'number' && Number.isInteger(value.maxToolAttempts) && value.maxToolAttempts >= 1 && value.maxToolAttempts <= 100))
      && (value.behavior === undefined || this.isNodeBehavior(value.behavior))
      && (value.x === undefined || typeof value.x === 'number')
      && (value.y === undefined || typeof value.y === 'number');
  }

  private isNodeBehavior(value: unknown): value is NonNullable<ArchitectureSchemaNode['behavior']> {
    return this.isPlainRecord(value)
      && this.isNodeBehaviorMode(value.mode)
      && (value.fanOut === undefined || value.fanOut === 'parallel' || value.fanOut === 'sequential')
      && (value.convergeToNodeId === undefined || typeof value.convergeToNodeId === 'string')
      && (value.maxBranches === undefined || (typeof value.maxBranches === 'number' && Number.isInteger(value.maxBranches) && value.maxBranches > 0))
      && (
        value.scoringPolicy === undefined
        || value.scoringPolicy === 'confidence'
        || value.scoringPolicy === 'risk'
        || value.scoringPolicy === 'cost'
        || value.scoringPolicy === 'custom'
      )
      && (value.description === undefined || typeof value.description === 'string');
  }

  private hasValidNodeBehaviorTopology(nodes: ArchitectureSchemaNode[]): boolean {
    const ids = new Set(nodes.map((node) => node.id));
    return nodes.every((node) => {
      if (!node.behavior) {
        return node.kind !== 'role' || Boolean(node.roleSlotId);
      }
      if (node.kind === 'role' && !node.roleSlotId) {
        return false;
      }
      if (node.behavior.convergeToNodeId && !ids.has(node.behavior.convergeToNodeId)) {
        return false;
      }
      if (node.kind === 'role') {
        return false;
      }
      if (node.kind === 'artifact') {
        return node.behavior.mode === 'finalize' || node.behavior.mode === 'merge_inputs';
      }
      return node.behavior.mode !== 'finalize';
    });
  }

  private hasValidGraphTopology(nodes: ArchitectureSchemaNode[], edges: ArchitectureSchemaEdge[]): boolean {
    const nodeIds = new Set<string>();
    for (const node of nodes) {
      if (nodeIds.has(node.id)) {
        return false;
      }
      nodeIds.add(node.id);
    }

    const edgeIds = new Set<string>();
    for (const edge of edges) {
      if (edgeIds.has(edge.id) || edge.fromNodeId === edge.toNodeId) {
        return false;
      }
      edgeIds.add(edge.id);
      if (!nodeIds.has(edge.fromNodeId) || !nodeIds.has(edge.toNodeId)) {
        return false;
      }
    }
    const edgeKeys = new Set(edges.map((edge) => `${edge.fromNodeId}->${edge.toNodeId}`));
    for (const node of nodes) {
      if (
        node.kind === 'router'
        && node.behavior?.convergeToNodeId
        && !edgeKeys.has(`${node.id}->${node.behavior.convergeToNodeId}`)
      ) {
        return false;
      }
    }
    return true;
  }

  private isArchitectureSchemaEdge(value: unknown): value is ArchitectureSchemaEdge {
    return this.isPlainRecord(value)
      && this.isNonEmptyString(value.id)
      && this.isNonEmptyString(value.fromNodeId)
      && this.isNonEmptyString(value.toNodeId)
      && (value.label === undefined || typeof value.label === 'string')
      && (value.returnToOrchestrator === undefined || typeof value.returnToOrchestrator === 'boolean');
  }

  private isRouterPolicy(value: unknown): value is ArchitectureSchema['routerPolicy'] {
    return this.isPlainRecord(value)
      && (value.mode === 'rank_then_merge' || value.mode === 'evidence_first' || value.mode === 'risk_weighted')
      && typeof value.mustAddressCriticFindings === 'boolean'
      && typeof value.canReturnNeedsMoreResearch === 'boolean';
  }

  private isContextPolicy(value: unknown): value is ArchitectureSchema['contextPolicy'] {
    return this.isPlainRecord(value)
      && typeof value.includeUserTask === 'boolean'
      && typeof value.includeProjectMemory === 'boolean'
      && typeof value.includeBrowserSession === 'boolean'
      && typeof value.includePriorDecisions === 'boolean'
      && (value.includeOtherAgentOutputs === undefined || typeof value.includeOtherAgentOutputs === 'boolean')
      && (value.includeToolResults === undefined || typeof value.includeToolResults === 'boolean')
      && (value.contextCompression === undefined || this.isContextCompression(value.contextCompression))
      && (value.perSlotOverrides === undefined || this.isContextPolicyOverrides(value.perSlotOverrides));
  }

  private isContextPolicyOverrides(value: unknown): value is NonNullable<ArchitectureSchema['contextPolicy']['perSlotOverrides']> {
    return this.isPlainRecord(value) && Object.values(value).every((entry) => (
      this.isPlainRecord(entry)
      && (entry.includeUserTask === undefined || typeof entry.includeUserTask === 'boolean')
      && (entry.includeProjectMemory === undefined || typeof entry.includeProjectMemory === 'boolean')
      && (entry.includeBrowserSession === undefined || typeof entry.includeBrowserSession === 'boolean')
      && (entry.includePriorDecisions === undefined || typeof entry.includePriorDecisions === 'boolean')
      && (entry.includeOtherAgentOutputs === undefined || typeof entry.includeOtherAgentOutputs === 'boolean')
      && (entry.includeToolResults === undefined || typeof entry.includeToolResults === 'boolean')
      && (entry.contextCompression === undefined || this.isContextCompression(entry.contextCompression))
    ));
  }

  private isContextCompression(value: unknown): value is NonNullable<ArchitectureSchema['contextPolicy']['contextCompression']> {
    return value === 'none' || value === 'summary' || value === 'evidence_only';
  }

  private isMemoryPolicy(value: unknown): value is ArchitectureSchema['memoryPolicy'] {
    return this.isPlainRecord(value)
      && typeof value.persistFinalArtifact === 'boolean'
      && typeof value.persistRouterDecision === 'boolean';
  }

  private isNonEmptyString(value: unknown): value is string {
    return typeof value === 'string' && value.trim().length > 0;
  }

  private isPlainRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }

  private isStringRecord(value: unknown): value is Record<string, string> {
    return this.isPlainRecord(value)
      && Object.values(value).every((entry) => typeof entry === 'string' && entry.length > 0);
  }

  private isExecutionMode(value: unknown): value is ArchitectureExecutionMode {
    return value === 'session_branches' || value === 'subagent_execution';
  }

  private isSlotType(value: unknown): value is ArchitectureRoleSlot['slotType'] {
    return value === 'participant'
      || value === 'router'
      || value === 'judge'
      || value === 'finalizer'
      || value === 'critic'
      || value === 'tool_executor';
  }

  private isNodeKind(value: unknown): value is ArchitectureSchemaNode['kind'] {
    return value === 'parallel' || value === 'role' || value === 'router' || value === 'artifact';
  }

  private isNodeBehaviorMode(value: unknown): value is NonNullable<ArchitectureSchemaNode['behavior']>['mode'] {
    return value === 'fan_out_all'
      || value === 'choose_one'
      || value === 'rank_then_merge'
      || value === 'merge_inputs'
      || value === 'finalize';
  }

  private toSpeaker(event: ArchitectureExecutionEvent): ArchitectureChatProjection['messages'][number]['speaker'] {
    if (event.type === 'run_created') return 'system';
    if (event.type === 'run_stopped') return 'system';
    if (event.type === 'router_decision') return 'router';
    if (event.type === 'router_output') return 'router';
    if (event.type === 'final_artifact') return 'finalizer';
    if (event.type === 'artifact_created') return 'finalizer';
    return 'participant';
  }

  private isChatProjectionEvent(event: ArchitectureExecutionEvent): boolean {
    return event.type === 'run_created'
      || event.type === 'run_stopped'
      || event.type === 'participant_output'
      || event.type === 'router_decision'
      || event.type === 'final_artifact';
  }

}

function inferLocalProjectPathFromPrompt(prompt: string): string | undefined {
  const quotedMatch = prompt.match(/["']([A-Za-z]:\\[^"'\r\n]+)["']/);
  if (quotedMatch?.[1]) {
    return quotedMatch[1].trim();
  }
  const plainMatch = prompt.match(/\b([A-Za-z]:\\[^\s"'`]+)\b/);
  return plainMatch?.[1]?.trim();
}
