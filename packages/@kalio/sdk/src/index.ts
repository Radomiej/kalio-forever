import { io, Socket } from 'socket.io-client';
import type {
  SocketEvents,
  LLMStreamChunk,
  ToolConfirmationRequest,
  ToolResult,
  ChatSession,
} from '@kalio/types';

export type ChunkHandler = (chunk: LLMStreamChunk) => void;
export type CompleteHandler = (payload: SocketEvents['chat:complete']) => void;
export type ErrorHandler = (payload: SocketEvents['chat:error']) => void;
export type ConfirmationHandler = (req: ToolConfirmationRequest) => void;
export type ToolStartHandler = (payload: SocketEvents['tool:start']) => void;
export type ToolResultHandler = (result: ToolResult) => void;
export type SessionCreatedHandler = (session: ChatSession) => void;

export interface KalioSDKOptions {
  wsUrl: string;
}

export class KalioSDK {
  private socket: Socket;

  constructor(options: KalioSDKOptions) {
    this.socket = io(options.wsUrl, {
      transports: ['websocket'],
      autoConnect: false,
    });
  }

  connect(): void {
    this.socket.connect();
  }

  disconnect(): void {
    this.socket.disconnect();
  }

  get connected(): boolean {
    return this.socket.connected;
  }

  sendMessage(payload: SocketEvents['chat:send']): void {
    this.socket.emit('chat:send', payload);
  }

  confirmTool(payload: SocketEvents['tool:confirm']): void {
    this.socket.emit('tool:confirm', payload);
  }

  cancelTool(payload: SocketEvents['tool:cancel']): void {
    this.socket.emit('tool:cancel', payload);
  }

  onChunk(handler: ChunkHandler): () => void {
    this.socket.on('chat:chunk', handler);
    return () => this.socket.off('chat:chunk', handler);
  }

  onComplete(handler: CompleteHandler): () => void {
    this.socket.on('chat:complete', handler);
    return () => this.socket.off('chat:complete', handler);
  }

  onError(handler: ErrorHandler): () => void {
    this.socket.on('chat:error', handler);
    return () => this.socket.off('chat:error', handler);
  }

  onToolConfirmation(handler: ConfirmationHandler): () => void {
    this.socket.on('tool:confirmation_required', handler);
    return () => this.socket.off('tool:confirmation_required', handler);
  }

  onToolStart(handler: ToolStartHandler): () => void {
    this.socket.on('tool:start', handler);
    return () => this.socket.off('tool:start', handler);
  }

  onToolResult(handler: ToolResultHandler): () => void {
    this.socket.on('tool:result', handler);
    return () => this.socket.off('tool:result', handler);
  }

  onSessionCreated(handler: SessionCreatedHandler): () => void {
    this.socket.on('session:created', handler);
    return () => this.socket.off('session:created', handler);
  }
}
