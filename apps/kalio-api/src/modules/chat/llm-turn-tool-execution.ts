import type { LLMToolCall, ToolResult } from '@kalio/types';
import type { StreamContext } from './interfaces/stream-context.interface';
import type { LLMAgentLoopRequest } from './llm-turn-runtime.types';
import type { SessionManagerService } from './session-manager.service';
import type { ToolDispatchService } from './tool-dispatch.service';
import type { AuditService } from './audit.service';
import { toAuditToolCallData, toAuditToolResultData } from './audit-tool-data';

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
  const result = await toolDispatch.dispatch(call.id, call.name, call.args,
    { ...context, registerToolResultCommit: (callback) => { commit = callback; } }, request.toolMetas);
  await lane.write(() => sessionManager.saveToolResult(request.sessionId, call.id,
    serializeToolResultContent(call.name, result), { turnId: request.turnId, promptMessageId: request.promptMessageId }));
  await commit?.(result);
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
