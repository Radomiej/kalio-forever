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

@UseFilters(WsExceptionFilter)
@WebSocketGateway({ cors: { origin: '*' } })
export class ChatGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(ChatGateway.name);

  // Track per-socket sessions for disconnect cleanup
  private readonly socketSessions = new Map<string, Set<string>>();

  constructor(
    private readonly toolDispatch: ToolDispatchService,
    private readonly pipeline: SessionPipelineService,
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
}
