import {
  WebSocketGateway,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Inject, Logger, Optional, UseFilters } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import type { Socket } from 'socket.io';
import type { SocketEvents } from '@kalio/types';
import { ToolDispatchService } from './tool-dispatch.service';
import { SessionPipelineService } from './session-pipeline.service';
import { SessionsService } from './sessions.service';
import { SessionEventsService } from './session-events.service';
import { AgentBudgetApprovalService } from './agent-budget-approval.service';
import type { EmitFn } from './interfaces/stream-context.interface';
import { WsExceptionFilter } from '../../common/filters/ws-exception.filter';
import { RAAppHITLService } from '../raapp/raapp-hitl.service';
import { AGENT_FLOW_RUNTIME, type AgentFlowRuntimePort } from '../agent-flow/agent-flow-runtime.port';
import {
  CLI_AGENT_SESSION_RUNTIME,
  type CLIAgentSessionRuntimePort,
} from '../cli-agent/cli-agent-session-runtime.port';
import {
  ARCHITECTURE_RUNTIME_STOP,
  type ArchitectureRuntimeStopPort,
} from './architecture-runtime-stop.port';
import { findAgentFlowSnapshotsForSessions, isActiveAgentFlowSnapshot } from './chat.gateway.agentflow-stop';
import { getSocketEventSessionId, isActionableSessionEvent } from './chat.gateway.event-routing';
import { emitSessionLifecycleEventToSubscribers } from './chat.gateway.lifecycle';
import {
  buildRuntimeActivitySnapshot,
  buildRuntimeActivitySnapshotBatch,
  collectRuntimeSnapshotSessionTree,
  type RuntimeSnapshotSessionTree,
} from './chat.runtime-snapshot';

