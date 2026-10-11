import type { ToolConfirmationRequest } from '@kalio/types';
import type { StreamContext } from './interfaces/stream-context.interface';

export type ConfirmationWaitResult = { status: 'approved' | 'rejected' | 'timeout'; requestId: string; message?: string };
/** Live waiter source only; not approval, launch authority, or a recovery cursor. */
export interface ConfirmationWaitSource {
  readonly runId: string;
  readonly sessionId: string;
  readonly turnId: string;
  readonly promptMessageId: string;
  readonly assistantMessageId: string;
  readonly toolCallId: string;
  readonly toolName: string;
  readonly args: Readonly<Record<string, unknown>>;
  readonly pendingRequestRevision: number;
}
export interface PendingConfirmation {
  sessionId: string;
  payload: ToolConfirmationRequest;
  emit: StreamContext['emit'];
  resolve: () => void;
  reject: (message?: string) => void;
  revision?: number;
  hostConfirmationRequired?: boolean;
  readonly source?: ConfirmationWaitSource;
  readonly sourceAbortSignal?: AbortSignal;
}
