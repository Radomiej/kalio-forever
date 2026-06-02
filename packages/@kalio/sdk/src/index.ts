import { io, Socket } from 'socket.io-client';
import type {
  SocketEvents,
  LLMStreamChunk,
  ToolConfirmationInvalidated,
  ToolConfirmationRequest,
  ToolResult,
  ChatSession,
} from '@kalio/types';

export type ChunkHandler = (chunk: LLMStreamChunk) => void;
export type CompleteHandler = (payload: SocketEvents['chat:complete']) => void;
export type ErrorHandler = (payload: SocketEvents['chat:error']) => void;
export type ConfirmationHandler = (req: ToolConfirmationRequest) => void;
export type ConfirmationInvalidatedHandler = (payload: ToolConfirmationInvalidated) => void;
export type ToolStartHandler = (payload: SocketEvents['tool:start']) => void;
export type ToolResultHandler = (result: ToolResult) => void;
export type SessionCreatedHandler = (session: ChatSession) => void;
export type ContextHandler = (payload: SocketEvents['chat:context']) => void;
export type AgentStartHandler = (payload: SocketEvents['agent:start']) => void;
export type AgentDoneHandler = (payload: SocketEvents['agent:done']) => void;
export type RaAppNativeResultHandler = (payload: SocketEvents['raapp:native_result']) => void;
export type CLIAgentProgressHandler = (payload: SocketEvents['cli_agent:progress']) => void;
export type ToolArgProgressHandler = (payload: SocketEvents['tool:arg_progress']) => void;
export type SessionStatusHandler = (payload: SocketEvents['session:status']) => void;
export type ReconnectHandler = () => void;
export type DisconnectHandler = (reason: string) => void;
export type ConnectionState = 'connecting' | 'connected' | 'reconnecting' | 'disconnected';
export type ConnectionStateHandler = (state: { status: ConnectionState; recovered?: boolean; reason?: string }) => void;

export interface KalioSDKOptions {
  wsUrl: string;
}

export class KalioSDK {
  private socket: Socket;
  private thinkingAccum = '';
  private inThinking = false;
  private toolCallCount = 0;

