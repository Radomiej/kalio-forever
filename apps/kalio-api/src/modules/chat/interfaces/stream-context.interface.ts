import type { AgentRunContext, SessionRuntimeKind, SocketEvents, ToolResult, HostResolvedToolDispatch, HostHitlExecutionCommit } from '@kalio/types';
import type { TurnState } from '../turn-state';

/**
 * Strongly typed emitter function.
 * Wraps a Socket.IO client.emit so handlers are decoupled from socket.io.
 */
export type EmitFn = <K extends keyof SocketEvents>(event: K, data: SocketEvents[K]) => void;

/**
 * Per-turn execution context passed to every chunk handler and middleware.
 * All fields are readonly — context is created once per turn.
 */
export interface StreamContext {
  readonly sessionId: string;
  readonly runId?: string;
  readonly turnId?: string;
  readonly promptMessageId?: string;
  readonly vfsSessionId?: string;
  readonly historySessionId?: string;
  readonly runtimeKind?: Extract<SessionRuntimeKind, 'chat' | 'subagent' | 'agent-flow-branch'>;
  readonly iteration?: number;
  readonly currentLimit?: number;
  readonly markWaitingForHuman?: () => Promise<void>;
  readonly markToolRunning?: () => Promise<void>;
  readonly registerToolResultCommit?: (commit: (result: ToolResult) => Promise<void>) => void;
  /** Host-only capabilities. Never copied into ToolCallRequest or serialized. */
  readonly onResolvedToolDispatch?: (receipt: HostResolvedToolDispatch) => Promise<void>;
  /** Synchronous host capture immediately before the resolved executor call.
   * Resolution alone never proves entry. Never forwarded into ToolCallRequest. */
  readonly onToolExecutorEntered?: () => void;
  readonly registerToolResultReceiptCommit?: (commit: (result: ToolResult) => Promise<HostHitlExecutionCommit>) => void;
  readonly hostConfirmationRequirement?: Readonly<{ kind: 'human_only'; toolName: 'terminal_spawn'; callId: string }>;
  readonly messageId: string;
  readonly abortSignal: AbortSignal;
  readonly state: TurnState;
  readonly emit: EmitFn;
  readonly agentRun?: AgentRunContext;
  readonly rawXmlToolNames?: readonly string[];
}
