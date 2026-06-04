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
import type { AgentFlowRunSnapshot, SocketEvents } from '@kalio/types';
import { ToolDispatchService } from './tool-dispatch.service';
import { SessionPipelineService } from './session-pipeline.service';
import { SessionsService } from './sessions.service';
import type { EmitFn } from './interfaces/stream-context.interface';
import { WsExceptionFilter } from '../../common/filters/ws-exception.filter';
import { RAAppHITLService } from '../raapp/raapp-hitl.service';
import { AGENT_FLOW_RUNTIME, type AgentFlowRuntimePort } from '../agent-flow/agent-flow-runtime.port';

@UseFilters(WsExceptionFilter)
@WebSocketGateway({ cors: { origin: '*' } })
export class ChatGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(ChatGateway.name);

  // Track per-socket sessions for disconnect cleanup
  private readonly socketSessions = new Map<string, Set<string>>();
  private readonly clients = new Map<string, Socket>();
  private readonly sessionSubscribers = new Map<string, Set<string>>();

  constructor(
    private readonly toolDispatch: ToolDispatchService,
    private readonly pipeline: SessionPipelineService,
    private readonly raappHITL: RAAppHITLService,
    private readonly sessionsService: SessionsService,
    @Optional() @Inject(AGENT_FLOW_RUNTIME) private readonly agentFlowRuntime?: AgentFlowRuntimePort,
    @Optional() private readonly moduleRef?: ModuleRef,
  ) {}

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
    };

    replayPendingConfirmations(payload.sessionId);
    client.emit('session:status', await this.pipeline.getSessionStatusWithRun(payload.sessionId));

    const descendantSessionIds = await this.collectDescendantSessionIds(payload.sessionId);
    for (const sessionId of descendantSessionIds) {
      this.subscribeSocketToSession(client.id, sessionId);
      replayPendingConfirmations(sessionId);
      client.emit('session:status', await this.pipeline.getSessionStatusWithRun(sessionId));
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

    this.pipeline.stop(payload.sessionId);

    const descendantSessionIds = await this.collectDescendantSessionIds(payload.sessionId);
    descendantSessionIds.forEach((sessionId) => this.pipeline.stop(sessionId));
    await this.stopAgentFlowRunsForSessions([payload.sessionId, ...descendantSessionIds]);
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
    const status = this.toolDispatch.resolveConfirmation(payload.requestId, payload.sessionId);
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
    const status = this.toolDispatch.cancelConfirmation(payload.requestId, payload.sessionId);
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
    const targetSessionId = this.getEventSessionId(data) ?? fallbackSessionId;
    this.subscribeSocketToSession(initiatorSocketId, targetSessionId, { ownSession: false });

    const initiator = this.clients.get(initiatorSocketId);
    initiator?.emit(event, data);

    const subscribers = this.sessionSubscribers.get(targetSessionId);
    if (!subscribers) return;

    subscribers.forEach((socketId) => {
      if (socketId === initiatorSocketId) return;
      this.clients.get(socketId)?.emit(event, data);
    });
  }

  private getEventSessionId(payload: unknown): string | undefined {
    if (!payload || typeof payload !== 'object') return undefined;
    const candidate = payload as { sessionId?: unknown };
    return typeof candidate.sessionId === 'string' ? candidate.sessionId : undefined;
  }

  private async collectDescendantSessionIds(rootSessionId: string): Promise<string[]> {
    const descendantSessionIds: string[] = [];
    const pending = [rootSessionId];
    const seen = new Set<string>(pending);

    while (pending.length > 0) {
      const currentSessionId = pending.shift();
      if (!currentSessionId) break;

      const children = await this.sessionsService.listChildren(currentSessionId);
      children.forEach((child) => {
        if (seen.has(child.id)) return;
        seen.add(child.id);
        descendantSessionIds.push(child.id);
        pending.push(child.id);
      });
    }

    return descendantSessionIds;
  }

  private async stopAgentFlowRunsForSessions(sessionIds: string[]): Promise<void> {
    const agentFlowRuntime = this.getAgentFlowRuntime();
    if (!agentFlowRuntime?.stop) {
      return;
    }
    const sessionIdSet = new Set(sessionIds);
    const snapshots = await this.findAgentFlowSnapshotsForSessions(agentFlowRuntime, sessionIds);
    const activeSnapshots = snapshots.filter((snapshot) => (
      this.isActiveAgentFlowSnapshot(snapshot)
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

  private async findAgentFlowSnapshotsForSessions(agentFlowRuntime: AgentFlowRuntimePort, sessionIds: string[]): Promise<AgentFlowRunSnapshot[]> {
    if (agentFlowRuntime.findAll) {
      return agentFlowRuntime.findAll();
    }
    if (!agentFlowRuntime.findByParentSessionId) {
      return [];
    }
    const snapshots = await Promise.all(sessionIds.map((sessionId) => agentFlowRuntime.findByParentSessionId?.(sessionId) ?? Promise.resolve([])));
    return snapshots.flat();
  }

  private isActiveAgentFlowSnapshot(snapshot: AgentFlowRunSnapshot): boolean {
    return snapshot.run.status === 'running'
      || snapshot.run.status === 'queued'
      || snapshot.run.status === 'waiting_on_orchestrator';
  }
}
