import type { ChatMessage, ChatRunSnapshot } from '@kalio/types';
import type { AgentTurn } from '../../store/sessionStore';

/** Restore terminal outcomes from the backend journal, never from assistant prose. */
export function applyHistoryRunOutcomes(turns: AgentTurn[], runs: ChatRunSnapshot[], prompts: ChatMessage[] = []): AgentTurn[] {
  const projected = [...turns];
  for (const prompt of prompts) {
    if (prompt.role !== 'user' || !prompt.turnId || projected.some(turn => turn.id === prompt.turnId)) continue;
    const run = runs.filter(candidate => candidate.sessionId === prompt.sessionId && candidate.turnId === prompt.turnId)
      .sort((left, right) => (right.revision ?? 0) - (left.revision ?? 0) || right.updatedAt - left.updatedAt)[0];
    if (!run || (run.runtimeKind && run.runtimeKind !== 'chat')
      || !['cancelled', 'interrupted', 'interrupted_needs_retry', 'failed'].includes(run.status)) continue;
    const insertion = projected.findIndex(turn => {
      const index = prompts.findIndex(message => message.id === turn.promptMessageId);
      return index > prompts.indexOf(prompt);
    });
    projected.splice(insertion < 0 ? projected.length : insertion, 0, {
      id: prompt.turnId, sessionId: prompt.sessionId, promptMessageId: prompt.id, items: [], done: true,
    });
  }
  return projected.map(turn => {
    const run = runs.filter(candidate => candidate.sessionId === turn.sessionId && candidate.turnId === turn.id)
      .sort((left, right) => (right.revision ?? 0) - (left.revision ?? 0) || right.updatedAt - left.updatedAt)[0];
    if (!run || !turn.done || !['cancelled', 'interrupted', 'interrupted_needs_retry', 'failed'].includes(run.status)) return turn;
    return { ...turn, error: run.status === 'cancelled'
      ? { code: 'CANCELLED', message: 'Stopped by user' }
      : { code: run.errorCode ?? 'INTERRUPTED', message: run.errorMessage ?? 'Interrupted' } };
  });
}
