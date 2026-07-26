import { Inject, Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import { nanoid } from 'nanoid';
import type {
  AgentFlowContinuationCursor,
  ArchitectureChatProjection,
  ArchitectureChildAgentProjection,
  ArchitectureExecutionMode,
  ArchitectureExecutionEvent,
  ChatMessage,
  ArchitectureGraphProjection,
  ArchitectureRoleSlot,
  ArchitectureSchema,
  ArchitectureRun,
  ArchitectureSchemaEdge,
  ArchitectureSchemaNode,
  CreateArchitectureRunDto,
  WorkflowFailure,
  WorkflowReasonCode,
} from '@kalio/types';
import { SessionsService } from '../chat/sessions.service';
import { SessionManagerService } from '../chat/session-manager.service';
import { AuditService, type AuditLogEntry } from '../chat/audit.service';
import { RuntimeAuditLogger } from '../chat/runtime-audit-logger.service';
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
import { shouldOverlayPersistedChildAgents } from './architecture-graph-overlay.utils';
import { reconstructDurableArchitectureGraph } from './architecture-durable-graph';
import { architectureActionFieldsForEvent, architectureActionSummaryForEvent } from './architecture-action-summary';
import { buildArchitectureParentChatMessages } from './architecture-parent-chat-projection';
import { buildArchitectureRuntimeChatProjection } from './architecture-runtime-chat-projection.utils';
import { architectureFailureRuntimeAuditEventInput, architectureRuntimeAuditEventInput } from './architecture-runtime-audit';
import {
  architectureAuditEventActionField,
  architectureAuditExecutionMode,
  architectureAuditNumberField,
  architectureAuditPromptFromRecords,
  architectureAuditRecordField,
  architectureAuditRouteDecisionField,
  architectureAuditRouterOutputField,
  architectureAuditStringField,
  architectureAuditStringRecordField,
  architectureAuditWorkflowErrorCodeField,
  architectureAuditWorkflowEvidenceArrayField,
  architectureAuditWorkflowFailureField,
  architectureAuditWorkflowReasonCodeField,
  architectureAuditWorkflowRuntimeDecisionField,
  isArchitectureExecutionEventType,
  statusFromArchitectureAuditEventSummary,
  statusFromArchitectureEvents,
} from './architecture-runtime-audit-recovery.utils';
import {
  cloneArchitectureRuntimeSchema,
  validateArchitectureCreateRunDto,
  validateArchitectureCreateRunSlotOverrides,
} from './architecture-runtime-schema.utils';
import { hydrateArchitectureRootVfs, type ArchitectureVfsHydrationResult } from './architecture-vfs-hydration';
import { terminalWorkflowFailureFromEvents } from './architecture-runtime-failure.utils';
import {
  ARCHITECTURE_CLI_AGENT_IDS,
  buildArchitectureCliAgentContext,
  buildArchitectureVfsEvidenceContext,
} from './architecture-runtime-context.utils';
import { extractAllowanceContext } from '../agent-flow/agent-flow-launch-context';
import { workflowFailureFromError } from '../../common/utils/workflow-error.util';
import {
  createArchitectureBranchSessionRuntimeContext,
  createArchitectureRootSessionRuntimeContext,
  getArchitectureHistorySessionId,
  getArchitectureHostSessionId,
  getArchitectureParentSessionId,
  getPersistedArchitectureHistorySessionId,
  getPersistedArchitectureHostSessionId,
  getPersistedArchitectureParentSessionId,
  getArchitectureParentToolCallId,
} from './architecture-session-context';
import type { ArchitectureRuntimeStopPort } from '../chat/architecture-runtime-stop.port';

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

@Injectable()
export class ArchitectureRuntimeService implements ArchitectureRuntimeStopPort {
  private readonly logger = new Logger(ArchitectureRuntimeService.name);
  private readonly runs = new Map<string, ArchitectureRun>();
  private readonly eventsByRunId = new Map<string, ArchitectureExecutionEvent[]>();
  private readonly schemasByRunId = new Map<string, ArchitectureSchema>();
  private readonly stoppedRunIds = new Set<string>();
  private readonly activeRunExecutions = new Map<string, Promise<ArchitectureRun>>();

  constructor(
    private readonly registry: ArchitectureRegistryService,
    private readonly sessions: SessionsService,
    private readonly sessionManager: SessionManagerService,
    @Inject(ARCHITECTURE_ROLE_EXECUTOR) private readonly roleExecutor: ArchitectureRoleExecutor,
    @Optional() private readonly audit?: AuditService,
    @Optional() private readonly vfs?: VFSService,
    @Optional() private readonly cliAgentConfig?: Pick<CLIAgentConfigService, 'getConfig'>,
    @Optional() private readonly runtimeAudit?: RuntimeAuditLogger,
  ) {}

  async createRun(dto: CreateArchitectureRunDto, emit?: ArchitectureRoleExecutionInput['emit']): Promise<ArchitectureRun> {
    const prepared = await this.prepareRun(dto, 'running');
    return this.executePreparedRun(prepared, emit);
  }

  async createRunAsync(dto: CreateArchitectureRunDto, emit?: ArchitectureRoleExecutionInput['emit']): Promise<ArchitectureRun> {
    const prepared = await this.prepareRun(dto, 'running');
    const liveEvents: ArchitectureExecutionEvent[] = [];
    this.runs.set(prepared.run.id, prepared.run);
    this.schemasByRunId.set(prepared.run.id, cloneArchitectureRuntimeSchema(prepared.schema));
    this.eventsByRunId.set(prepared.run.id, liveEvents);
    await this.persistParentChatProjectionSafely(prepared.schema, prepared.run, liveEvents);

    const execution = this.executePreparedRun(prepared, emit, liveEvents).catch(async (error: unknown) => {
      if (prepared.run.status !== 'running' || this.stoppedRunIds.has(prepared.run.id)) {
        return this.runs.get(prepared.run.id) ?? prepared.run;
      }
      const now = Date.now();
      const failure = workflowFailureFromError(error);
      prepared.run.status = 'failed';
      prepared.run.errorCode = failure.code;
      prepared.run.failure = failure;
      prepared.run.updatedAt = now;
      prepared.run.completedAt = now;
      liveEvents.push({
        id: `${prepared.run.id}:event:${liveEvents.length + 1}`,
        runId: prepared.run.id,
        sequence: liveEvents.length + 1,
        type: 'router_decision',
        message: 'Architecture run failed.',
        lifecycle: 'failed',
        status: 'failed',
        errorCode: failure.code,
        failure,
        data: {
          errorCode: failure.code,
          failure,
        },
        createdAt: now,
      });
      this.runs.set(prepared.run.id, prepared.run);
      this.eventsByRunId.set(prepared.run.id, liveEvents);
      this.auditArchitectureFailure(prepared.schema, prepared.run, failure);
      this.auditArchitectureRun(prepared.schema, prepared.run, liveEvents);
      await this.persistParentChatProjectionSafely(prepared.schema, prepared.run, liveEvents);
      return prepared.run;
    }).finally(() => {
      if (this.activeRunExecutions.get(prepared.run.id) === execution) {
        this.activeRunExecutions.delete(prepared.run.id);
      }
    });
    this.activeRunExecutions.set(prepared.run.id, execution);
    void execution;

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
    validateArchitectureCreateRunSlotOverrides(schema, normalizedDto.slotOverrides);

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
    const configs = [];
    for (const agentId of ARCHITECTURE_CLI_AGENT_IDS) {
      const config = await this.cliAgentConfig.getConfig(agentId);
      configs.push({
        agentId,
        enabled: config.enabled,
        model: config.model,
        architecturePreference: config.architecturePreference,
      });
    }
    return buildArchitectureCliAgentContext(context, configs);
  }

  private async normalizeCreateRunDto(dto: CreateArchitectureRunDto): Promise<CreateArchitectureRunDto> {
    const validated = validateArchitectureCreateRunDto(dto);
    const inheritedContext = await this.inheritAllowanceContext(validated.context);
    return {
      ...validated,
      ...(inheritedContext ? { context: inheritedContext } : {}),
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

  private addVfsEvidenceToContext(
    context: Record<string, unknown> | undefined,
    rootSessionId: string,
    hydration: ArchitectureVfsHydrationResult | null,
  ): Record<string, unknown> | undefined {
    if (!hydration || !this.vfs || hydration.copiedFiles.length === 0) {
      return context;
    }

    return buildArchitectureVfsEvidenceContext(context, {
      rootSessionId,
      hydration,
      readFile: (path) => this.vfs?.readBinary(rootSessionId, path) ?? Buffer.alloc(0),
    });
  }

  private async executePreparedRun(
    prepared: { schema: ArchitectureSchema; run: ArchitectureRun; hydration: ArchitectureVfsHydrationResult | null },
    emit?: ArchitectureRoleExecutionInput['emit'],
    liveEvents?: ArchitectureExecutionEvent[],
    priorEvents?: ArchitectureExecutionEvent[],
    resumeFrom?: AgentFlowContinuationCursor,
  ): Promise<ArchitectureRun> {
    const { hydration, run, schema } = prepared;
    const emittedEvents = liveEvents ?? [];
    let events: ArchitectureExecutionEvent[];
    try {
      events = await createArchitectureGraphEvents({
        schema,
        run,
        now: run.createdAt,
        roleExecutor: this.roleExecutor,
        personaForSlot: (slot) => this.personaForRunSlot(run, slot),
        priorEvents,
        resumeFrom,
        emit,
        onEvent: (event) => {
          if (this.stoppedRunIds.has(run.id)) {
            throw new Error(`Architecture run ${run.id} was stopped by the user.`);
          }
          emittedEvents.push(event);
          if (liveEvents) {
            run.updatedAt = Date.now();
            this.runs.set(run.id, run);
            this.auditArchitectureEvent(schema, run, event);
          }
        },
      });
    } catch (error) {
      if (emittedEvents.length === 0) {
        throw error;
      }
      if (this.stoppedRunIds.has(run.id) || run.status !== 'running') {
        return this.runs.get(run.id) ?? run;
      }
      events = emittedEvents;
      const completedAt = Date.now();
      const recoveredStatus = statusFromArchitectureEvents(events);
      run.status = recoveredStatus === 'running' ? 'failed' : recoveredStatus;
      if (run.status === 'failed') {
        const terminalFailure = terminalWorkflowFailureFromEvents(events);
        const fallbackFailure = terminalFailure.failure ?? workflowFailureFromError(error);
        const errorCode = terminalFailure.errorCode ?? fallbackFailure.code;
        if (!events.some((event) => (
          event.type === 'router_decision'
          && event.status === 'failed'
          && event.message === 'Architecture run failed.'
        ))) {
          const terminalEvent: ArchitectureExecutionEvent = {
            id: `${run.id}:event:${events.length + 1}`,
            runId: run.id,
            sequence: events.length + 1,
            type: 'router_decision',
            message: 'Architecture run failed.',
            lifecycle: 'failed',
            status: 'failed',
            errorCode,
            failure: fallbackFailure,
            data: {
              errorCode,
              failure: fallbackFailure,
            },
            createdAt: completedAt,
          };
          events = [
            ...events,
            terminalEvent,
          ];
          this.auditArchitectureEvent(schema, run, terminalEvent);
        }
        run.errorCode = errorCode;
        run.failure = fallbackFailure;
        this.auditArchitectureFailure(schema, run, fallbackFailure);
      }
      run.updatedAt = completedAt;
      run.completedAt = completedAt;
      this.runs.set(run.id, run);
      this.schemasByRunId.set(run.id, cloneArchitectureRuntimeSchema(schema));
      this.eventsByRunId.set(run.id, events);
      this.auditArchitectureHydration(run, hydration);
      this.auditArchitectureRun(schema, run, events, liveEvents === undefined);
      await this.persistParentChatProjection(schema, run, events);
      return run;
    }
    if (this.stoppedRunIds.has(run.id) || run.status !== 'running') {
      return run;
    }
    const completedAt = Date.now();
    run.status = statusFromArchitectureEvents(events);
    if (run.status === 'failed') {
      const terminalFailure = terminalWorkflowFailureFromEvents(events);
      run.errorCode = terminalFailure.errorCode;
      run.failure = terminalFailure.failure;
    }
    run.updatedAt = completedAt;
    run.completedAt = run.status === 'running' ? undefined : completedAt;
    this.runs.set(run.id, run);
    this.schemasByRunId.set(run.id, cloneArchitectureRuntimeSchema(schema));
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
      reasonCode: 'user_stop',
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
      reasonCode: 'user_stop',
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

  async stopRunsForSessions(sessionIds: readonly string[]): Promise<readonly string[]> {
    const sessionIdSet = new Set(sessionIds.filter((sessionId) => sessionId.trim().length > 0));
    if (sessionIdSet.size === 0) {
      return [];
    }

    const stoppedRunIds: string[] = [];
    const drainPromises: Promise<ArchitectureRun>[] = [];
    for (const run of this.runs.values()) {
      if (run.status !== 'running' && run.status !== 'queued') {
        continue;
      }
      if (!this.runBelongsToSessionSet(run, sessionIdSet)) {
        continue;
      }
      await this.stopRun(run.id);
      stoppedRunIds.push(run.id);
      const activeExecution = this.activeRunExecutions.get(run.id);
      if (activeExecution) {
        drainPromises.push(activeExecution.catch((error: unknown) => {
          this.logger.warn(
            `Draining stopped Architecture run ${run.id} rejected: ${error instanceof Error ? error.message : String(error)}`,
          );
          return this.runs.get(run.id) ?? run;
        }));
      }
    }
    if (drainPromises.length > 0) {
      await Promise.all(drainPromises);
    }
    return stoppedRunIds;
  }

  private runBelongsToSessionSet(run: ArchitectureRun, sessionIds: ReadonlySet<string>): boolean {
    const runSessionIds = [
      run.rootSessionId,
      ...Object.values(run.branchSessionIds ?? {}),
      getArchitectureParentSessionId(run.context),
      getArchitectureHostSessionId(run.context),
      getArchitectureHistorySessionId(run.context),
    ].filter((sessionId): sessionId is string => typeof sessionId === 'string' && sessionId.length > 0);
    return runSessionIds.some((sessionId) => sessionIds.has(sessionId));
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
    this.schemasByRunId.set(run.id, cloneArchitectureRuntimeSchema(schema));
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
    if (liveGraph) {
      const liveRun = this.findRun(runId);
      const liveSchema = liveRun
        ? this.schemasByRunId.get(runId) ?? this.registry.findOne(liveRun.schemaId) ?? undefined
        : undefined;
      if (!shouldOverlayPersistedChildAgents(liveSchema, liveGraph)) {
        return liveGraph;
      }
      const persistedGraph = await this.reconstructPersistedGraphSafely(runId);
      return this.mergePersistedChildAgents(liveGraph, persistedGraph);
    }

    const persistedGraph = await this.reconstructPersistedGraphSafely(runId);
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
    return buildArchitectureRuntimeChatProjection(runId, this.getEvents(runId));
  }

  async getChatDurable(runId: string): Promise<ArchitectureChatProjection | null> {
    if (this.findRun(runId)) {
      return this.getChat(runId);
    }
    const run = await this.findRunDurable(runId);
    if (!run) return null;
    const events = await this.getEventsDurable(runId);
    return buildArchitectureRuntimeChatProjection(runId, events);
  }

  private async createBranchSessions(
    schema: ArchitectureSchema,
    runId: string,
    rootSessionId: string,
    dto: CreateArchitectureRunDto,
  ): Promise<Record<string, string>> {
    const isAgentFlowRoot = this.isAgentFlowContext(dto.context);
    const hostSessionId = getPersistedArchitectureHostSessionId(dto.context);
    const historySessionId = getPersistedArchitectureHistorySessionId(dto.context);
    await this.sessions.createWithId(rootSessionId, {
      personaId: 'default',
      title: this.toRunSessionTitle(dto.prompt),
      kind: isAgentFlowRoot ? 'agent-flow' : 'chat',
      parentSessionId: getPersistedArchitectureParentSessionId(dto.context),
      parentToolCallId: getArchitectureParentToolCallId(dto.context),
      runtimeContext: createArchitectureRootSessionRuntimeContext({
        runId,
        schemaId: schema.id,
        schemaName: schema.name,
        hostSessionId,
        historySessionId,
      }),
    }, { registerRuntimeProjectPath: true });

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
        }, { registerRuntimeProjectPath: true });
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
    const sessionId = getArchitectureParentSessionId(run.context) ?? run.rootSessionId ?? run.id;
    if (this.audit) {
      const actionFields = architectureActionFieldsForEvent(event);
      void this.audit.log({
        sessionId,
        type: 'architecture_event',
        label: `architecture_event:${event.type}:${event.nodeId ?? 'runtime'}`,
        data: {
          domain: 'architecture',
          kind: 'architecture_event',
          runId: run.id,
          architectureRunId: run.id,
          schemaId: schema.id,
          executionMode: run.executionMode,
          rootSessionId: run.rootSessionId,
          eventId: event.id,
          eventType: event.type,
          sequence: event.sequence,
          nodeId: event.nodeId,
          roleSlotId: event.roleSlotId,
          prompt: event.type === 'run_created' ? run.prompt : undefined,
          reasonCode: event.reasonCode,
          errorCode: event.errorCode,
          failure: event.failure,
          evidence: event.evidence,
          runtimeDecision: event.runtimeDecision,
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
    const runtimeEvent = architectureRuntimeAuditEventInput(schema, run, event, sessionId);
    if (runtimeEvent) {
      void this.runtimeAudit?.log(runtimeEvent);
    }
  }

  private toolEvidenceForAudit(event: ArchitectureExecutionEvent): Record<string, unknown> | undefined {
    const value = event.data?.['toolEvidence'];
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
  }

  private auditArchitectureFailure(
    schema: ArchitectureSchema,
    run: ArchitectureRun,
    failure: WorkflowFailure,
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
        errorCode: failure.code,
        failure,
        errorMessage: failure.message,
      },
    });
    const sessionId = getArchitectureParentSessionId(run.context) ?? run.rootSessionId ?? run.id;
    void this.runtimeAudit?.log(architectureFailureRuntimeAuditEventInput(schema, run, failure, sessionId));
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

    const schemaId = architectureAuditStringField(source, 'schemaId');
    if (!schemaId) {
      return null;
    }

    const eventTypes = records
      .map((record) => architectureAuditStringField(record, 'eventType'))
      .filter((type): type is string => Boolean(type));
    const events: Array<{ type: string; reasonCode?: WorkflowReasonCode }> = [];
    for (const record of records) {
      const type = architectureAuditStringField(record, 'eventType');
      if (!type || !isArchitectureExecutionEventType(type)) continue;
      events.push({
        type,
        reasonCode: architectureAuditWorkflowReasonCodeField(record, 'reasonCode')
          ?? architectureAuditWorkflowReasonCodeField(architectureAuditRecordField(record, 'data'), 'reasonCode'),
      });
    }
    const hasFinalArtifact = eventTypes.includes('final_artifact');
    const hasError = Boolean(error);
    const status: ArchitectureRun['status'] = hasError ? 'failed' : hasFinalArtifact ? 'completed' : statusFromArchitectureAuditEventSummary(events);
    const createdAt = Math.min(...rows.map((row) => row.createdAt));
    const updatedAt = Math.max(...rows.map((row) => row.createdAt));
    const executionMode = architectureAuditExecutionMode(source);
    const candidateRootSessionId = architectureAuditStringField(source, 'rootSessionId') ?? rows.find((row) => row.sessionId)?.sessionId ?? undefined;
    const auditedBranchSessionIds = architectureAuditStringRecordField(source, 'branchSessionIds');
    const recoveredOwnership = auditedBranchSessionIds && Object.keys(auditedBranchSessionIds).length > 0
      ? { rootSessionId: candidateRootSessionId, branchSessionIds: auditedBranchSessionIds }
      : await this.reconstructSessionOwnership(runId, candidateRootSessionId);
    const rootSessionId = recoveredOwnership.rootSessionId ?? candidateRootSessionId;
    const branchSessionIds = recoveredOwnership.branchSessionIds;

    return {
      id: runId,
      schemaId,
      prompt: architectureAuditPromptFromRecords(records) ?? `Recovered architecture run ${runId}`,
      executionMode,
      rootSessionId,
      branchSessionIds,
      status,
      createdAt,
      updatedAt,
      completedAt: status === 'running' ? undefined : updatedAt,
    };
  }

  private async reconstructSessionOwnership(
    runId: string,
    candidateRootSessionId: string | undefined,
  ): Promise<{ rootSessionId?: string; branchSessionIds?: Record<string, string> }> {
    if (!candidateRootSessionId) return {};

    const candidateChildren = await this.sessions.listChildren(candidateRootSessionId);
    const directBranches = this.branchSessionIdsFromSessions(runId, candidateChildren);
    if (directBranches) {
      return { rootSessionId: candidateRootSessionId, branchSessionIds: directBranches };
    }

    const durableRoot = candidateChildren.find((session) =>
      session.runtimeContext?.runtimeKind === 'agent-flow-root'
      && session.runtimeContext.architectureContext?.architectureRunId === runId);
    if (!durableRoot) return { rootSessionId: candidateRootSessionId };

    const branchSessions = await this.sessions.listChildren(durableRoot.id);
    return {
      rootSessionId: durableRoot.id,
      branchSessionIds: this.branchSessionIdsFromSessions(runId, branchSessions),
    };
  }

  private branchSessionIdsFromSessions(
    runId: string,
    sessions: Awaited<ReturnType<SessionsService['listChildren']>>,
  ): Record<string, string> | undefined {
    const pairs = sessions.flatMap((session) => {
      const context = session.runtimeContext;
      const architectureContext = context?.architectureContext;
      if (context?.runtimeKind !== 'agent-flow-branch') return [];
      if (architectureContext?.architectureRunId !== runId) return [];

      const slotId = context.architectureSlotId ?? architectureContext.roleSlotId;
      return slotId ? [[slotId, session.id] as const] : [];
    });

    return pairs.length > 0 ? Object.fromEntries(pairs) : undefined;
  }

  private async reconstructEventsFromAudit(runId: string): Promise<ArchitectureExecutionEvent[]> {
    const rows = await this.auditRowsForRun(runId);
    const eventRows = rows
      .map((row) => ({ row, data: this.auditData(row) }))
      .filter(({ data }) =>
        data.kind === 'architecture_event'
        && isArchitectureExecutionEventType(data.eventType));

    return eventRows.map(({ row, data }, index) => {
      const eventId = architectureAuditStringField(data, 'eventId') ?? `${runId}:audit:${row.id}`;
      const eventType = data.eventType;
      if (!isArchitectureExecutionEventType(eventType)) {
        throw new Error(`Invalid recovered architecture event type for run ${runId}`);
      }
      const route = architectureAuditRouteDecisionField(data, 'route');
      const routerOutput = architectureAuditRouterOutputField(data, 'routerOutput');
      // TODO: legacy fallback - older audit rows only persisted messagePreview/actionSummary, so rebuild action/detail from structured route/routerOutput when needed.
      const actionFields = architectureActionFieldsForEvent({
        type: eventType,
        actionSummary: architectureAuditStringField(data, 'actionSummary'),
        action: architectureAuditEventActionField(data, 'action'),
        detail: architectureAuditStringField(data, 'detail'),
        route,
        routerOutput,
        data,
      });
      return {
        id: eventId,
        runId,
        sequence: architectureAuditNumberField(data, 'sequence') ?? index + 1,
        type: eventType,
        message: architectureAuditStringField(data, 'messagePreview') ?? row.label,
        actionSummary: actionFields.actionSummary,
        action: actionFields.action,
        detail: actionFields.detail,
        nodeId: architectureAuditStringField(data, 'nodeId'),
        roleSlotId: architectureAuditStringField(data, 'roleSlotId'),
        route,
        routerOutput,
        reasonCode: architectureAuditWorkflowReasonCodeField(data, 'reasonCode'),
        errorCode: architectureAuditWorkflowErrorCodeField(data, 'errorCode'),
        failure: architectureAuditWorkflowFailureField(data, 'failure'),
        evidence: architectureAuditWorkflowEvidenceArrayField(data, 'evidence'),
        runtimeDecision: architectureAuditWorkflowRuntimeDecisionField(data, 'runtimeDecision'),
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
        const leftSequence = architectureAuditNumberField(this.auditData(left), 'sequence') ?? 0;
        const rightSequence = architectureAuditNumberField(this.auditData(right), 'sequence') ?? 0;
        return leftSequence - rightSequence;
      });
  }

  private auditData(row: AuditLogEntry): Record<string, unknown> {
    return row.data && this.isPlainRecord(row.data) ? row.data : {};
  }

  private toRunSessionTitle(prompt: string): string {
    const trimmed = prompt.trim();
    const summary = trimmed.length > 56 ? `${trimmed.slice(0, 56)}...` : trimmed;
    return `Architecture: ${summary || 'Untitled run'}`;
  }

  private isPlainRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }

}

