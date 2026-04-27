import type { SocketEvents } from '@kalio/types';
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
  readonly messageId: string;
  readonly abortSignal: AbortSignal;
  readonly state: TurnState;
  readonly emit: EmitFn;
}
