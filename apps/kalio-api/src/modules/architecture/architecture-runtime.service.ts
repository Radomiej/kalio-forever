import { ConflictException, Inject, Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import type {
  ArchitectureChatProjection,
  ArchitectureExecutionEvent,
  ArchitectureGraphProjection,
  ArchitectureRoleSlot,
  ArchitectureSchema,
  ArchitectureRun,
  CreateArchitectureRunDto,
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
import { createArchitectureGraphEvents } from './architecture-graph-runtime';
import { shouldOverlayPersistedChildAgents } from './architecture-graph-overlay.utils';
import {
  statusFromArchitectureEvents,
} from './architecture-runtime-audit-recovery.utils';
import {
  cloneArchitectureRuntimeSchema,
} from './architecture-runtime-schema.utils';
import { terminalWorkflowFailureFromEvents } from './architecture-runtime-failure.utils';
import { workflowFailureFromError } from '../../common/utils/workflow-error.util';
import { architectureRunBelongsToSessionSet, findActiveArchitectureRunSessionId } from './architecture-runtime-session.utils';
import { ArchitectureAutoRoutingService } from './architecture-auto-routing.service';
import { createArchitectureRuntimeAutoRoutingHooks } from './architecture-runtime-auto-routing-hooks';
import { mergeArchitectureRuntimeEvents, type ArchitectureRuntimeResumeCursor } from './architecture-runtime-auto-routing-recovery.utils';
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
import { ArchitectureRuntimeChatProjectionService } from './architecture-runtime-chat-projection.service';
import { ArchitectureRuntimeGraphProjectionService } from './architecture-runtime-graph-projection.service';
import { ArchitectureGoalRunResumeService } from './architecture-goal-run-resume.service';
import { GOAL_ROUTE_RESUME, prepareArchitectureResume,
  type ArchitectureResumeInput, type GoalRouteResumePort } from './architecture-runtime-resume.utils';
import { ArchitectureRunMutationBarrier } from './architecture-run-mutation-barrier';
import { persistArchitectureStop, requiresGoalStopAck } from './architecture-runtime-stop';

@Injectable()
export class ArchitectureRuntimeService implements ArchitectureRuntimeStopPort {
  private readonly logger = new Logger(ArchitectureRuntimeService.name);
  private readonly runs = new Map<string, ArchitectureRun>();
  private readonly eventsByRunId = new Map<string, ArchitectureExecutionEvent[]>();
  private readonly schemasByRunId = new Map<string, ArchitectureSchema>();
  private readonly stoppedRunIds = new Set<string>();
  private readonly activeRunExecutions = new Map<string, Promise<ArchitectureRun>>();
  private readonly runAbortControllers = new Map<string, AbortController>();
  private readonly reservedDecisionSequences = new Map<string, number>();
  private readonly mutations = new ArchitectureRunMutationBarrier();
  private readonly preparation: ArchitectureRunPreparationService;
  private readonly auditWriter: ArchitectureRuntimeAuditWriter;
  private readonly auditRecovery: ArchitectureRuntimeAuditRecovery;
  private readonly chatProjection: ArchitectureRuntimeChatProjectionService;
  private readonly graphProjection: ArchitectureRuntimeGraphProjectionService;

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
    @Optional() chatProjection?: ArchitectureRuntimeChatProjectionService,
    @Optional() graphProjection?: ArchitectureRuntimeGraphProjectionService,
    @Optional() private readonly autoRouting?: ArchitectureAutoRoutingService,
    @Optional() private readonly goalResume?: ArchitectureGoalRunResumeService,
    @Optional() @Inject(GOAL_ROUTE_RESUME) private readonly goalRouteResume?: GoalRouteResumePort,
  ) {
    // TODO: legacy fallback: preserve direct-construction compatibility for existing tests and integrations.
    this.preparation = preparation ?? new ArchitectureRunPreparationService(registry, sessions, vfs, cliAgentConfig);
    // TODO: legacy fallback: preserve direct-construction compatibility until all callers use Nest DI.
    this.auditWriter = auditWriter ?? new ArchitectureRuntimeAuditWriterService(audit, runtimeAudit);
    // TODO: legacy fallback: preserve direct-construction compatibility until all callers use Nest DI.
    this.auditRecovery = auditRecovery ?? new ArchitectureRuntimeAuditRecoveryService(sessions, audit);
    // TODO: legacy fallback: preserve direct-construction compatibility until all callers use Nest DI.
    this.chatProjection = chatProjection ?? new ArchitectureRuntimeChatProjectionService(sessions, sessionManager);
    // TODO: legacy fallback: preserve direct-construction compatibility until all callers use Nest DI.
    this.graphProjection = graphProjection ?? new ArchitectureRuntimeGraphProjectionService(sessions, registry);
  }

  async createRun(dto: CreateArchitectureRunDto, emit?: ArchitectureRoleExecutionInput['emit']): Promise<ArchitectureRun> {
    const prepared = await this.preparation.prepareRun(dto, 'running');
    const liveEvents: ArchitectureExecutionEvent[] = [];
    this.runs.set(prepared.run.id, prepared.run);
    this.schemasByRunId.set(prepared.run.id, cloneArchitectureRuntimeSchema(prepared.schema));
    this.eventsByRunId.set(prepared.run.id, liveEvents);
    return this.trackExecution(prepared.run.id, (signal) => this.executePreparedRun(prepared, emit, liveEvents, undefined, undefined, signal));
  }

  async createRunAsync(dto: CreateArchitectureRunDto, emit?: ArchitectureRoleExecutionInput['emit']): Promise<ArchitectureRun> {
    const prepared = await this.preparation.prepareRun(dto, 'running');
    const liveEvents: ArchitectureExecutionEvent[] = [];
    this.runs.set(prepared.run.id, prepared.run);
    this.schemasByRunId.set(prepared.run.id, cloneArchitectureRuntimeSchema(prepared.schema));
    this.eventsByRunId.set(prepared.run.id, liveEvents);
    await this.chatProjection.persistParentSafely(prepared.schema, prepared.run, liveEvents);

    const execution = this.trackExecution(prepared.run.id, (signal) => this.executePreparedRun(prepared, emit, liveEvents, undefined, undefined, signal)).catch(async (error: unknown) => {
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
      await this.chatProjection.persistParentSafely(prepared.schema, prepared.run, liveEvents);
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
    resumeFrom?: ArchitectureRuntimeResumeCursor,
    signal?: AbortSignal,
  ): Promise<ArchitectureRun> {
    const { hydration, run, schema } = prepared;
    const emittedEvents = liveEvents ?? [];
    let events: ArchitectureExecutionEvent[];
    try {
      const hooks = createArchitectureRuntimeAutoRoutingHooks({
        signal, autoRouting: this.autoRouting, emittedEvents,
        getEvents: () => this.eventsByRunId.get(run.id) ?? emittedEvents,
        isStopped: () => this.stoppedRunIds.has(run.id),
        persistDecision: (event, id) => this.auditWriter.logRouteDecisionRequired(schema, run, event, id),
        reserveDecisionSequence: (sequence) => this.reservedDecisionSequences.set(run.id, Math.max(sequence, this.reservedDecisionSequences.get(run.id) ?? 0)),
        persistStoppedEvent: (event) => this.eventsByRunId.set(run.id, mergeArchitectureRuntimeEvents([event], this.getEvents(run.id))),
        onLiveEvent: (event) => {
          if (!liveEvents) return;
          run.updatedAt = Date.now();
          this.runs.set(run.id, run);
          if (event.data?.['kind'] !== 'auto_routing_decision') this.auditWriter.logEvent(schema, run, event);
        },
      });
      events = await createArchitectureGraphEvents({
        schema,
        run,
        now: run.createdAt,
        roleExecutor: this.roleExecutor,
        personaForSlot: (slot) => this.personaForRunSlot(run, slot),
        priorEvents,
        resumeFrom,
        emit,
        ...hooks,
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
      await this.chatProjection.persistParent(schema, run, events);
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
    await this.chatProjection.persistParent(schema, run, events);
    return run;
  }

  findRun(id: string): ArchitectureRun | null {
    return this.runs.get(id) ?? null;
  }

  async findRunDurable(id: string): Promise<ArchitectureRun | null> {
    return this.findRun(id) ?? this.auditRecovery.reconstructRun(id);
  }

  async stopRun(id: string): Promise<ArchitectureRun> {
    const stopReason = new Error(`Architecture run ${id} was stopped by the user.`);
    // Live execution must see Stop before any durable lookup can yield.
    if (this.runs.has(id)) {
      this.stoppedRunIds.add(id);
      this.runAbortControllers.get(id)?.abort(stopReason);
    }
    return this.mutations.serializeStop(id, () => persistArchitectureStop(id, {
      findRun: () => this.findRunDurable(id),
      getEvents: async () => this.eventsByRunId.get(id) ?? this.getEventsDurable(id),
      reservedSequence: () => this.reservedDecisionSequences.get(id) ?? 0,
      markStopped: () => {
        this.stoppedRunIds.add(id);
        this.runAbortControllers.get(id)?.abort(stopReason);
      },
      recordRun: run => this.runs.set(id, run),
      recordEvents: events => this.eventsByRunId.set(id, events),
      findSchema: run => this.schemasByRunId.get(id) ?? this.registry.findOne(run.schemaId) ?? undefined,
      persist: async (schema, run, event, events, replayed) => {
        const required = requiresGoalStopAck(run);
        if (required) await this.auditWriter.logRouteDecisionRequired(schema, run, event, event.id);
        if (!replayed) {
          if (!required) this.auditWriter.logEvent(schema, run, event);
          this.auditWriter.logRun(schema, run, events);
        }
        await this.chatProjection.persistParentSafely(schema, run, events);
      },
    }));
  }

  async stopRunsForSessions(sessionIds: readonly string[]): Promise<readonly string[]> {
    const sessionIdSet = new Set(sessionIds.filter((sessionId) => sessionId.trim().length > 0));
    if (sessionIdSet.size === 0) {
      return [];
    }

    const stoppedRunIds: string[] = [];
    const drainPromises: Promise<ArchitectureRun>[] = [];
    for (const run of this.runs.values()) {
      const activeExecution = this.activeRunExecutions.get(run.id);
      if (run.status !== 'running' && run.status !== 'queued'
        && !(run.status === 'cancelled' && this.stoppedRunIds.has(run.id)
          && (activeExecution || requiresGoalStopAck(run)))) {
        continue;
      }
      if (!architectureRunBelongsToSessionSet(run, sessionIdSet)) {
        continue;
      }
      if (run.status !== 'cancelled' || requiresGoalStopAck(run)) await this.stopRun(run.id);
      stoppedRunIds.push(run.id);
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

  findActiveSessionIdForSessions(sessionIds: readonly string[]): string | undefined {
    return findActiveArchitectureRunSessionId(this.runs.values(), sessionIds);
  }

  getEvents(runId: string): ArchitectureExecutionEvent[] {
    return this.eventsByRunId.get(runId) ?? [];
  }

  async getEventsDurable(runId: string): Promise<ArchitectureExecutionEvent[]> {
    const liveEvents = this.getEvents(runId);
    return mergeArchitectureRuntimeEvents(liveEvents, await this.auditRecovery.reconstructEvents(runId));
  }

  async resumeRun(
    runId: string,
    dto: ArchitectureResumeInput,
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
    const active = this.activeRunExecutions.get(runId);
    if (active) {
      if (!this.stoppedRunIds.has(runId)) throw new ConflictException(`Architecture run ${runId} is already executing`);
      await active;
    }
    return this.trackExecution(runId, async (signal) => {
      const priorEvents = await this.getEventsDurable(runId);
      const { run, continuation } = await prepareArchitectureResume(existing, schema, dto, priorEvents,
        signal, this.goalResume, this.goalRouteResume);
      signal.throwIfAborted();
      this.stoppedRunIds.delete(runId);
      this.runs.set(run.id, run);
      this.schemasByRunId.set(run.id, cloneArchitectureRuntimeSchema(schema));
      this.eventsByRunId.set(run.id, []);
      this.reservedDecisionSequences.delete(runId);
      return this.executePreparedRun({ schema, run, hydration: null }, emit, [], priorEvents, continuation, signal);
    });
  }

  getGraph(runId: string): ArchitectureGraphProjection | null {
    const run = this.findRun(runId);
    if (!run) return null;
    const schema = this.schemasByRunId.get(runId) ?? this.registry.findOne(run.schemaId);
    if (!schema) return null;

    return this.graphProjection.build(runId, schema, this.getEvents(runId), run.status);
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
       const persistedGraph = await this.graphProjection.reconstructPersisted(runId);
       return this.graphProjection.mergePersistedChildAgents(liveGraph, persistedGraph);
    }

    const persistedGraph = await this.graphProjection.reconstructPersisted(runId);
    const run = await this.findRunDurable(runId);
    if (!run) return persistedGraph;
    const schema = this.schemasByRunId.get(runId) ?? this.registry.findOne(run.schemaId);
    const auditEvents = await this.auditRecovery.reconstructEvents(runId);
    if (schema && auditEvents.length > 0) {
      return this.graphProjection.mergePersistedChildAgents(
        this.graphProjection.build(runId, schema, auditEvents, run.status),
        persistedGraph,
      );
    }

    if (persistedGraph) {
      return persistedGraph;
    }

    if (!schema) return null;
    const events = await this.getEventsDurable(runId);
    if (events.length === 0) return null;
    return this.graphProjection.build(runId, schema, events, run.status);
  }

  getChat(runId: string): ArchitectureChatProjection | null {
    if (!this.findRun(runId)) return null;
    return this.chatProjection.build(runId, this.getEvents(runId));
  }

  async getChatDurable(runId: string): Promise<ArchitectureChatProjection | null> {
    if (this.findRun(runId)) {
      return this.getChat(runId);
    }
    const run = await this.findRunDurable(runId);
    if (!run) return null;
    const events = await this.getEventsDurable(runId);
    return this.chatProjection.build(runId, events);
  }

  private personaForRunSlot(run: ArchitectureRun, slot: ArchitectureRoleSlot): string {
    return this.preparation.resolveArchitecturePersonaId(run.slotOverrides?.[slot.id] ?? slot.defaultPersonaId);
  }

  private trackExecution(id: string, operation: (signal: AbortSignal) => Promise<ArchitectureRun>): Promise<ArchitectureRun> {
    if (this.runAbortControllers.has(id)) return Promise.reject(new ConflictException(`Architecture run ${id} is already executing`));
    const controller = new AbortController();
    this.runAbortControllers.set(id, controller);
    const execution = operation(controller.signal).finally(() => {
      if (this.runAbortControllers.get(id) === controller) this.runAbortControllers.delete(id);
      if (this.activeRunExecutions.get(id) === execution) this.activeRunExecutions.delete(id);
    });
    this.activeRunExecutions.set(id, execution);
    return execution;
  }

}

