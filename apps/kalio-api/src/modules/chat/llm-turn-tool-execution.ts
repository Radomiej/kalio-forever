import { createHash } from 'node:crypto';
import type { HostRuntimeReceiptIdentity, LLMToolCall, ToolResult, HostResolvedToolDispatch, HostHitlExecutionCommit } from '@kalio/types';
import type { StreamContext } from './interfaces/stream-context.interface';
import type { LLMAgentLoopRequest } from './llm-turn-runtime.types';
import type { SessionManagerService } from './session-manager.service';
import type { ToolDispatchService } from './tool-dispatch.service';
import type { AuditService } from './audit.service';
import { toAuditToolCallData, toAuditToolResultData } from './audit-tool-data';

export function hostReceiptIdentity(request: Pick<LLMAgentLoopRequest, 'runId' | 'sessionId' | 'turnId' | 'promptMessageId'>): HostRuntimeReceiptIdentity {
  const { runId, sessionId, turnId, promptMessageId } = request;
  if (![runId, sessionId, turnId, promptMessageId].every(id => typeof id === 'string' && id.trim().length > 0)) {
    throw new Error('Host receipts require persisted journal/session/turn/prompt identity.');
  }
  return Object.freeze({ runId: runId!, sessionId, turnId: turnId!, promptMessageId: promptMessageId! });
}

/** One mutation lane and one execution ledger for an LLM iteration. */
export class TurnExecutionLane {
  private writes: Promise<void> = Promise.resolve();
  private readonly executions = new Map<string, Promise<ToolResult>>();
  private nativeAdmissionOpen = true;

  write(task: () => Promise<void>): Promise<void> {
    const next = this.writes.then(task);
    this.writes = next;
    return next;
  }

  execute(callId: string, effectiveId: string, task: () => Promise<ToolResult>, native = false): Promise<ToolResult> {
    const claimed = this.executions.get(callId) ?? this.executions.get(effectiveId);
    if (claimed) return claimed;
    if (native && !this.nativeAdmissionOpen) return Promise.reject(new Error('This Kalio turn no longer accepts native tool calls.'));
    const execution = Promise.resolve().then(task);
    this.executions.set(callId, execution);
    this.executions.set(effectiveId, execution);
    return execution;
  }

  has(callId: string): boolean { return this.executions.has(callId); }
  getExecution(callId: string): Promise<ToolResult> | undefined { return this.executions.get(callId); }
  get hasExecutions(): boolean { return this.executions.size > 0; }

  async drain(): Promise<void> {
    this.nativeAdmissionOpen = false;
    const outcomes = await Promise.allSettled(new Set(this.executions.values()));
    await this.writes;
    const failure = outcomes.find((outcome) => outcome.status === 'rejected');
    if (failure?.status === 'rejected') throw failure.reason;
  }
}

