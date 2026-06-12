import type { AgentTurn } from '../../store/sessionStore';

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
