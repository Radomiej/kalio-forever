import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
  OnGatewayConnection,
  OnGatewayDisconnect,
  WsException,
} from '@nestjs/websockets';
import { Logger, UseFilters } from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import type { SocketEvents } from '@kalio/types';
import { ChatService } from './chat.service';
import { WsExceptionFilter } from '../../common/filters/ws-exception.filter';

type ChatSendPayload = SocketEvents['chat:send'];

@WebSocketGateway({ cors: { origin: '*' } })
@UseFilters(WsExceptionFilter)
export class ChatGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer() server!: Server;
  private readonly logger = new Logger(ChatGateway.name);

  constructor(private readonly chatService: ChatService) {}

  handleConnection(client: Socket): void {
    this.logger.log(`Client connected: ${client.id}`);
  }

  handleDisconnect(client: Socket): void {
    this.logger.log(`Client disconnected: ${client.id}`);
  }

  @SubscribeMessage('chat:send')
  async handleChatSend(
    @MessageBody() payload: ChatSendPayload,
    @ConnectedSocket() client: Socket,
  ): Promise<void> {
    if (!payload.sessionId || !payload.content || !payload.personaId) {
      throw new WsException('Missing required fields: sessionId, content, personaId');
    }

    await this.chatService.handleMessage(payload, this.server, client);
  }

  @SubscribeMessage('tool:confirm')
  async handleToolConfirm(
    @MessageBody() payload: SocketEvents['tool:confirm'],
  ): Promise<void> {
    await this.chatService.resolveConfirmation(payload.requestId, 'confirmed');
  }

  @SubscribeMessage('tool:cancel')
  async handleToolCancel(
    @MessageBody() payload: SocketEvents['tool:cancel'],
  ): Promise<void> {
    await this.chatService.resolveConfirmation(payload.requestId, 'cancelled');
  }
}
