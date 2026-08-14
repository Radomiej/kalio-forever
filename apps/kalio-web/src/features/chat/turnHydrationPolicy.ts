import type { ChatMessage, ID } from '@kalio/types';
import type { AgentTurn } from '../../store/sessionStore';
import { buildTurnsFromHistory } from './chatUtils';

interface TurnHydrationPolicyParams {
  sessionId: string;
  hydratedMessages: ChatMessage[];
  currentTurns: AgentTurn[];
  activeTurnId: ID | null;
  hasActiveLoop?: boolean;
}

export function shouldReplaceTurnsFromHydratedHistory({
  sessionId,
  hydratedMessages,
  currentTurns,
  activeTurnId,
  hasActiveLoop = false,
}: TurnHydrationPolicyParams): boolean {
  if (!activeTurnId) {
    return true;
  }

  const activeTurn = currentTurns.find((turn) => turn.id === activeTurnId);
  const hydratedTurns = buildTurnsFromHistory(hydratedMessages, sessionId);

  if (!activeTurn) {
    return hasActiveLoop ? hydratedTurns.length > 0 : true;
  }

  if (activeTurn.done) {
    return true;
  }

  if (activeTurn.promptMessageId) {
    return hydratedTurns.some((turn) => turn.promptMessageId === activeTurn.promptMessageId);
  }

  if (hydratedTurns.length === 0) {
    return false;
  }

  return hydratedTurns.some((turn) =>
    turn.turnKind === 'workflow-envelope'
    || turn.items.some((item) => item.kind === 'tool'),
  ) || activeTurn.items.length > 0;
}