  constructor(options: KalioSDKOptions) {
    this.socket = io(options.wsUrl, {
      transports: ['websocket'],
      autoConnect: false,
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 500,
      reconnectionDelayMax: 5_000,
      timeout: 10_000,
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

  sendMessage(payload: SocketEvents['chat:send']): boolean {
    if (!this.socket.connected) {
      return false;
    }
    this.toolCallCount = 0; // Reset counter for new message
    this.thinkingAccum = '';
    this.inThinking = false;
    console.groupCollapsed(`[Thread] ▶ SEND sessionId=${payload.sessionId}`);
    console.log('content:', payload.content.slice(0, 80) + (payload.content.length > 80 ? '...' : ''));
    console.log('personaId:', payload.personaId);
    console.groupEnd();
    this.socket.emit('chat:send', payload);
    return true;
  }

  stopTurn(sessionId: string): boolean {
    if (!this.socket.connected) {
      return false;
    }
    console.log(`[Thread] ⏹ STOP sessionId=${sessionId}`);
    this.socket.emit('chat:stop', { sessionId });
    return true;
  }

  confirmTool(payload: SocketEvents['tool:confirm']): void {
    this.socket.emit('tool:confirm', payload);
  }

  cancelTool(payload: SocketEvents['tool:cancel']): void {
    this.socket.emit('tool:cancel', payload);
  }

  approveRaApp(payload: SocketEvents['raapp:approve']): void {
    this.socket.emit('raapp:approve', payload);
  }

  cancelRaApp(payload: SocketEvents['raapp:cancel']): void {
    this.socket.emit('raapp:cancel', payload);
  }

  onRaAppNativeResult(handler: RaAppNativeResultHandler): () => void {
    const wrappedHandler = (payload: SocketEvents['raapp:native_result']) => {
      console.groupCollapsed(`[Thread] 🔄 RAAPP NATIVE RESULT toolCallId=${payload.toolCallId}`);
      console.log('results:', payload.results);
      console.groupEnd();
      handler(payload);
    };
    this.socket.on('raapp:native_result', wrappedHandler);
    return () => this.socket.off('raapp:native_result', wrappedHandler);
  }

  onChunk(handler: ChunkHandler): () => void {
    const wrappedHandler = (chunk: LLMStreamChunk) => {
      // Log thinking blocks separately
      const delta = chunk.delta ?? '';
      if (delta.includes('<think>')) this.inThinking = true;
      if (this.inThinking) {
        this.thinkingAccum += delta;
        if (delta.includes('</think>')) {
          const thinkMatch = this.thinkingAccum.match(/<think>([\s\S]*?)<\/think>/);
          console.groupCollapsed('[Thread] 🧠 THINKING');
          console.log(thinkMatch ? thinkMatch[1] : this.thinkingAccum);
          console.groupEnd();
          this.thinkingAccum = '';
          this.inThinking = false;
        }
      }
      handler(chunk);
    };
    this.socket.on('chat:chunk', wrappedHandler);
    return () => this.socket.off('chat:chunk', wrappedHandler);
  }

  onComplete(handler: CompleteHandler): () => void {
    const wrappedHandler = (payload: SocketEvents['chat:complete']) => {
      console.groupCollapsed(`[Thread] ✅ COMPLETE sessionId=${payload.sessionId} messageId=${payload.messageId}`);
      console.groupEnd();
      handler(payload);
    };
    this.socket.on('chat:complete', wrappedHandler);
    return () => this.socket.off('chat:complete', wrappedHandler);
  }

  onError(handler: ErrorHandler): () => void {
    const wrappedHandler = (payload: SocketEvents['chat:error']) => {
      console.error('[Thread] ❌ ERROR:', payload);
      handler(payload);
    };
    this.socket.on('chat:error', wrappedHandler);
    return () => this.socket.off('chat:error', wrappedHandler);
  }

  onToolConfirmation(handler: ConfirmationHandler): () => void {
    const wrappedHandler = (req: ToolConfirmationRequest) => {
      console.groupCollapsed(`[Thread] ⚠️ CONFIRMATION REQUIRED: ${req.toolName}`);
      console.log('callId:', req.toolCallId);
      console.log('args:', req.args);
      console.log('timeout:', req.timeoutMs, 'ms');
      console.groupEnd();
      handler(req);
    };
    this.socket.on('tool:confirmation_required', wrappedHandler);
    return () => this.socket.off('tool:confirmation_required', wrappedHandler);
  }

  onToolConfirmationInvalidated(handler: ConfirmationInvalidatedHandler): () => void {
    const wrappedHandler = (payload: SocketEvents['tool:confirmation_invalidated']) => {
      console.groupCollapsed(`[Thread] ℹ️ CONFIRMATION INVALIDATED: ${payload.requestId} → ${payload.reason}`);
      if (payload.message) {
        console.log('message:', payload.message);
      }
      console.groupEnd();
      handler(payload);
    };
    this.socket.on('tool:confirmation_invalidated', wrappedHandler);
    return () => this.socket.off('tool:confirmation_invalidated', wrappedHandler);
  }

  onToolStart(handler: ToolStartHandler): () => void {
    const wrappedHandler = (payload: SocketEvents['tool:start']) => {
      this.toolCallCount++;
      console.groupCollapsed(`[Thread] 🔧 TOOL CALL #${this.toolCallCount}: ${payload.toolName}`);
      console.log('callId:', payload.callId);
      console.log('args:', payload.args);
      console.groupEnd();
      handler(payload);
    };
    this.socket.on('tool:start', wrappedHandler);
    return () => this.socket.off('tool:start', wrappedHandler);
  }

  onToolResult(handler: ToolResultHandler): () => void {
    const wrappedHandler = (result: ToolResult) => {
      const isError = result.status !== 'success';
      const logFn = isError ? console.error : console.groupCollapsed;
      logFn(`[Thread] ${isError ? '❌' : '✅'} TOOL RESULT: ${result.callId} → ${result.status}`);
      if (result.data !== undefined) {
        console.log('output:', result.data);
      }
      if (isError) {
        console.log('errorCode:', result.errorCode);
        console.log('errorMessage:', result.errorMessage);
      } else {
        console.groupEnd();
      }
      handler(result);
    };
    this.socket.on('tool:result', wrappedHandler);
    return () => this.socket.off('tool:result', wrappedHandler);
  }

  onSessionCreated(handler: SessionCreatedHandler): () => void {
    const wrappedHandler = (session: ChatSession) => {
      console.log('[Thread] 📝 SESSION CREATED:', session.id, session.title);
      handler(session);
    };
    this.socket.on('session:created', wrappedHandler);
    return () => this.socket.off('session:created', wrappedHandler);
  }

  onContext(handler: ContextHandler): () => void {
    const wrappedHandler = (payload: SocketEvents['chat:context']) => {
      console.groupCollapsed('[Thread] 🎯 CONTEXT');
      console.log('systemPrompt:', payload.systemPrompt.slice(0, 100) + '...');
      console.log('toolNames:', payload.toolNames);
      console.groupEnd();
      handler(payload);
    };
    this.socket.on('chat:context', wrappedHandler);
    return () => this.socket.off('chat:context', wrappedHandler);
  }

  onAgentStart(handler: AgentStartHandler): () => void {
    const wrappedHandler = (payload: SocketEvents['agent:start']) => {
      console.groupCollapsed(`[Thread] ▶️ AGENT START sessionId=${payload.sessionId} turnId=${payload.turnId}`);
      console.groupEnd();
      handler(payload);
    };
    this.socket.on('agent:start', wrappedHandler);
    return () => this.socket.off('agent:start', wrappedHandler);
  }

  onAgentDone(handler: AgentDoneHandler): () => void {
    const wrappedHandler = (payload: SocketEvents['agent:done']) => {
      console.groupCollapsed(`[Thread] ✅ AGENT DONE sessionId=${payload.sessionId} turnId=${payload.turnId}`);
      console.groupEnd();
      handler(payload);
    };
    this.socket.on('agent:done', wrappedHandler);
    return () => this.socket.off('agent:done', wrappedHandler);
  }

  onCLIAgentProgress(handler: CLIAgentProgressHandler): () => void {
    const wrappedHandler = (payload: SocketEvents['cli_agent:progress']) => {
      handler(payload);
    };
    this.socket.on('cli_agent:progress', wrappedHandler);
    return () => this.socket.off('cli_agent:progress', wrappedHandler);
  }

  onToolArgProgress(handler: ToolArgProgressHandler): () => void {
    const wrappedHandler = (payload: SocketEvents['tool:arg_progress']) => {
      handler(payload);
    };
    this.socket.on('tool:arg_progress', wrappedHandler);
    return () => this.socket.off('tool:arg_progress', wrappedHandler);
  }

  onSessionStatus(handler: SessionStatusHandler): () => void {
    const wrappedHandler = (payload: SocketEvents['session:status']) => {
      handler(payload);
    };
    this.socket.on('session:status', wrappedHandler);
    return () => this.socket.off('session:status', wrappedHandler);
  }

  /**
   * Fires when the socket connects to a NEW server session (recovered === false).
   * Skipped when Socket.IO connection state recovery successfully replays events.
   */
  onReconnect(handler: ReconnectHandler): () => void {
    const wrappedHandler = () => {
      if (this.socket.recovered) return;
      handler();
    };
    this.socket.on('connect', wrappedHandler);
    return () => this.socket.off('connect', wrappedHandler);
  }

  /** Fires on every socket disconnection. */
  onDisconnect(handler: DisconnectHandler): () => void {
    const wrappedHandler = (reason: string) => handler(reason);
    this.socket.on('disconnect', wrappedHandler);
    return () => this.socket.off('disconnect', wrappedHandler);
  }

  onConnectionState(handler: ConnectionStateHandler): () => void {
    const onConnect = () => handler({ status: 'connected', recovered: this.socket.recovered });
    const onDisconnect = (reason: string) => handler({ status: 'disconnected', reason });
    const onReconnectAttempt = () => handler({ status: 'reconnecting' });
    const onConnectError = (err: Error) => handler({ status: 'reconnecting', reason: err.message });

    this.socket.on('connect', onConnect);
    this.socket.on('disconnect', onDisconnect);
    this.socket.io.on('reconnect_attempt', onReconnectAttempt);
    this.socket.on('connect_error', onConnectError);

    return () => {
      this.socket.off('connect', onConnect);
      this.socket.off('disconnect', onDisconnect);
      this.socket.io.off('reconnect_attempt', onReconnectAttempt);
      this.socket.off('connect_error', onConnectError);
    };
  }

  /** Re-register session ownership with the server after a reconnect. */
  identifySession(sessionId: string): void {
    this.socket.emit('session:identify', { sessionId });
  }
}
