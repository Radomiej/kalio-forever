import { useAgentStore } from '../../store/agentStore';
import { useSessionStore } from '../../store/sessionStore';

/** Use the exact turn journal/snapshot, never mutable session or persona defaults. */
export function useTurnRuntimeProvider(sessionId: string, turnId: string): string | undefined {
  const recorded = useSessionStore(state => (
    state.sessionAgentTurns?.[sessionId] ?? state.agentTurns ?? []
  ).find(turn => turn.sessionId === sessionId && turn.id === turnId)?.runtimeProvider);
  const live = useAgentStore(state => {
    const run = state.runtimeActivitySnapshots?.[sessionId]?.run
      ?? state.sessionStatusSnapshots?.[sessionId]?.run;
    return run?.sessionId === sessionId && run.turnId === turnId ? run.provider : undefined;
  });
  return recorded ?? live;
}
