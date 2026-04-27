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
import { ChatService } from './chat.service';
import { ToolDispatchService } from './tool-dispatch.service';
import type { EmitFn } from './interfaces/stream-context.interface';
import { WsExceptionFilter } from '../../common/filters/ws-exception.filter';

@UseFilters(WsExceptionFilter)
@WebSocketGateway({ cors: { origin: '*' } })
export class ChatGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(ChatGateway.name);

  constructor(
    private readonly chatService: ChatService,
    private readonly toolDispatch: ToolDispatchService,
  ) {}

  handleConnection(client: Socket): void {
    this.logger.log(`Client connected: ${client.id}`);
  }

  handleDisconnect(client: Socket): void {
    this.logger.log(`Client disconnected: ${client.id}`);
  }

  @SubscribeMessage('chat:send')
  async handleChatSend(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: SocketEvents['chat:send'],
  ): Promise<void> {
    const emit: EmitFn = (event, data) => {
      client.emit(event, data);
    };

    await this.chatService.handleTurn(
      payload.sessionId,
      payload.content,
      payload.personaId,
      emit,
    );
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
