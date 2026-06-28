import type { ChatMessage } from '@kalio/types';
import type { AgentTurn } from '../../store/sessionStore';
import type { ArchitectRunResult } from '../architect/architect.types';
import type { ArchitectureRunTurnProjection } from './architectureChatSummary';

function architectureRunIdsByReference(messages: ChatMessage[]): Map<string, string> {
  const result = new Map<string, string>();
  for (const message of messages) {
    if (message.architectureRun?.runId) {
      result.set(message.id, message.architectureRun.runId);
    }
    for (const toolCall of message.toolCalls ?? []) {
      const runId = toolCall.args['architectureRunId'];
      if (typeof runId === 'string') {
        result.set(toolCall.id, runId);
      }
    }
  }
  return result;
}

function turnContainsArchitectureRun(
  turn: AgentTurn,
  runId: string,
  runIdsByReference: Map<string, string>,
): boolean {
  return turn.items.some((item) => {
    if (item.kind === 'text') {
      return runIdsByReference.get(item.messageId) === runId;
    }
    if (item.kind === 'tool') {
      return runIdsByReference.get(item.callId) === runId;
    }
    return false;
  });
}

interface ReplaceArchitectureRunTurnOptions {
  currentMessages: ChatMessage[];
  currentTurns: AgentTurn[];
  promptMessageId: string;
  runId: string;
  nextTurn: AgentTurn;
}

interface ResolveArchitectureRunTurnUpdateOptions {
  currentMessages: ChatMessage[];
  currentTurns: AgentTurn[];
  pendingAssistantMessageId: string;
  promptMessageId: string;
  projection: ArchitectureRunTurnProjection;
  result: ArchitectRunResult;
  sessionId: string;
}

export interface ResolvedArchitectureRunTurnUpdate {
  messages: ChatMessage[];
  nextTurn: AgentTurn;
  turns: AgentTurn[];
}

function isArchitectureRunProjectionMessage(message: ChatMessage, runId: string): boolean {
  return message.architectureRun?.runId === runId
    || message.toolCalls?.some((toolCall) => toolCall.args['architectureRunId'] === runId) === true;
}

export function replaceArchitectureRunTurn({
  currentMessages,
  currentTurns,
  promptMessageId,
  runId,
  nextTurn,
}: ReplaceArchitectureRunTurnOptions): AgentTurn[] {
  const runIdsByReference = architectureRunIdsByReference(currentMessages);
  return [
    ...currentTurns.filter((turn) => (
      turn.id !== nextTurn.id
      && turn.promptMessageId !== promptMessageId
      && !turnContainsArchitectureRun(turn, runId, runIdsByReference)
    )),
    nextTurn,
  ];
}

export function resolveArchitectureRunTurnUpdate({
  currentMessages,
  currentTurns,
  pendingAssistantMessageId,
  promptMessageId,
  projection,
  result,
  sessionId,
}: ResolveArchitectureRunTurnUpdateOptions): ResolvedArchitectureRunTurnUpdate {
  const projectionDone = (result.run.status !== 'queued' && result.run.status !== 'running')
    || result.agentFlowStatus === 'waiting_on_orchestrator';
  const messages = [
    ...currentMessages
      .filter((message) => message.id !== pendingAssistantMessageId)
      .filter((message) => !isArchitectureRunProjectionMessage(message, result.run.id)),
    ...projection.messages,
  ];
  const nextTurn: AgentTurn = {
    id: `architecture-turn-${result.run.id}`,
    sessionId,
    promptMessageId,
    turnKind: projection.turnKind,
    items: projection.turnItems,
    done: projectionDone,
  };

  return {
    messages,
    nextTurn,
    turns: replaceArchitectureRunTurn({
      currentMessages,
      currentTurns,
      promptMessageId,
      runId: result.run.id,
      nextTurn,
    }),
  };
}
