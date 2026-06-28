import type { ChatMessage } from '@kalio/types';
import type { AgentTurn } from '../../store/sessionStore';
import { findArchitectureRunInMessages } from './architectureChatSummary';

type TurnTextOrThinkingItem = Extract<AgentTurn['items'][number], { kind: 'text' | 'thinking' }>;
type TurnToolItem = Extract<AgentTurn['items'][number], { kind: 'tool' }>;

export type WorkflowTurnProjection = {
  turnMessages: ChatMessage[];
  architectureRunId: string | null;
  architectureMessages: ChatMessage[];
  persistedArchitectureMessage: ChatMessage | null;
  architectureRun: ChatMessage['architectureRun'] | null;
  branchSessionIds: Set<string>;
};

export function resolveWorkflowTurnProjection(
  turn: AgentTurn,
  messages: ChatMessage[],
  toolArgsByCallId: ReadonlyMap<string, Record<string, unknown>>,
): WorkflowTurnProjection {
  const messageById = new Map(messages.map((message) => [message.id, message]));
  const turnMessages = turn.items
    .filter((item): item is TurnTextOrThinkingItem => item.kind === 'text' || item.kind === 'thinking')
    .map((item) => messageById.get(item.messageId))
    .filter((message): message is ChatMessage => Boolean(message));
  const architectureRunId = turnMessages
    .map((message) => message.architectureRun?.runId)
    .find((runId): runId is string => typeof runId === 'string' && runId.trim().length > 0)
    ?? turn.items
      .filter((item): item is TurnToolItem => item.kind === 'tool')
      .map((item) => toolArgsByCallId.get(item.callId)?.['architectureRunId'])
      .find((runId): runId is string => typeof runId === 'string' && runId.trim().length > 0)
    ?? null;
  const architectureMessages = architectureRunId
    ? (() => {
      const architectureToolCallIds = new Set(messages
        .flatMap((message) => message.toolCalls ?? [])
        .filter((toolCall) => toolCall.args['architectureRunId'] === architectureRunId)
        .map((toolCall) => toolCall.id));
      return messages.filter((message) => {
        if (message.architectureRun?.runId === architectureRunId) {
          return true;
        }
        if (message.role === 'assistant' && message.toolCalls) {
          return message.toolCalls.some((toolCall) => (
            toolCall.name === 'run_subagent'
            && toolCall.args['architectureRunId'] === architectureRunId
          ));
        }
        if (message.role === 'tool_result' && typeof message.toolCallId === 'string' && architectureToolCallIds.has(message.toolCallId)) {
          return true;
        }
        return false;
      });
    })()
    : turnMessages;
  const persistedArchitectureMessage = [...architectureMessages]
    .reverse()
    .find((message) => Boolean(message.architectureRun))
    ?? null;
  const architectureRun = persistedArchitectureMessage?.architectureRun
    ?? findArchitectureRunInMessages(architectureMessages);
  const branchSessionIds = new Set<string>([
    ...turn.items
      .filter((item): item is TurnToolItem => item.kind === 'tool')
      .map((item) => toolArgsByCallId.get(item.callId)?.['childSessionId'])
      .filter((sessionId): sessionId is string => typeof sessionId === 'string' && sessionId.trim().length > 0),
    ...(architectureRun?.trace
      .map((step) => step.stream?.branchSessionId)
      .filter((sessionId): sessionId is string => typeof sessionId === 'string' && sessionId.trim().length > 0)
      ?? []),
  ]);

  return {
    turnMessages,
    architectureRunId,
    architectureMessages,
    persistedArchitectureMessage,
    architectureRun: architectureRun ?? null,
    branchSessionIds,
  };
}
