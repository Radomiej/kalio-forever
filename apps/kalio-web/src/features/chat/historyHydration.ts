import type { ChatMessage, ChatSession, ID } from '@kalio/types';
import type { AgentTurn } from '../../store/sessionStore';
import { useSessionStore } from '../../store/sessionStore';
import { resolveSessionSlice } from '../../store/sessionStore.helpers';
import { buildTurnsFromHistory } from './chatUtils';
import { reloadSessionHistoryWithArchitectureProjection } from './architectureReloadHydration';
import { shouldReplaceTurnsFromHydratedHistory } from './turnHydrationPolicy';

type SetMessages = (messages: ChatMessage[], sessionId?: string | null) => void;
type SetAgentTurns = (turns: AgentTurn[], sessionId?: string | null) => void;
type FetchMessages = (sessionId: string) => Promise<ChatMessage[]>;

interface HydrateSessionHistoryIntoStoreParams {
  sessionId: string;
  getActiveSessionId?: () => string | null;
  getSessions?: () => ChatSession[];
  getSessionMessages: (sessionId: string) => ChatMessage[];
  setMessages: SetMessages;
  setAgentTurns: SetAgentTurns;
  getSessionAgentTurns: (sessionId: string) => AgentTurn[];
  getSessionActiveTurnId: (sessionId: string) => ID | null;
  hasActiveLoopForSession: (sessionId: string) => boolean;
  fetchMessages?: FetchMessages;
}

export async function hydrateSessionHistoryIntoStore({
  sessionId,
  getActiveSessionId,
  getSessions,
  getSessionMessages,
  setMessages,
  setAgentTurns,
  getSessionAgentTurns,
  getSessionActiveTurnId,
  hasActiveLoopForSession,
  fetchMessages,
}: HydrateSessionHistoryIntoStoreParams): Promise<ChatMessage[] | null> {
  const hydratedMessages = await reloadSessionHistoryWithArchitectureProjection({
    sessionId,
    getActiveSessionId,
    getSessions,
    getSessionMessages,
    setMessages,
    setAgentTurns,
    fetchMessages,
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
    setAgentTurns(buildTurnsFromHistory(hydratedMessages, sessionId), sessionId);
  }

  const sessionState = useSessionStore.getState();
  if (sessionState.activeSessionId === sessionId) {
    const activeSlice = resolveSessionSlice(sessionState, sessionId);
    useSessionStore.setState({
      messages: activeSlice.messages,
      agentTurns: activeSlice.agentTurns,
      activeTurnId: activeSlice.activeTurnId,
    });
  }

  return hydratedMessages;
}
