import {
  WebSocketGateway,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Logger, UseFilters } from '@nestjs/common';
import type { Socket } from 'socket.io';
import type { SocketEvents } from '@kalio/types';
import { ToolDispatchService } from './tool-dispatch.service';
import { SessionPipelineService } from './session-pipeline.service';
import type { EmitFn } from './interfaces/stream-context.interface';
import { WsExceptionFilter } from '../../common/filters/ws-exception.filter';
import { RAAppHITLService } from '../raapp/raapp-hitl.service';

@UseFilters(WsExceptionFilter)
@WebSocketGateway({ cors: { origin: '*' } })
export class ChatGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(ChatGateway.name);

  // Track per-socket sessions for disconnect cleanup
  private readonly socketSessions = new Map<string, Set<string>>();

  constructor(
    private readonly toolDispatch: ToolDispatchService,
    private readonly pipeline: SessionPipelineService,
    private readonly raappHITL: RAAppHITLService,
  ) {}

  handleConnection(client: Socket): void {
    this.logger.log(`Client connected: ${client.id}`);
    this.socketSessions.set(client.id, new Set());
  }

  handleDisconnect(client: Socket): void {
    this.logger.log(`Client disconnected: ${client.id}`);
    const sessions = this.socketSessions.get(client.id);
    if (sessions) {
      // Abort any in-flight turns and drop queued items so they don't try
      // to emit to a dead socket.
      sessions.forEach((sid) => this.pipeline.abortAll(sid));
      this.socketSessions.delete(client.id);
    }
  }

  @SubscribeMessage('chat:send')
  async handleChatSend(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: SocketEvents['chat:send'],
  ): Promise<void> {
    const emit: EmitFn = (event, data) => {
      client.emit(event, data);
    };
    this.socketSessions.get(client.id)?.add(payload.sessionId);
    await this.pipeline.submit(payload, emit);
  }

  @SubscribeMessage('tool:confirm')
  handleToolConfirm(@MessageBody() payload: SocketEvents['tool:confirm']): void {
    this.toolDispatch.resolveConfirmation(payload.requestId);
  }

  @SubscribeMessage('tool:cancel')
  handleToolCancel(@MessageBody() payload: SocketEvents['tool:cancel']): void {
    this.toolDispatch.cancelConfirmation(payload.requestId);
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
      const cancelled = await this.raappHITL.cancelApprovals(payload.requestIds, payload.sessionId);
      client.emit('raapp:native_result', {
        toolCallId: cancelled.toolCallId,
        sessionId: payload.sessionId,
        results: payload.requestIds.map((id) => ({
          id,
          system: 'unknown',
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
}
