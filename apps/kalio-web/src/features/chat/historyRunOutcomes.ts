import type { ChatRunSnapshot } from '@kalio/types';
import type { AgentTurn } from '../../store/sessionStore';

/** Restore terminal outcomes from the backend journal, never from assistant prose. */
export function applyHistoryRunOutcomes(turns: AgentTurn[], runs: ChatRunSnapshot[]): AgentTurn[] {
  return turns.map(turn => {
    const run = runs.filter(candidate => candidate.sessionId === turn.sessionId && candidate.turnId === turn.id)
      .sort((left, right) => (right.revision ?? 0) - (left.revision ?? 0) || right.updatedAt - left.updatedAt)[0];
    if (!run || !turn.done || !['cancelled', 'interrupted', 'interrupted_needs_retry', 'failed'].includes(run.status)) return turn;
    return { ...turn, error: run.status === 'cancelled'
      ? { code: 'CANCELLED', message: 'Stopped by user' }
      : { code: run.errorCode ?? 'INTERRUPTED', message: run.errorMessage ?? 'Interrupted' } };
  });
}