export async function dispatchRuntimeTool(input: {
  request: LLMAgentLoopRequest;
  call: LLMToolCall;
  context: StreamContext;
  lane: TurnExecutionLane;
  sessionManager: SessionManagerService;
  toolDispatch: ToolDispatchService;
  audit?: AuditService;
  resultHandler?: (callId: string, result: ToolResult) => Promise<void> | void;
}): Promise<ToolResult> {
  const { request, call, context, lane, sessionManager, toolDispatch, audit } = input;
  const observer = request.hostRuntimeReceiptObserver;
  const cancellation = request.hostCancellationRecording;
  if (cancellation && (!observer || !request.hostDispatchReceiptRecorder)) throw new Error('HOST_CANCELLATION_DEPENDENCIES_REQUIRED');
  if (request.hostDispatchReceiptRecorder && !observer) throw new Error('HOST_DISPATCH_OBSERVER_REQUIRED');
  const identity = observer ? hostReceiptIdentity(request) : undefined;
  // This records the actual call; only the host closure can admit its resolved authority.
  const admission = identity ? Object.freeze({ identity, callId: call.id, toolName: call.name, args: call.args }) : undefined;
  const recorder = admission ? request.hostDispatchReceiptRecorder?.createCallRecorder(admission, context.abortSignal) : undefined;
  if (observer && admission) {
    const admissionAck = observer.admit(admission);
    if (cancellation && recorder) await cancellation.registerAdmission(admission, recorder, admissionAck);
    else await admissionAck;
  }
  await request.callbacks?.onToolPending?.();
  context.emit('tool:start', {
    callId: call.id, toolName: call.name, args: call.args, sessionId: request.sessionId,
    turnId: request.turnId, ...(request.agentRun ? { agentRun: request.agentRun } : {}),
  });
  const meta = request.toolMetas.find((tool) => tool.name === call.name || tool.aliases?.includes(call.name));
  const args = { ...call.args, ...(request.auditMetadata ?? {}) };
  const ownership = request.agentRun ? {
    childAgentRunId: request.agentRun.agentRunId,
    parentSessionId: request.agentRun.parentSessionId,
    parentToolCallId: request.agentRun.parentToolCallId,
  } : {};
  await audit?.log({ sessionId: request.sessionId, type: 'tool_call', label: call.name,
    data: { ...toAuditToolCallData(call.id, call.name, args, meta), ...ownership } });
  const startedAt = performance.now();
  let commit: ((result: ToolResult) => Promise<void>) | undefined;
  let receiptCommit: ((result: ToolResult) => Promise<HostHitlExecutionCommit>) | undefined;
  let resolvedDispatch: HostResolvedToolDispatch | null = null;
  let pendingDispatch: HostResolvedToolDispatch | null = null;
  const result = await toolDispatch.dispatch(call.id, call.name, call.args,
    { ...context, registerToolResultCommit: (callback) => { commit = callback; },
      ...(observer ? {
        onResolvedToolDispatch: async (receipt: HostResolvedToolDispatch) => {
          await observer.resolvedDispatch?.(receipt);
          await recorder?.resolved(receipt);
          if (!context.abortSignal.aborted) pendingDispatch = receipt;
        },
        onToolExecutorEntered: () => {
          if (!pendingDispatch || context.abortSignal.aborted) throw new Error('HOST_DISPATCH_ENTRY_INVALID');
          recorder?.entered(pendingDispatch);
          resolvedDispatch = pendingDispatch;
        },
        registerToolResultReceiptCommit: (callback: (result: ToolResult) => Promise<HostHitlExecutionCommit>) => { receiptCommit = callback; },
      } : {}),
    }, request.toolMetas);
  const content = serializeToolResultContent(call.name, result);
  let persistedMessageId: string | undefined;
  await lane.write(async () => {
    persistedMessageId = await sessionManager.saveToolResult(request.sessionId, call.id,
      content, { turnId: request.turnId, promptMessageId: request.promptMessageId });
  });
  await commit?.(result);
  const hitlCommit = receiptCommit ? await receiptCommit(result) : null;
  if (observer && identity) {
    if (typeof persistedMessageId !== 'string' || !persistedMessageId.trim()) throw new Error('Host receipt requires a persisted result message ID.');
    const receipt = Object.freeze({ identity, callId: call.id, toolName: call.name, persistedMessageId,
      contentSha256: createHash('sha256').update(content, 'utf8').digest('hex'), status: result.status,
      registeredCommitAck: commit || receiptCommit ? 'acknowledged' as const : 'not_registered' as const, resolvedDispatch, hitlCommit });
    const permit = context.abortSignal.aborted && result.status === 'cancelled' && recorder
      ? cancellation?.permitFor(call.id, recorder) : null;
    if (permit && recorder) {
      // Cancellation durability does not complete the goal producer's admission.
      // Never retry a failed normal commit using the Stop-owner lease.
      await recorder.recordCancelled(receipt, permit);
    } else {
      await recorder?.commit(receipt);
      await observer.commit(receipt);
    }
  }
  context.emit('tool:result', { ...result, sessionId: request.sessionId, toolName: call.name });
  await audit?.log({ sessionId: request.sessionId, type: 'tool_result', label: call.name,
    data: { ...toAuditToolResultData(call.id, call.name, result, args, meta), ...ownership },
    durationMs: Math.round(performance.now() - startedAt) });
  await request.onToolResult?.(call.id, result);
  await input.resultHandler?.(call.id, result);
  if (call.name === 'escalate' && result.status === 'success') {
    const message = (result.data as Record<string, unknown>)?.['message'];
    if (typeof message === 'string') request.callbacks?.onEscalation?.(message);
  }
  return result;
}

const CLI_CHILD_TOOL_NAMES = new Set(['run_cli_agent', 'spawn_cli_agent', 'message_cli_agent', 'get_cli_agent_status', 'stop_cli_agent']);

export function serializeToolResultContent(toolName: string, result: ToolResult): string {
  const fallbackErrorMessage = result.errorMessage ?? (
    result.status === 'cancelled' ? `Tool ${toolName} was cancelled or not approved.` : ''
  );
  if (CLI_CHILD_TOOL_NAMES.has(toolName) && result.data && typeof result.data === 'object' && !Array.isArray(result.data)) {
    return JSON.stringify({
      ...(result.data as Record<string, unknown>), toolResultStatus: result.status,
      ...(result.errorCode ? { toolResultErrorCode: result.errorCode } : {}),
      ...(fallbackErrorMessage ? { toolResultErrorMessage: fallbackErrorMessage } : {}),
    });
  }
  return result.status === 'success' ? JSON.stringify(result.data ?? '') : JSON.stringify({
    status: result.status, errorCode: result.errorCode, errorMessage: fallbackErrorMessage,
  });
}
