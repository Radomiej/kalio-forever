import type { ToolConfirmationRequest } from '@kalio/types';
import type { HitlRequestService } from '../hitl/hitl-request.service';
import type { StreamContext } from './interfaces/stream-context.interface';
import { detachHostReceiptArgs } from './llm-turn-runtime-dispatch';

/** Host context only; any own malformed marker fails closed without invoking getters. */
export function readHostConfirmationRequirement(ctx: StreamContext, callId: string, canonicalName: string) {
  const descriptor = Object.getOwnPropertyDescriptor(ctx, 'hostConfirmationRequirement');
  if (!descriptor) return undefined;
  if (!('value' in descriptor)) throw new Error('HOST_CONFIRMATION_INVALID');
  let requirement: Record<string, unknown>;
  try { requirement = detachHostReceiptArgs(descriptor.value as Record<string, unknown>); }
  catch { throw new Error('HOST_CONFIRMATION_INVALID'); }
  if (Object.keys(requirement).length !== 3 || requirement['kind'] !== 'human_only'
    || requirement['toolName'] !== 'terminal_spawn' || canonicalName !== 'terminal_spawn'
    || requirement['callId'] !== callId || !callId.trim()) throw new Error('HOST_CONFIRMATION_INVALID');
  return Object.freeze({ kind: 'human_only' as const, toolName: 'terminal_spawn' as const, callId });
}

export async function persistToolConfirmation(requests: HitlRequestService | null, payload: ToolConfirmationRequest, ctx: StreamContext) {
  const requirement = readHostConfirmationRequirement(ctx, payload.toolCallId, payload.toolName);
  if (requirement && (!requests || !ctx.onResolvedToolDispatch || !ctx.registerToolResultReceiptCommit
    || !ctx.runId || !ctx.turnId || !ctx.promptMessageId)) throw new Error('HOST_CONFIRMATION_DURABILITY_REQUIRED');
  return requests ? requests.create({
    id: payload.requestId, kind: 'tool_confirmation', sessionId: ctx.sessionId,
    turnId: ctx.turnId, runId: ctx.runId, toolCallId: payload.toolCallId,
    payload: { toolName: payload.toolName, args: payload.args },
    continuation: {
      version: 1, kind: 'approved_tool_then_resume_turn', phase: 'tool_pending', executionState: 'pending',
      runId: ctx.runId, sessionId: ctx.sessionId, turnId: ctx.turnId, promptMessageId: ctx.promptMessageId,
      messageId: ctx.messageId, vfsSessionId: ctx.vfsSessionId, historySessionId: ctx.historySessionId,
      runtimeKind: ctx.runtimeKind, iteration: ctx.iteration, currentLimit: ctx.currentLimit,
      ...(requirement ? { hostConfirmationRequirement: requirement } : {}),
    },
  }) : undefined;
}
