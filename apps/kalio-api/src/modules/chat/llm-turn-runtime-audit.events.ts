import type { RuntimeAuditEventInput } from './runtime-audit-logger.service';
import type { LLMAgentLoopRequest } from './llm-turn-runtime.types';
import type { TurnState } from './turn-state';

type EmptyNoToolEventName =
  | 'llm.turn.empty_no_tool_retry'
  | 'llm.turn.empty_no_tool_exhausted';

interface EmptyNoToolRuntimeAuditInput {
  eventName: EmptyNoToolEventName;
  request: Pick<LLMAgentLoopRequest, 'runtimeKind' | 'sessionId' | 'turnId'>;
  iteration: number;
  retryCount: number;
  retryLimit: number;
  state: Pick<TurnState, 'text' | 'thinking' | 'toolCalls'>;
}

export function buildEmptyNoToolRuntimeAuditEvent(
  input: EmptyNoToolRuntimeAuditInput,
): RuntimeAuditEventInput {
  const exhausted = input.eventName === 'llm.turn.empty_no_tool_exhausted';

  return {
    eventName: input.eventName,
    sessionId: input.request.sessionId,
    turnId: input.request.turnId,
    status: exhausted ? 'failed' : 'running',
    reasonCode: 'runtime_stalled',
    ...(exhausted ? { errorCode: 'CONTRACT_VIOLATION' } : {}),
    data: {
      runtimeKind: input.request.runtimeKind,
      iteration: input.iteration,
      retryCount: input.retryCount,
      retryLimit: input.retryLimit,
      textLength: input.state.text.length,
      thinkingLength: input.state.thinking.length,
      toolCallCount: input.state.toolCalls.length,
    },
  };
}
