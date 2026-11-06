import { useSessionStore } from '../../../store/sessionStore';
import { useAgentStore } from '../../../store/agentStore';
import { eventBus } from '../../../services/eventBus';

type SessionState = ReturnType<typeof useSessionStore.getState>;
type AgentState = ReturnType<typeof useAgentStore.getState>;

/** Flush only chunks whose message ownership binds them to this terminal turn. */
export function reconcileTerminalTurnChunks(sessionId: string, turnId?: string | null): void {
  if (!turnId) return;
  useSessionStore.setState((state) => {
    const turn = state.getSessionAgentTurns(sessionId).find((item) => item.id === turnId);
    const itemIds = new Set(turn?.items.flatMap((item) => item.kind === 'tool' ? [] : [item.messageId]) ?? []);
    const streamingChunks = { ...state.streamingChunks };
    const thinkingChunks = { ...state.thinkingChunks };
    const chunkSessionIds = { ...state.chunkSessionIds };
    let changed = false;
    const messages = state.getSessionMessages(sessionId).map((message) => {
      const bound = message.turnId ? message.turnId === turnId : itemIds.has(message.id);
      if (!bound || message.role !== 'assistant' || message.sessionId !== sessionId
        || chunkSessionIds[message.id] !== sessionId) return message;
      const content = streamingChunks[message.id] ?? message.content;
      const thinking = thinkingChunks[message.id] || message.thinking;
      delete streamingChunks[message.id]; delete thinkingChunks[message.id]; delete chunkSessionIds[message.id];
      changed = true;
      return { ...message, content, thinking, streaming: false };
    });
    if (!changed) return state;
    return { streamingChunks, thinkingChunks, chunkSessionIds,
      sessionMessages: { ...state.sessionMessages, [sessionId]: messages },
      ...(state.activeSessionId === sessionId ? { messages } : {}),
    };
  });
}

export function terminalTurnCanReleaseSession(sessionId: string, turnId?: string | null): boolean {
  const active = useSessionStore.getState().getSessionActiveTurnId(sessionId);
  return !active || !turnId || active === turnId;
}

type Deps = Pick<SessionState, 'startAgentTurn' | 'finalizeAgentTurn'>
  & Pick<AgentState, 'addActiveAgentLoop' | 'removeActiveAgentLoop' | 'clearToolActivities'
    | 'setPendingConfirmation' | 'setPendingBudgetApproval' | 'setQueuedDepth' | 'setStreaming' | 'clearToolBudgetProgress'>
  & { setAwaitingFirstChunk: (value: boolean) => void; clearToolArgProgressTracking: (sessionId: string) => void };

export function registerAgentTurnLifecycle(deps: Deps): () => void {
  const offStart = eventBus.onAgentStart((payload) => {
    deps.clearToolArgProgressTracking(payload.sessionId);
    deps.addActiveAgentLoop(payload.sessionId, payload.turnId, payload.agentRun);
    deps.startAgentTurn(payload.turnId, payload.sessionId, payload.agentRun, payload.promptMessageId);
    deps.clearToolActivities(payload.sessionId);
    deps.setPendingConfirmation(payload.sessionId, null);
    deps.setPendingBudgetApproval?.(payload.sessionId, null);
    deps.setQueuedDepth(payload.sessionId, 0);
    if (payload.sessionId === useSessionStore.getState().activeSessionId) {
      deps.setAwaitingFirstChunk(true); deps.setStreaming(true, undefined, payload.sessionId);
    }
  });
  const offDone = eventBus.onAgentDone((payload) => {
    reconcileTerminalTurnChunks(payload.sessionId, payload.turnId);
    if (!terminalTurnCanReleaseSession(payload.sessionId, payload.turnId)) return;
    deps.removeActiveAgentLoop(payload.sessionId, payload.agentRun);
    deps.clearToolBudgetProgress?.(payload.sessionId);
    deps.clearToolArgProgressTracking(payload.sessionId);
    deps.finalizeAgentTurn(payload.sessionId, payload.turnId);
    deps.setStreaming(false, undefined, payload.sessionId);
    if (payload.sessionId === useSessionStore.getState().activeSessionId) deps.setAwaitingFirstChunk(false);
    deps.setPendingConfirmation(payload.sessionId, null);
  });
  return () => { offStart(); offDone(); };
}
