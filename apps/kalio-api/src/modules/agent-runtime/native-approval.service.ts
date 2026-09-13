import { Injectable } from '@nestjs/common';
import { nanoid } from 'nanoid';
import type { ToolConfirmationInvalidated, ToolConfirmationRequest } from '@kalio/types';

export type NativeApprovalDecision = 'accept' | 'decline' | 'cancel';
type NativeApprovalEvent = 'tool:confirmation_required' | 'tool:confirmation_invalidated';
type NativeApprovalEmit = (
  event: NativeApprovalEvent,
  data: ToolConfirmationRequest | ToolConfirmationInvalidated,
) => void;

interface PersistedNativeApproval {
  create(input: {
    id: string;
    sessionId: string;
    turnId?: string;
    runId?: string;
    toolCallId: string;
    payload: Record<string, unknown>;
  }): Promise<number | undefined>;
  resolve(id: string, revision: number, status: 'approved' | 'cancelled', outcome?: Record<string, unknown>): Promise<boolean>;
}

export interface NativeApprovalRequestInput {
  sessionId: string;
  turnId?: string;
  runId?: string;
  method: string;
  params: Record<string, unknown>;
  emit: NativeApprovalEmit;
  abortSignal?: AbortSignal;
  persistence?: PersistedNativeApproval;
  onAudit?: (event: {
    eventName: string;
    status: 'waiting_for_human' | 'completed' | 'cancelled';
    requestId: string;
    method: string;
  }) => Promise<void> | void;
}

interface PendingNativeApproval {
  request: ToolConfirmationRequest;
  sessionId: string;
  emit: NativeApprovalEmit;
  resolve: (decision: NativeApprovalDecision) => void;
  persistence?: PersistedNativeApproval;
  revision?: number;
  abortSignal?: AbortSignal;
  abortHandler: () => void;
}

/** Bridges Codex native approval requests into Kalio's existing HITL surface. */
@Injectable()
export class NativeApprovalService {
  private readonly pending = new Map<string, PendingNativeApproval>();

  async request(input: NativeApprovalRequestInput): Promise<NativeApprovalDecision> {
    const requestId = nanoid();
    const toolCallId = `codex-native:${requestId}`;
    const request: ToolConfirmationRequest = {
      requestId,
      toolCallId,
      sessionId: input.sessionId,
      ...(input.turnId ? { turnId: input.turnId } : {}),
      toolName: `codex_native:${input.method}`,
      args: {
        method: input.method,
        params: input.params,
      },
      timeoutMs: 0,
    };

    const revision = await input.persistence?.create({
      id: requestId,
      sessionId: input.sessionId,
      turnId: input.turnId,
      runId: input.runId,
      toolCallId,
      payload: {
        toolName: request.toolName,
        args: request.args,
        nativeApproval: true,
        nativeMethod: input.method,
      },
    });

    let resolve!: (decision: NativeApprovalDecision) => void;
    const promise = new Promise<NativeApprovalDecision>((resolvePromise) => {
      resolve = resolvePromise;
    });
    const abortHandler = (): void => {
      void this.resolve(requestId, input.sessionId, 'cancel', 'Native approval aborted with the turn.');
    };
    const pending: PendingNativeApproval = {
      request,
      sessionId: input.sessionId,
      emit: input.emit,
      resolve,
      persistence: input.persistence,
      revision,
      abortSignal: input.abortSignal,
      abortHandler,
    };
    this.pending.set(requestId, pending);
    input.abortSignal?.addEventListener('abort', abortHandler, { once: true });
    await input.onAudit?.({
      eventName: 'codex.native_approval.requested',
      status: 'waiting_for_human',
      requestId,
      method: input.method,
    });
    input.emit('tool:confirmation_required', request);
    return promise;
  }

  async resolve(
    requestId: string,
    sessionId: string,
    decision: NativeApprovalDecision,
    message?: string,
  ): Promise<boolean> {
    const pending = this.pending.get(requestId);
    if (!pending || pending.sessionId !== sessionId) return false;

    if (pending.persistence && pending.revision !== undefined) {
      const persisted = await pending.persistence.resolve(
        requestId,
        pending.revision,
        decision === 'accept' ? 'approved' : 'cancelled',
        message ? { message } : undefined,
      );
      if (!persisted) return false;
    }

    this.pending.delete(requestId);
    pending.abortSignal?.removeEventListener('abort', pending.abortHandler);
    pending.emit('tool:confirmation_invalidated', {
      requestId,
      toolCallId: pending.request.toolCallId,
      sessionId,
      reason: decision === 'accept' ? 'confirmed' : 'cancelled',
      ...(message ? { message } : {}),
    });
    pending.resolve(decision);
    return true;
  }

  getPending(sessionId: string): ToolConfirmationRequest[] {
    return [...this.pending.values()]
      .filter((pending) => pending.sessionId === sessionId)
      .map((pending) => pending.request);
  }

}