@UseFilters(WsExceptionFilter)
@WebSocketGateway({ cors: { origin: '*' } })
export class ChatGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(ChatGateway.name);

  // Track per-socket sessions for disconnect cleanup
  private readonly socketSessions = new Map<string, Set<string>>();
  private readonly clients = new Map<string, Socket>();
  private readonly sessionSubscribers = new Map<string, Set<string>>();
  private sessionLifecycleBroadcastQueue: Promise<void> = Promise.resolve();

  constructor(
    private readonly toolDispatch: ToolDispatchService,
    private readonly pipeline: SessionPipelineService,
    private readonly raappHITL: RAAppHITLService,
    private readonly sessionsService: SessionsService,
    private readonly sessionEvents: SessionEventsService,
    private readonly agentBudgetApprovals: AgentBudgetApprovalService,
    @Optional() @Inject(AGENT_FLOW_RUNTIME) private readonly agentFlowRuntime?: AgentFlowRuntimePort,
    @Optional() @Inject(CLI_AGENT_SESSION_RUNTIME) private readonly cliAgentSessionRuntime?: CLIAgentSessionRuntimePort,
    @Optional() @Inject(ARCHITECTURE_RUNTIME_STOP) private readonly architectureRuntimeStop?: ArchitectureRuntimeStopPort,
    @Optional() private readonly moduleRef?: ModuleRef,
  ) {
    this.sessionEvents.onSessionCreated(({ session }) => {
      this.emitSessionLifecycleEvent('session:created', session);
    });
    this.sessionEvents.onSessionUpdated(({ session }) => {
      this.emitSessionLifecycleEvent('session:updated', session);
    });
  }

  handleConnection(client: Socket): void {
    this.logger.log(`Client connected: ${client.id}`);
    this.clients.set(client.id, client);
    this.socketSessions.set(client.id, new Set());
  }

  handleDisconnect(client: Socket): void {
    this.logger.log(`Client disconnected: ${client.id}`);
    this.clients.delete(client.id);
    this.socketSessions.delete(client.id);
    Array.from(this.sessionSubscribers.keys()).forEach((sessionId) => {
      this.unsubscribeSocketFromSession(client.id, sessionId);
    });
  }

  @SubscribeMessage('session:identify')
  async handleSessionIdentify(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: SocketEvents['session:identify'],
  ): Promise<void> {
    this.subscribeSocketToSession(client.id, payload.sessionId);

    const replayedRequestIds = new Set<string>();
    const replayPendingConfirmations = (sessionId: string): void => {
      this.toolDispatch.getPendingConfirmations(sessionId).forEach((request) => {
        this.subscribeSocketToSession(client.id, request.sessionId);
        if (replayedRequestIds.has(request.requestId)) {
          return;
        }
        replayedRequestIds.add(request.requestId);
        client.emit('tool:confirmation_required', request);
      });
      this.agentBudgetApprovals.getPendingApprovals(sessionId).forEach((request) => {
        replayedRequestIds.add(request.requestId);
        client.emit('agent:budget_required', request);
      });
    };

    const sessionTree = await this.collectRuntimeSnapshotSessionTree(payload.sessionId);
    const statusesBySessionId: Record<string, SocketEvents['session:status']> = {};
    for (const sessionId of sessionTree.sessionIds) {
      if (sessionId === payload.sessionId) {
        continue;
      }
      const descendantSession = sessionTree.childSessionsById[sessionId];
      if (descendantSession) {
        client.emit('session:updated', descendantSession);
      }
    }

    for (const sessionId of sessionTree.sessionIds) {
      if (sessionId !== payload.sessionId) {
        this.subscribeSocketToSession(client.id, sessionId);
      }
      replayPendingConfirmations(sessionId);
      const status = await this.pipeline.getSessionStatusWithRun(sessionId);
      statusesBySessionId[sessionId] = status;
      client.emit('session:status', status);
    }

    const snapshotBatch = await this.buildRuntimeActivitySnapshots(payload.sessionId, sessionTree, statusesBySessionId);
    for (const sessionId of snapshotBatch.sessionIds) {
      client.emit('session:runtime_snapshot', snapshotBatch.snapshotsBySessionId[sessionId]);
    }

    this.logger.log(`Session re-identified: ${payload.sessionId} for socket ${client.id}`);
  }

  @SubscribeMessage('chat:send')
  async handleChatSend(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: SocketEvents['chat:send'],
  ): Promise<void> {
    const emit: EmitFn = (event, data) => {
      this.emitToInitiatorAndSessionSubscribers(client.id, payload.sessionId, event, data);
    };
    this.subscribeSocketToSession(client.id, payload.sessionId);
    await this.pipeline.submit(payload, emit);
  }

  @SubscribeMessage('chat:stop')
  async handleChatStop(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: SocketEvents['chat:stop'],
  ): Promise<void> {
    const socketSessions = this.socketSessions.get(client.id);
    const isSubscribedToSession = this.sessionSubscribers.get(payload.sessionId)?.has(client.id) ?? false;
    if (!socketSessions?.has(payload.sessionId) && !isSubscribedToSession) {
      this.logger.warn(`chat:stop rejected — sessionId=${payload.sessionId} not owned by socket ${client.id}`);
      return;
    }

    const sessionTree = await this.collectRuntimeSnapshotSessionTree(payload.sessionId);
    const descendantSessionIds = sessionTree.descendantIdsBySessionId[payload.sessionId] ?? [];
    const stoppedSessionIds = [payload.sessionId, ...descendantSessionIds];

    await this.stopArchitectureRunsForSessions(stoppedSessionIds);
    await this.stopAgentFlowRunsForSessions(stoppedSessionIds);

    const stoppedStatusesBySessionId = await this.buildStoppedSessionStatuses(sessionTree.sessionIds);
    const stoppedSnapshotBatch = await this.buildRuntimeActivitySnapshots(
      payload.sessionId,
      sessionTree,
      stoppedStatusesBySessionId,
    );
    this.emitRuntimeActivitySnapshotBatch(client.id, stoppedSnapshotBatch);

    for (const sessionId of sessionTree.sessionIds) {
      await this.stopCliAgentSessionIfNeeded(client.id, sessionId);
      await this.pipeline.stopAndDrain(sessionId);
    }

    const snapshotBatch = await this.buildRuntimeActivitySnapshots(payload.sessionId, sessionTree);
    this.emitRuntimeActivitySnapshotBatch(client.id, snapshotBatch);
  }

  @SubscribeMessage('tool:confirm')
  handleToolConfirm(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: SocketEvents['tool:confirm'],
  ): void {
    const socketSessions = this.socketSessions.get(client.id);
    if (!socketSessions?.has(payload.sessionId)) {
      this.logger.warn(`tool:confirm rejected — sessionId=${payload.sessionId} not owned by socket ${client.id}`);
      return;
    }
    const status = payload.message
      ? this.toolDispatch.resolveConfirmation(payload.requestId, payload.sessionId, payload.message)
      : this.toolDispatch.resolveConfirmation(payload.requestId, payload.sessionId);
    if (status === 'not_found') {
      client.emit('tool:confirmation_invalidated', {
        requestId: payload.requestId,
        sessionId: payload.sessionId,
        reason: 'not_found',
        message: 'This approval is no longer active.',
      } satisfies SocketEvents['tool:confirmation_invalidated']);
    }
  }

  @SubscribeMessage('tool:cancel')
  handleToolCancel(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: SocketEvents['tool:cancel'],
  ): void {
    const socketSessions = this.socketSessions.get(client.id);
    if (!socketSessions?.has(payload.sessionId)) {
      this.logger.warn(`tool:cancel rejected — sessionId=${payload.sessionId} not owned by socket ${client.id}`);
      return;
    }
    const status = payload.message
      ? this.toolDispatch.cancelConfirmation(payload.requestId, payload.sessionId, payload.message)
      : this.toolDispatch.cancelConfirmation(payload.requestId, payload.sessionId);
    if (status === 'not_found') {
      client.emit('tool:confirmation_invalidated', {
        requestId: payload.requestId,
        sessionId: payload.sessionId,
        reason: 'not_found',
        message: 'This approval is no longer active.',
      } satisfies SocketEvents['tool:confirmation_invalidated']);
    }
  }

  @SubscribeMessage('raapp:approve')
  async handleRaAppApprove(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: SocketEvents['raapp:approve'],
  ): Promise<void> {
    // Guard: only allow approval for sessions owned by this socket
    const socketSessions = this.socketSessions.get(client.id);
    if (!socketSessions?.has(payload.sessionId)) {
      this.logger.warn(`raapp:approve rejected — sessionId=${payload.sessionId} not owned by socket ${client.id}`);
      return;
    }

    try {
      const results = await this.raappHITL.executeApproved(payload.requestIds, payload.sessionId);
      // toolCallId comes directly from the approval rows — no separate DB query needed
      const toolCallId = results[0]?.toolCallId ?? payload.requestIds[0];

      client.emit('raapp:native_result', {
        toolCallId,
        sessionId: payload.sessionId,
        results: results.map((r) => ({
          id: r.id,
          system: r.system,
          status: r.status,
          result: r.result,
          error: r.error,
        })),
      } satisfies SocketEvents['raapp:native_result']);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`raapp:approve failed session=${payload.sessionId} — ${message}`, err);
      client.emit('chat:error', {
        sessionId: payload.sessionId,
        code: 'TOOL_ERROR',
        message: `Native approval failed: ${message}`,
        hadContent: true,
      } satisfies SocketEvents['chat:error']);
    }
  }

  @SubscribeMessage('raapp:cancel')
  async handleRaAppCancel(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: SocketEvents['raapp:cancel'],
  ): Promise<void> {
    const socketSessions = this.socketSessions.get(client.id);
    if (!socketSessions?.has(payload.sessionId)) {
      this.logger.warn(`raapp:cancel rejected — sessionId=${payload.sessionId} not owned by socket ${client.id}`);
      return;
    }

    try {
      const pending = await this.raappHITL.getPendingForSession(payload.sessionId);
      const pendingById = new Map(
        pending
          .filter((item) => payload.requestIds.includes(item.id))
          .map((item) => [item.id, item]),
      );
      const cancelled = await this.raappHITL.cancelApprovals(payload.requestIds, payload.sessionId);
      client.emit('raapp:native_result', {
        toolCallId: cancelled.toolCallId,
        sessionId: payload.sessionId,
        results: payload.requestIds.map((id) => ({
          id,
          system: pendingById.get(id)?.system ?? 'unknown',
          status: 'cancelled' as const,
        })),
      } satisfies SocketEvents['raapp:native_result']);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`raapp:cancel failed session=${payload.sessionId} — ${message}`, err);
      client.emit('chat:error', {
        sessionId: payload.sessionId,
        code: 'TOOL_ERROR',
        message: `Native cancel failed: ${message}`,
        hadContent: true,
      } satisfies SocketEvents['chat:error']);
    }
  }

  private subscribeSocketToSession(socketId: string, sessionId: string, options?: { ownSession?: boolean }): void {
    if (!this.clients.has(socketId)) {
      return;
    }

    if (options?.ownSession !== false) {
      let sessions = this.socketSessions.get(socketId);
      if (!sessions) {
        sessions = new Set();
        this.socketSessions.set(socketId, sessions);
      }
      sessions.add(sessionId);
    }

    const subscribers = this.sessionSubscribers.get(sessionId) ?? new Set<string>();
    subscribers.add(socketId);
    this.sessionSubscribers.set(sessionId, subscribers);
  }

  private unsubscribeSocketFromSession(socketId: string, sessionId: string): void {
    const subscribers = this.sessionSubscribers.get(sessionId);
    if (!subscribers) return;
    subscribers.delete(socketId);
    if (subscribers.size === 0) {
      this.sessionSubscribers.delete(sessionId);
      return;
    }
    this.sessionSubscribers.set(sessionId, subscribers);
  }

  private emitToInitiatorAndSessionSubscribers<K extends keyof SocketEvents>(
    initiatorSocketId: string,
    fallbackSessionId: string,
    event: K,
    data: SocketEvents[K],
  ): void {
    const targetSessionId = getSocketEventSessionId(data) ?? fallbackSessionId;
    this.subscribeSocketToSession(initiatorSocketId, targetSessionId, {
      ownSession: isActionableSessionEvent(event),
    });

    const initiator = this.clients.get(initiatorSocketId);
    initiator?.emit(event, data);

    const subscribers = this.sessionSubscribers.get(targetSessionId);
    if (!subscribers) return;

    subscribers.forEach((socketId) => {
      if (socketId === initiatorSocketId) return;
      this.clients.get(socketId)?.emit(event, data);
    });
  }

  private collectRuntimeSnapshotSessionTree(rootSessionId: string): Promise<RuntimeSnapshotSessionTree> {
    return collectRuntimeSnapshotSessionTree(rootSessionId, this.sessionsService);
  }

  private buildRuntimeActivitySnapshot(
    sessionId: string,
    status?: SocketEvents['session:status'],
  ): Promise<SocketEvents['session:runtime_snapshot']> {
    return buildRuntimeActivitySnapshot({
      sessionId,
      status,
      pipeline: this.pipeline,
      toolDispatch: this.toolDispatch,
      agentBudgetApprovals: this.agentBudgetApprovals,
      sessionsService: this.sessionsService,
      agentFlowRuntime: this.getAgentFlowRuntime(),
      cliAgentSessionRuntime: this.getCliAgentSessionRuntime(),
      logger: this.logger,
    });
  }

  private buildRuntimeActivitySnapshots(
    rootSessionId: string,
    sessionTree?: RuntimeSnapshotSessionTree,
    statusesBySessionId?: Record<string, SocketEvents['session:status']>,
  ) {
    return buildRuntimeActivitySnapshotBatch({
      rootSessionId,
      sessionTree,
      statusesBySessionId,
      pipeline: this.pipeline,
      toolDispatch: this.toolDispatch,
      agentBudgetApprovals: this.agentBudgetApprovals,
      sessionsService: this.sessionsService,
      agentFlowRuntime: this.getAgentFlowRuntime(),
      cliAgentSessionRuntime: this.getCliAgentSessionRuntime(),
      logger: this.logger,
    });
  }

  private async buildStoppedSessionStatuses(
    sessionIds: readonly string[],
  ): Promise<Record<string, SocketEvents['session:status']>> {
    const now = Date.now();
    const entries = await Promise.all(sessionIds.map(async (sessionId) => {
      const currentStatus = await this.pipeline.getSessionStatusWithRun(sessionId).catch((error: unknown) => {
        this.logger.warn(
          `Unable to load session status ${sessionId} for stop snapshot: ${error instanceof Error ? error.message : String(error)}`,
        );
        return null;
      });
      const stoppedStatus: SocketEvents['session:status'] = {
        sessionId,
        active: false,
        queueLength: 0,
        ...(currentStatus?.turnId ? { turnId: currentStatus.turnId } : {}),
        ...(currentStatus?.run ? {
          run: {
            ...currentStatus.run,
            phase: 'interrupted',
            status: 'interrupted',
            safeResume: false,
            errorCode: currentStatus.run.errorCode ?? 'USER_STOPPED',
            errorMessage: currentStatus.run.errorMessage ?? 'Stopped by user.',
            updatedAt: now,
            lastHeartbeatAt: now,
            completedAt: now,
          },
        } : {}),
      };
      return [sessionId, stoppedStatus] as const;
    }));

    return Object.fromEntries(entries);
  }

  private emitRuntimeActivitySnapshotBatch(
    initiatorSocketId: string,
    snapshotBatch: Awaited<ReturnType<ChatGateway['buildRuntimeActivitySnapshots']>>,
  ): void {
    for (const sessionId of snapshotBatch.sessionIds) {
      this.emitToInitiatorAndSessionSubscribers(
        initiatorSocketId,
        sessionId,
        'session:runtime_snapshot',
        snapshotBatch.snapshotsBySessionId[sessionId],
      );
    }
  }

  private emitSessionLifecycleEvent<K extends 'session:created' | 'session:updated'>(
    event: K,
    payload: SocketEvents[K],
  ): void {
    this.sessionLifecycleBroadcastQueue = this.sessionLifecycleBroadcastQueue
      .catch((error: unknown) => this.logger.warn(`Session lifecycle queue recovered after previous failure: ${error instanceof Error ? error.message : String(error)}`))
      .then(() => emitSessionLifecycleEventToSubscribers({
        event,
        payload,
        clients: this.clients,
        sessionSubscribers: this.sessionSubscribers,
        sessionsService: this.sessionsService,
        logger: this.logger,
      }))
      .catch((error: unknown) => {
        this.logger.warn(
          `Failed to emit lifecycle event ${event} for session ${payload.id}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      });
  }

  @SubscribeMessage('agent:budget_approve')
  handleAgentBudgetApprove(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: SocketEvents['agent:budget_approve'],
  ): void {
    const socketSessions = this.socketSessions.get(client.id);
    if (!socketSessions?.has(payload.sessionId)) {
      this.logger.warn(`agent:budget_approve rejected — sessionId=${payload.sessionId} not owned by socket ${client.id}`);
      return;
    }
    const pending = this.agentBudgetApprovals
      .getPendingApprovals(payload.sessionId)
      .find((request) => request.requestId === payload.requestId);
    const isSynthetic = this.agentBudgetApprovals.isSyntheticPendingApproval(payload.requestId, payload.sessionId);
    const status = this.agentBudgetApprovals.resolveApproval(payload.requestId, payload.sessionId, payload.decision);
    if (status === 'not_found') {
      client.emit('agent:budget_invalidated', {
        requestId: payload.requestId,
        sessionId: payload.sessionId,
        reason: 'not_found',
      } satisfies SocketEvents['agent:budget_invalidated']);
      return;
    }
    if (status === 'resolved' && isSynthetic && pending) {
      client.emit('agent:budget_invalidated', {
        requestId: pending.requestId,
        sessionId: pending.sessionId,
        agentRun: pending.agentRun,
        reason: payload.decision === 'block' ? 'cancelled' : 'approved',
        decision: payload.decision,
        approvedLimit: nextApprovedBudgetLimit(pending.currentLimit, payload.decision) ?? undefined,
      } satisfies SocketEvents['agent:budget_invalidated']);
    }
  }

  private async stopAgentFlowRunsForSessions(sessionIds: string[]): Promise<void> {
    const agentFlowRuntime = this.getAgentFlowRuntime();
    if (!agentFlowRuntime?.stop) {
      return;
    }
    const sessionIdSet = new Set(sessionIds);
    const snapshots = await findAgentFlowSnapshotsForSessions(agentFlowRuntime, sessionIds);
    const activeSnapshots = snapshots.filter((snapshot) => (
      isActiveAgentFlowSnapshot(snapshot)
      && (
        sessionIdSet.has(snapshot.run.parentSessionId)
        || sessionIdSet.has(snapshot.run.childSessionId)
        || (snapshot.run.openChatSessionId !== undefined && sessionIdSet.has(snapshot.run.openChatSessionId))
      )
    ));
    const stoppedRunIds = new Set<string>();
    for (const snapshot of activeSnapshots) {
      if (stoppedRunIds.has(snapshot.run.id)) {
        continue;
      }
      stoppedRunIds.add(snapshot.run.id);
      try {
        await agentFlowRuntime.stop(snapshot.run.id);
      } catch (error) {
        this.logger.warn(`Failed to stop AgentFlow run ${snapshot.run.id}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  private async stopArchitectureRunsForSessions(sessionIds: string[]): Promise<void> {
    const architectureRuntime = this.getArchitectureRuntimeStopPort();
    if (!architectureRuntime) {
      return;
    }
    try {
      await architectureRuntime.stopRunsForSessions(sessionIds);
    } catch (error) {
      this.logger.warn(`Failed to stop Architecture runs: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private getArchitectureRuntimeStopPort(): ArchitectureRuntimeStopPort | undefined {
    if (this.architectureRuntimeStop) {
      return this.architectureRuntimeStop;
    }
    try {
      return this.moduleRef?.get<ArchitectureRuntimeStopPort>(ARCHITECTURE_RUNTIME_STOP, { strict: false });
    } catch {
      return undefined;
    }
  }

  private async stopCliAgentSessionIfNeeded(initiatorSocketId: string, sessionId: string): Promise<void> {
    const cliRuntime = this.getCliAgentSessionRuntime();
    if (!cliRuntime) {
      return;
    }

    try {
      const session = await this.sessionsService.get(sessionId);
      if (session.kind !== 'cli-agent' || !session.parentSessionId) {
        return;
      }

      const parentSessionId = session.parentSessionId;
      const emit: EmitFn = (event, data) => {
        const eventSessionId = getSocketEventSessionId(data);
        if (eventSessionId) {
          this.emitToInitiatorAndSessionSubscribers(initiatorSocketId, eventSessionId, event, data);
          return;
        }
        this.emitToInitiatorAndSessionSubscribers(initiatorSocketId, parentSessionId, event, data);
        if (sessionId !== parentSessionId) {
          this.emitToInitiatorAndSessionSubscribers(initiatorSocketId, sessionId, event, data);
        }
      };
      await cliRuntime.stopSession(parentSessionId, sessionId, emit);
    } catch (error) {
      this.logger.warn(
        `CLI agent stop failed for ${sessionId}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private getCliAgentSessionRuntime(): CLIAgentSessionRuntimePort | undefined {
    if (this.cliAgentSessionRuntime) {
      return this.cliAgentSessionRuntime;
    }
    try {
      return this.moduleRef?.get<CLIAgentSessionRuntimePort>(CLI_AGENT_SESSION_RUNTIME, { strict: false });
    } catch (error) {
      this.logger.warn(`CLI agent runtime lookup failed: ${error instanceof Error ? error.message : String(error)}`);
      return undefined;
    }
  }

  private getAgentFlowRuntime(): AgentFlowRuntimePort | undefined {
    if (this.agentFlowRuntime) {
      return this.agentFlowRuntime;
    }
    try {
      return this.moduleRef?.get<AgentFlowRuntimePort>(AGENT_FLOW_RUNTIME, { strict: false });
    } catch (error) {
      this.logger.warn(`AgentFlow runtime lookup failed: ${error instanceof Error ? error.message : String(error)}`);
      return undefined;
    }
  }

}

function nextApprovedBudgetLimit(
  currentLimit: number,
  decision: SocketEvents['agent:budget_approve']['decision'],
): number | null {
  switch (decision) {
    case 'allow_one':
      return currentLimit + 1;
    case 'allow_ten':
      return currentLimit + 10;
    case 'allow_unlimited':
      return 1000;
    case 'block':
    default:
      return null;
  }
}
