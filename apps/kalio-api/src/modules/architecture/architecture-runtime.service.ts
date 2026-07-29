import { Inject, Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import type {
  AgentFlowContinuationCursor,
  ArchitectureChatProjection,
  ArchitectureChildAgentProjection,
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
} from '@kalio/types';
import { SessionsService } from '../chat/sessions.service';
import { SessionManagerService } from '../chat/session-manager.service';
import { AuditService } from '../chat/audit.service';
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
import { architectureActionSummaryForEvent } from './architecture-action-summary';
import { buildArchitectureParentChatMessages } from './architecture-parent-chat-projection';
import { buildArchitectureRuntimeChatProjection } from './architecture-runtime-chat-projection.utils';
import {
  statusFromArchitectureEvents,
} from './architecture-runtime-audit-recovery.utils';
import {
  cloneArchitectureRuntimeSchema,
} from './architecture-runtime-schema.utils';
import { terminalWorkflowFailureFromEvents } from './architecture-runtime-failure.utils';
import { workflowFailureFromError } from '../../common/utils/workflow-error.util';
import {
  getArchitectureHistorySessionId,
  getArchitectureHostSessionId,
  getArchitectureParentSessionId,
} from './architecture-session-context';
import type { ArchitectureRuntimeStopPort } from '../chat/architecture-runtime-stop.port';
import { ArchitectureRunPreparationService, type PreparedArchitectureRun } from './architecture-run-preparation.service';
import {
  ArchitectureRuntimeAuditWriterService,
  type ArchitectureRuntimeAuditWriter,
} from './architecture-runtime-audit.service';
import {
  ArchitectureRuntimeAuditRecoveryService,
  type ArchitectureRuntimeAuditRecovery,
} from './architecture-runtime-audit-recovery.service';

const PERSISTED_GRAPH_RECOVERY_TIMEOUT_MS = 1500;

@Injectable()
export class ArchitectureRuntimeService implements ArchitectureRuntimeStopPort {
  private readonly logger = new Logger(ArchitectureRuntimeService.name);
  private readonly runs = new Map<string, ArchitectureRun>();
  private readonly eventsByRunId = new Map<string, ArchitectureExecutionEvent[]>();
  private readonly schemasByRunId = new Map<string, ArchitectureSchema>();
  private readonly stoppedRunIds = new Set<string>();
  private readonly activeRunExecutions = new Map<string, Promise<ArchitectureRun>>();
  private readonly preparation: ArchitectureRunPreparationService;
  private readonly auditWriter: ArchitectureRuntimeAuditWriter;
  private readonly auditRecovery: ArchitectureRuntimeAuditRecovery;

  constructor(
    private readonly registry: ArchitectureRegistryService,
    private readonly sessions: SessionsService,
    private readonly sessionManager: SessionManagerService,
    @Inject(ARCHITECTURE_ROLE_EXECUTOR) private readonly roleExecutor: ArchitectureRoleExecutor,
    @Optional() audit?: AuditService,
    @Optional() vfs?: VFSService,
    @Optional() cliAgentConfig?: Pick<CLIAgentConfigService, 'getConfig'>,
    @Optional() runtimeAudit?: RuntimeAuditLogger,
    @Optional() preparation?: ArchitectureRunPreparationService,
    @Optional() @Inject(ArchitectureRuntimeAuditWriterService) auditWriter?: ArchitectureRuntimeAuditWriter,
    @Optional() @Inject(ArchitectureRuntimeAuditRecoveryService) auditRecovery?: ArchitectureRuntimeAuditRecovery,
  ) {
    // TODO: legacy fallback: preserve direct-construction compatibility for existing tests and integrations.
    this.preparation = preparation ?? new ArchitectureRunPreparationService(registry, sessions, vfs, cliAgentConfig);
    // TODO: legacy fallback: preserve direct-construction compatibility until all callers use Nest DI.
    this.auditWriter = auditWriter ?? new ArchitectureRuntimeAuditWriterService(audit, runtimeAudit);
    // TODO: legacy fallback: preserve direct-construction compatibility until all callers use Nest DI.
    this.auditRecovery = auditRecovery ?? new ArchitectureRuntimeAuditRecoveryService(sessions, audit);
  }

  async createRun(dto: CreateArchitectureRunDto, emit?: ArchitectureRoleExecutionInput['emit']): Promise<ArchitectureRun> {
    const prepared = await this.preparation.prepareRun(dto, 'running');
    return this.executePreparedRun(prepared, emit);
  }

  async createRunAsync(dto: CreateArchitectureRunDto, emit?: ArchitectureRoleExecutionInput['emit']): Promise<ArchitectureRun> {
    const prepared = await this.preparation.prepareRun(dto, 'running');
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
      this.auditWriter.logFailure(prepared.schema, prepared.run, failure);
      this.auditWriter.logRun(prepared.schema, prepared.run, liveEvents);
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

  private async executePreparedRun(
    prepared: PreparedArchitectureRun,
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
            this.auditWriter.logEvent(schema, run, event);
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
          this.auditWriter.logEvent(schema, run, terminalEvent);
        }
        run.errorCode = errorCode;
        run.failure = fallbackFailure;
        this.auditWriter.logFailure(schema, run, fallbackFailure);
      }
      run.updatedAt = completedAt;
      run.completedAt = completedAt;
      this.runs.set(run.id, run);
      this.schemasByRunId.set(run.id, cloneArchitectureRuntimeSchema(schema));
      this.eventsByRunId.set(run.id, events);
      this.auditWriter.logHydration(run, hydration);
      this.auditWriter.logRun(schema, run, events, liveEvents === undefined);
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
    this.auditWriter.logHydration(run, hydration);
    this.auditWriter.logRun(schema, run, events, liveEvents === undefined);
    await this.persistParentChatProjection(schema, run, events);
    return run;
  }

  findRun(id: string): ArchitectureRun | null {
    return this.runs.get(id) ?? null;
  }

  async findRunDurable(id: string): Promise<ArchitectureRun | null> {
    return this.findRun(id) ?? this.auditRecovery.reconstructRun(id);
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
      this.auditWriter.logEvent(schema, stoppedRun, stopEvent);
      this.auditWriter.logRun(schema, stoppedRun, nextEvents);
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
    return this.auditRecovery.reconstructEvents(runId);
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
    const auditEvents = await this.auditRecovery.reconstructEvents(runId);
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

  private personaForRunSlot(run: ArchitectureRun, slot: ArchitectureRoleSlot): string {
    return this.preparation.resolveArchitecturePersonaId(run.slotOverrides?.[slot.id] ?? slot.defaultPersonaId);
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

}

