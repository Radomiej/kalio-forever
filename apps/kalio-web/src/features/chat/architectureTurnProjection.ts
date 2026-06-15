import type { ChatMessage } from '@kalio/types';
import type { AgentTurn } from '../../store/sessionStore';
import type { ArchitectRunResult } from '../architect/architect.types';
import type { ArchitectureRunTurnProjection } from './architectureChatSummary';

function turnContainsArchitectureRun(turn: AgentTurn, runId: string): boolean {
  const prefix = `architecture:${runId}:`;
  return turn.items.some((item) => {
    if (item.kind === 'text') {
      return item.messageId.startsWith(prefix);
    }
    if (item.kind === 'tool') {
      return item.callId.startsWith(prefix);
    }
    return false;
  });
}

interface ReplaceArchitectureRunTurnOptions {
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
  return message.id.startsWith(`architecture:${runId}:`)
    || message.architectureRun?.runId === runId;
}

export function replaceArchitectureRunTurn({
  currentTurns,
  promptMessageId,
  runId,
  nextTurn,
}: ReplaceArchitectureRunTurnOptions): AgentTurn[] {
  return [
    ...currentTurns.filter((turn) => (
      turn.id !== nextTurn.id
      && turn.promptMessageId !== promptMessageId
      && !turnContainsArchitectureRun(turn, runId)
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
      currentTurns,
      promptMessageId,
      runId: result.run.id,
      nextTurn,
    }),
  };
}
