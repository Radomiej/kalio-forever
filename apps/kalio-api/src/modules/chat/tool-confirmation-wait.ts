import type { Logger } from '@nestjs/common';
import { nanoid } from 'nanoid';
import { types } from 'node:util';
import type { ToolConfirmationInvalidated, ToolConfirmationRequest } from '@kalio/types';
import type { StreamContext } from './interfaces/stream-context.interface';
import type { HitlNotificationService } from '../hitl/hitl-notification.service';
import type { RuntimeAuditLogger } from './runtime-audit-logger.service';
import { persistToolConfirmation } from './tool-confirmation.persistence';
import type { ConfirmationWaitResult, ConfirmationWaitSource, PendingConfirmation } from './tool-confirmation-pending';
import { canonicalGoalLaunchJson } from '../../common/goal-launch-canonical';
import { detachHostReceiptArgs } from '../../common/host-receipt-json';

const HITL_TIMEOUT_MS = 0;

function ownValue(value: unknown, key: string): unknown {
  if (!value || typeof value !== 'object' || types.isProxy(value)) return undefined;
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return descriptor && 'value' in descriptor ? descriptor.value : undefined;
}

type OriginalSource = Omit<ConfirmationWaitSource, 'pendingRequestRevision'>;

function captureOriginalSource(callId: string, toolName: string, args: Record<string, unknown>, ctx: StreamContext) {
  if (toolName !== 'run_sub_agentflow') return undefined;
  try {
    const runId = ownValue(ctx, 'runId'); const sessionId = ownValue(ctx, 'sessionId');
    const turnId = ownValue(ctx, 'turnId'); const promptMessageId = ownValue(ctx, 'promptMessageId');
    const assistantMessageId = ownValue(ctx, 'messageId'); const signal = ownValue(ctx, 'abortSignal');
    if (typeof runId !== 'string' || !runId.trim() || typeof sessionId !== 'string' || !sessionId.trim()
      || typeof turnId !== 'string' || !turnId.trim() || typeof promptMessageId !== 'string' || !promptMessageId.trim()
      || typeof assistantMessageId !== 'string' || !assistantMessageId.trim() || !callId.trim()
      || !signal || typeof signal !== 'object' || types.isProxy(signal) || !(signal instanceof AbortSignal)) return undefined;
    const argsJson = canonicalGoalLaunchJson(args);
    const source: OriginalSource = Object.freeze({ runId, sessionId, turnId, promptMessageId,
      assistantMessageId, toolCallId: callId, toolName,
      args: detachHostReceiptArgs(JSON.parse(argsJson) as Record<string, unknown>) });
    canonicalGoalLaunchJson(source);
    return { source, signal };
  } catch {
    // Invalid metadata is ineligible for future reconciliation, not a new legacy wait failure.
    return undefined;
  }
}

function bindPersistedSource(original: ReturnType<typeof captureOriginalSource>, row: unknown, requestId: string) {
  if (!original) return undefined;
  try {
    const { source } = original; const revision = ownValue(row, 'revision');
    const payload = ownValue(row, 'payload'); const continuation = ownValue(row, 'continuation');
    if (ownValue(row, 'id') !== requestId || ownValue(row, 'kind') !== 'tool_confirmation'
      || ownValue(row, 'status') !== 'pending' || typeof revision !== 'number' || !Number.isSafeInteger(revision) || revision < 1
      || ownValue(row, 'runId') !== source.runId || ownValue(row, 'sessionId') !== source.sessionId
      || ownValue(row, 'turnId') !== source.turnId || ownValue(row, 'toolCallId') !== source.toolCallId
      || ownValue(payload, 'toolName') !== source.toolName
      || canonicalGoalLaunchJson(ownValue(payload, 'args')) !== canonicalGoalLaunchJson(source.args)
      || ownValue(continuation, 'runId') !== source.runId || ownValue(continuation, 'sessionId') !== source.sessionId
      || ownValue(continuation, 'turnId') !== source.turnId || ownValue(continuation, 'promptMessageId') !== source.promptMessageId
      || ownValue(continuation, 'messageId') !== source.assistantMessageId) return undefined;
    return { source: Object.freeze({ ...source, pendingRequestRevision: revision }), signal: original.signal };
  } catch {
    // A corrupt/mismatched readback cannot bind a live source; existing wait semantics remain unchanged.
    return undefined;
  }
}

export interface ToolConfirmationWaitInput {
  callId: string;
  toolName: string;
  args: Record<string, unknown>;
  ctx: StreamContext;
  pending: Map<string, PendingConfirmation>;
  hitlRequests: Parameters<typeof persistToolConfirmation>[0];
  hitlNotifications: Pick<HitlNotificationService, 'notifyApprovalRequested'> | null;
  runtimeAudit: Pick<RuntimeAuditLogger, 'log'> | null;
  logger: Pick<Logger, 'warn' | 'error'>;
  emitConfirmationInvalidated: (pending: PendingConfirmation, reason: ToolConfirmationInvalidated['reason'], message?: string) => void;
  logConfirmationLifecycle: (pending: PendingConfirmation, eventType: Parameters<HitlNotificationService['logApprovalLifecycle']>[0]['eventType'], source: string, reason?: string) => void;
  logRuntimeConfirmation: (pending: PendingConfirmation, eventName: string, status: 'completed' | 'failed' | 'cancelled', reason?: string) => Promise<string> | undefined;
  onGoalWaitRegistered?: (requestId: string) => Promise<unknown>;
}

