import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  WsException,
} from '@nestjs/websockets';
import { Logger, UseFilters } from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import type { SocketEvents } from '@kalio/types';
import { ChatService } from './chat.service';
import { MCPService } from '../mcp/mcp.service';
import { ForeverAgentService } from '../agentloop/forever-agent.service';
import { WsExceptionFilter } from '../../common/filters/ws-exception.filter';

type ChatSendPayload = SocketEvents['chat:send'];

@WebSocketGateway({ cors: { origin: '*' } })
@UseFilters(WsExceptionFilter)
export class ChatGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer() server!: Server;
  private readonly logger = new Logger(ChatGateway.name);

  constructor(
    private readonly chatService: ChatService,
    private readonly mcpService: MCPService,
    private readonly foreverAgent: ForeverAgentService,
  ) {}

  afterInit(): void {
    const gw = { emitToAll: (event: string, data: unknown) => this.server.emit(event, data) };
    this.mcpService.setGateway(gw);
    this.foreverAgent.setGateway(gw);
  }

  /** Called by external services to broadcast to all connected clients */
  emitToAll(event: string, data: unknown): void {
    this.server.emit(event, data);
  }

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

  @SubscribeMessage('agentLoop:start')
  handleLoopStart(@MessageBody() payload: SocketEvents['agentLoop:start']): void {
    this.foreverAgent.startLoop(payload.loopId);
  }

  @SubscribeMessage('agentLoop:pause')
  handleLoopPause(@MessageBody() payload: SocketEvents['agentLoop:pause']): void {
    this.foreverAgent.pauseLoop(payload.loopId);
  }

  @SubscribeMessage('agentLoop:stop')
  handleLoopStop(@MessageBody() payload: SocketEvents['agentLoop:stop']): void {
    this.foreverAgent.stopLoop(payload.loopId);
  }
}
