import type { ChatMessage, ChatRunSnapshot, ChatSession, ID } from '@kalio/types';
import { apiClient } from '../../services/apiClient';
import { applyHistoryRunOutcomes } from './historyRunOutcomes';
import type { AgentTurn } from '../../store/sessionStore';
import { useSessionStore } from '../../store/sessionStore';
import { resolveSessionSlice } from '../../store/sessionStore.helpers';
import { buildTurnsFromHistory } from './chatUtils';
import { reloadSessionHistoryWithArchitectureProjection, type FetchArchitectureRunProjection } from './architectureReloadHydration';
import type { SessionHistoryFetchResult, SessionHistoryMeta } from './sessionHistoryApi';
import { shouldReplaceTurnsFromHydratedHistory } from './turnHydrationPolicy';

type SetMessages = (messages: ChatMessage[], sessionId?: string | null) => void;
type SetAgentTurns = (turns: AgentTurn[], sessionId?: string | null) => void;
type SetSessionHistoryMeta = (sessionId: string, meta: SessionHistoryMeta | null) => void;
type FetchMessages = (sessionId: string) => Promise<SessionHistoryFetchResult>;

interface HydrateSessionHistoryIntoStoreParams {
  sessionId: string;
  getActiveSessionId?: () => string | null;
  getSessions?: () => ChatSession[];
  getSessionMessages: (sessionId: string) => ChatMessage[];
  setMessages: SetMessages;
  setSessionHistoryMeta?: SetSessionHistoryMeta;
  setAgentTurns: SetAgentTurns;
  getSessionAgentTurns: (sessionId: string) => AgentTurn[];
  getSessionActiveTurnId: (sessionId: string) => ID | null;
  hasActiveLoopForSession: (sessionId: string) => boolean;
  fetchMessages?: FetchMessages;
  fetchArchitectureRunProjection?: FetchArchitectureRunProjection;
  fetchRunOutcomes?: (sessionId: string, turnIds: string[]) => Promise<ChatRunSnapshot[]>;
}

export async function hydrateSessionHistoryIntoStore({
  sessionId,
  getActiveSessionId,
  getSessions,
  getSessionMessages,
  setMessages,
  setSessionHistoryMeta,
  setAgentTurns,
  getSessionAgentTurns,
  getSessionActiveTurnId,
  hasActiveLoopForSession,
  fetchMessages,
  fetchArchitectureRunProjection,
  fetchRunOutcomes,
}: HydrateSessionHistoryIntoStoreParams): Promise<ChatMessage[] | null> {
  const hydratedMessages = await reloadSessionHistoryWithArchitectureProjection({
    sessionId,
    getActiveSessionId,
    getSessions,
    getSessionMessages,
    setMessages,
    setSessionHistoryMeta,
    setAgentTurns,
    fetchMessages,
    fetchArchitectureRunProjection,
  });
  if (!hydratedMessages) {
    return null;
  }

  useSessionStore.getState().markSessionHydrated(sessionId);

  const currentTurns = getSessionAgentTurns(sessionId);
  const activeTurnId = getSessionActiveTurnId(sessionId);
  const hasActiveLoop = hasActiveLoopForSession(sessionId);
  if (shouldReplaceTurnsFromHydratedHistory({
    sessionId,
    hydratedMessages,
    currentTurns,
    activeTurnId,
    hasActiveLoop,
  })) {
    const turns = buildTurnsFromHistory(hydratedMessages, sessionId);
    const loadOutcomes = fetchRunOutcomes ?? (async (id: string, turnIds: string[]) => {
      const response = await apiClient.get<ChatRunSnapshot[]>(`/api/sessions/${id}/runs/history`, {
        params: { turnIds: turnIds.join(',') },
      });
      return response.data;
    });
    let outcomes: ChatRunSnapshot[] = [];
    // Architecture envelopes have their own durable projection; legacy synthetic IDs have no journal linkage.
    const journalTurnIds = [...new Set([
      ...turns.filter(turn => !turn.turnKind
        && !turn.id.startsWith('history-turn-') && !turn.id.startsWith('architecture-turn-')).map(turn => turn.id),
      ...hydratedMessages.filter(message => message.sessionId === sessionId && message.role === 'user')
        .flatMap(message => message.turnId ? [message.turnId] : []),
    ])];
    if (journalTurnIds.length > 0) {
      try { outcomes = await loadOutcomes(sessionId, journalTurnIds); }
      catch (error) { console.warn('Could not restore durable chat run outcomes', error); }
    }
    // A live turn may have started while the journal read was in flight.
    if (shouldReplaceTurnsFromHydratedHistory({ sessionId, hydratedMessages,
      currentTurns: getSessionAgentTurns(sessionId), activeTurnId: getSessionActiveTurnId(sessionId),
      hasActiveLoop: hasActiveLoopForSession(sessionId) })) {
      setAgentTurns(applyHistoryRunOutcomes(turns, outcomes,
        hydratedMessages.filter(message => message.sessionId === sessionId)), sessionId);
    }
  }

  const sessionState = useSessionStore.getState();
  if (sessionState.activeSessionId === sessionId && typeof useSessionStore.setState === 'function') {
    const activeSlice = resolveSessionSlice(sessionState, sessionId);
    useSessionStore.setState({
      messages: activeSlice.messages,
      agentTurns: activeSlice.agentTurns,
      activeTurnId: activeSlice.activeTurnId,
    });
  }

  return hydratedMessages;
}