export async function awaitToolConfirmation(input: ToolConfirmationWaitInput): Promise<ConfirmationWaitResult> {
  const { callId, toolName, args, ctx } = input;
    const originalSource = captureOriginalSource(callId, toolName, args, ctx);
    const requestId = nanoid();
    const timeoutMs = ctx.agentRun?.agentType === 'subagent' ? 0 : HITL_TIMEOUT_MS;

    const payload: ToolConfirmationRequest = {
      requestId,
      toolCallId: callId,
      sessionId: ctx.sessionId,
      turnId: ctx.turnId,
      promptMessageId: ctx.promptMessageId,
      toolName,
      args,
      timeoutMs,
      agentRun: ctx.agentRun,
    };

    const persisted = input.hitlRequests || Object.hasOwn(ctx, 'hostConfirmationRequirement')
      ? await persistToolConfirmation(input.hitlRequests, payload, ctx) : undefined;
    const boundSource = bindPersistedSource(originalSource, persisted, requestId);

    if (ctx.markWaitingForHuman) {
      await ctx.markWaitingForHuman();
    }

    ctx.emit('tool:confirmation_required', payload);
    void input.hitlNotifications?.notifyApprovalRequested({
      requestId,
      timeoutMs,
      request: {
        kind: 'tool',
        sessionId: ctx.sessionId,
        name: toolName,
        args,
        abortSignal: ctx.abortSignal,
        agentRun: ctx.agentRun,
        toolCallId: callId,
      },
    });
    void input.runtimeAudit?.log({
      eventName: 'tool.confirmation.requested',
      sessionId: ctx.sessionId,
      turnId: ctx.turnId,
      status: 'waiting_for_human',
      data: {
        requestId,
        toolCallId: callId,
        toolName,
        agentRunId: ctx.agentRun?.agentRunId,
        agentType: ctx.agentRun?.agentType,
      },
    });

    return new Promise<ConfirmationWaitResult>(resolve => {
      const timeout = timeoutMs > 0
        ? setTimeout(() => {
            const pending = input.pending.get(requestId);
          if (pending) {
            input.pending.delete(requestId);
            input.emitConfirmationInvalidated(pending, 'timeout', `Approval timed out for tool ${toolName}.`);
            input.logConfirmationLifecycle(pending, 'hitl_approval_timeout', 'manual');
            void input.logRuntimeConfirmation(pending, 'tool.confirmation.timeout', 'failed');
          }
            input.logger.warn(`HITL confirmation timed out for tool [${toolName}] session=${ctx.sessionId}`);
            resolve({ status: 'timeout', requestId });
          }, timeoutMs)
        : null;

      const cleanupAbortListener = () => {
        ctx.abortSignal?.removeEventListener('abort', handleAbort);
      };

      const handleAbort = async (): Promise<void> => {
        const pending = input.pending.get(requestId);
        if (!pending) {
          cleanupAbortListener();
          return;
        }
        const abortMessage = `Tool confirmation aborted for ${toolName}.`;
        if (input.hitlRequests && pending.revision !== undefined) {
          let persisted = false;
          try {
            persisted = await input.hitlRequests.resolve(
              requestId,
              pending.revision,
              'cancelled',
              { message: abortMessage },
            );
          } catch (error) {
            input.logger.error(
              `Unable to persist aborted HITL confirmation ${requestId}: ${error instanceof Error ? error.message : String(error)}`,
            );
          }
          if (!persisted) {
            input.logger.error(`Aborted HITL confirmation ${requestId} requires durable reconciliation.`);
            if (input.pending.get(requestId) === pending) {
              input.pending.delete(requestId);
              input.emitConfirmationInvalidated(pending, 'cancelled', 'Cancellation persistence failed; durable reconciliation required.');
              if (timeout) clearTimeout(timeout);
              cleanupAbortListener();
              resolve({ status: 'rejected', requestId, message: 'Cancellation persistence failed; durable reconciliation required.' });
            }
            return;
          }
        }
        if (input.pending.get(requestId) !== pending) {
          return;
        }
        input.pending.delete(requestId);
        input.emitConfirmationInvalidated(pending, 'cancelled', abortMessage);
        input.logConfirmationLifecycle(pending, 'hitl_approval_cancelled', 'abort');
        void input.logRuntimeConfirmation(pending, 'tool.confirmation.cancelled', 'cancelled');
        if (timeout) clearTimeout(timeout);
        cleanupAbortListener();
        resolve({ status: 'rejected', requestId });
      };

      const pending: PendingConfirmation = {
        sessionId: ctx.sessionId,
        payload,
        revision: persisted?.revision,
        hostConfirmationRequired: Object.hasOwn(ctx, 'hostConfirmationRequirement'),
        emit: ctx.emit,
        resolve: () => {
          if (timeout) clearTimeout(timeout);
          cleanupAbortListener();
          resolve({ status: 'approved', requestId });
        },
        reject: (message?: string) => {
          if (timeout) clearTimeout(timeout);
          cleanupAbortListener();
          resolve({ status: 'rejected', requestId, ...(message ? { message } : {}) });
        },
      };
      if (boundSource) Object.defineProperties(pending, {
        source: { value: boundSource.source, enumerable: true },
        sourceAbortSignal: { value: boundSource.signal, enumerable: true },
      });
      input.pending.set(requestId, pending);

      if (ctx.abortSignal?.aborted) {
        void handleAbort();
        return;
      }
      ctx.abortSignal?.addEventListener('abort', handleAbort, { once: true });
      if (boundSource && input.onGoalWaitRegistered) {
        try {
          void input.onGoalWaitRegistered(requestId).catch(() => input.logger.error('GOAL_LAUNCH_RECONCILIATION_FAILED'));
        } catch { input.logger.error('GOAL_LAUNCH_RECONCILIATION_FAILED'); }
      }
    });
}
