import { detachHostReceiptArgs } from '../../common/host-receipt-json';
export { detachHostReceiptArgs } from '../../common/host-receipt-json';
import type { LLMToolCall } from '@kalio/types';
import type { NativeToolExecutionOptions } from '../../common/kalio-mcp-bridge-context';
import type { StreamContext } from './interfaces/stream-context.interface';
import { dispatchRuntimeTool } from './llm-turn-tool-execution';

function detachToolCall(call: LLMToolCall): LLMToolCall {
  const detached = detachHostReceiptArgs(call as unknown as Record<string, unknown>);
  const { id, name, args } = detached;
  if (typeof id !== 'string' || !id.trim() || typeof name !== 'string' || !name.trim()
    || !args || typeof args !== 'object' || Array.isArray(args)) throw new Error('Invalid host receipt tool call.');
  return Object.freeze({ id, name, args: args as Record<string, unknown> });
}

export function createRuntimeToolDispatcher(input: Omit<Parameters<typeof dispatchRuntimeTool>[0], 'call' | 'context' | 'resultHandler'> & {
  context: () => StreamContext;
  failureSignal: AbortSignal;
  resultHandler: () => Parameters<typeof dispatchRuntimeTool>[0]['resultHandler'];
}) {
  const { request, lane, sessionManager } = input;
  return (call: LLMToolCall, options?: NativeToolExecutionOptions) => {
    const prior = lane.getExecution(call.id);
    if (prior) return prior;
    const raw = request.hostRuntimeReceiptObserver ? detachToolCall(call) : call;
    const transformed = request.transformToolCall ? request.transformToolCall(raw) : raw;
    const effectiveCall = request.hostRuntimeReceiptObserver ? detachToolCall(transformed) : transformed;
    const launchesFlow = raw.name === 'run_sub_agentflow' || effectiveCall.name === 'run_sub_agentflow';
    return lane.execute(call.id, effectiveCall.id, async () => {
      const ctx = input.context();
      const toolContext: StreamContext = options ? {
        ...ctx,
        abortSignal: AbortSignal.any([request.abortSignal, options.abortSignal, input.failureSignal]),
        emit: (event, data) => {
          request.emit(event, data);
          if (event === 'tool:confirmation_required') options.onApprovalProgress?.('waiting');
          else if (event === 'tool:confirmation_invalidated') options.onApprovalProgress?.('resolved');
        },
      } : ctx;
      if (options || launchesFlow) {
        await lane.write(async () => {
          // Streaming already collected the raw call. Persist the once-transformed
          // execution descriptor in that slot, not a second request for the same call.
          const index = ctx.state.toolCalls.findIndex(existing => existing.id === call.id || existing.id === effectiveCall.id);
          if (index === -1) ctx.state.addToolCall(effectiveCall);
          else ctx.state.toolCalls[index] = effectiveCall;
          await sessionManager.persistAssistantMessage(request.sessionId, ctx.messageId, ctx.state, {
            turnId: request.turnId, promptMessageId: request.promptMessageId,
          });
        });
      }
      // ACK proves durability, not permission to launch after Stop during the write.
      if (launchesFlow && (toolContext.abortSignal.aborted || request.abortSignal.aborted || input.failureSignal.aborted)) {
        throw new Error('LAUNCH_PERSISTENCE_ABORTED');
      }
      return dispatchRuntimeTool({ ...input, call: effectiveCall, context: toolContext, resultHandler: input.resultHandler() });
    }, Boolean(options));
  };
}
