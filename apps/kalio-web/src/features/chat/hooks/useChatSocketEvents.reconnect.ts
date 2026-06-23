import type { ChatMessage, ChatSession } from '@kalio/types';
import type { AgentTurn } from '../../../store/sessionStore';
import { useAgentStore } from '../../../store/agentStore';
import { useSessionStore } from '../../../store/sessionStore';
import type { SessionHistoryFetchResult, SessionHistoryMeta } from '../sessionHistoryApi';
import type { CliChildSocketDeps } from './useChatSocketEvents.cliChild';
import {
  identifyCliChildProjections,
  identifyCliChildrenOnReconnect,
  rebuildCliChildProjectionsFromHistory,
} from './useChatSocketEvents.cliChild';
import { hydrateActiveConversationSession } from '../activeConversationSession';
import { normalizeConversationSessionId } from '../../sessions/sessionTreeDisplay';
import {
  materializeLiveTurnFromHydratedRuntimeState,
} from './useChatSocketEvents.helpers';

export interface SocketReconnectDeps {
  cliChild: CliChildSocketDeps;
  setStreaming: (value: boolean, messageId?: string, sessionId?: string | null) => void;
  setAwaitingFirstChunk?: (value: boolean) => void;
  clearToolArgProgressTracking: (sessionId?: string | null) => void;
  clearToolActivities: (sessionId?: string) => void;
  removeActiveAgentLoop: (sessionId: string) => void;
  setPendingConfirmation: (sessionId: string, value: null) => void;
  setActiveSession?: (sessionId: string) => void;
  setSessions?: (sessions: ChatSession[]) => void;
  getActiveSessionId: () => string | null;
  getSessionMessages: (sessionId: string) => ChatMessage[];
  setMessages: (messages: ChatMessage[], sessionId?: string | null) => void;
  setSessionHistoryMeta?: (sessionId: string, meta: SessionHistoryMeta | null) => void;
  setAgentTurns: (turns: AgentTurn[], sessionId?: string | null) => void;
  hasActiveLoopForSession: (sessionId: string) => boolean;
  fetchMessages: (sessionId: string) => Promise<SessionHistoryFetchResult>;
  fetchSessions?: () => Promise<ChatSession[]>;
  onContextInvalidated?: () => void;
}

export function handleSocketReconnect(deps: SocketReconnectDeps): void {
  deps.setStreaming(false, undefined, deps.getActiveSessionId());
  deps.setAwaitingFirstChunk?.(false);
  deps.clearToolArgProgressTracking();

  const sid = deps.getActiveSessionId();
  if (!sid) {
    deps.clearToolActivities();
    return;
  }

  deps.clearToolActivities(sid);
  deps.removeActiveAgentLoop(sid);
  deps.setPendingConfirmation(sid, null);

  void (async () => {
    let refreshedSessions: ChatSession[] | null = null;
    if (deps.fetchSessions && deps.setSessions) {
      try {
        refreshedSessions = await deps.fetchSessions();
        deps.setSessions(refreshedSessions);
      } catch (err) {
        console.warn(
          '[ChatInterface] reconnect session refresh failed',
          err instanceof Error ? err : new Error(String(err)),
        );
      }
    }

    const currentSelection = deps.getActiveSessionId() ?? sid;
    const reconnectedSessionId = refreshedSessions
      ? normalizeConversationSessionId(currentSelection, refreshedSessions) ?? currentSelection
      : currentSelection;

    identifyCliChildrenOnReconnect(deps.cliChild, reconnectedSessionId);

    if (reconnectedSessionId !== currentSelection) {
      deps.setActiveSession?.(reconnectedSessionId);
    }
    if (reconnectedSessionId !== sid) {
      deps.clearToolActivities(reconnectedSessionId);
      deps.removeActiveAgentLoop(reconnectedSessionId);
      deps.setPendingConfirmation(reconnectedSessionId, null);
    }

    const hydratedMessages = await hydrateActiveConversationSession({
      mode: 'reconnect',
      sessionId: reconnectedSessionId,
      getActiveSessionId: () => {
        const activeSessionId = deps.getActiveSessionId();
        if (!activeSessionId || !refreshedSessions) {
          return activeSessionId;
        }
        return normalizeConversationSessionId(activeSessionId, refreshedSessions) ?? activeSessionId;
      },
      getSessions: () => refreshedSessions ?? useSessionStore.getState().sessions,
      getSessionMessages: deps.getSessionMessages,
      setMessages: deps.setMessages,
      setSessionHistoryMeta: deps.setSessionHistoryMeta,
      setAgentTurns: deps.setAgentTurns,
      getSessionAgentTurns: (sessionId) => useSessionStore.getState().getSessionAgentTurns(sessionId),
      getSessionActiveTurnId: (sessionId) => useSessionStore.getState().getSessionActiveTurnId(sessionId),
      hasActiveLoopForSession: deps.hasActiveLoopForSession,
      fetchMessages: deps.fetchMessages,
    });
    if (!hydratedMessages) return;
    const projections = rebuildCliChildProjectionsFromHistory(deps.cliChild, reconnectedSessionId, hydratedMessages);
    identifyCliChildProjections(deps.cliChild, projections, reconnectedSessionId);
    const agentState = useAgentStore.getState();
    materializeLiveTurnFromHydratedRuntimeState(
      {
        runtimeSnapshot: agentState.getRuntimeActivitySnapshot(reconnectedSessionId),
        bufferedSessionStatusSnapshots: agentState.consumeBufferedSessionStatusSnapshots(reconnectedSessionId),
        latestSessionStatusSnapshot: agentState.sessionStatusSnapshots[reconnectedSessionId],
      },
      {
        hasActiveLoopForSession: (sessionId) => useAgentStore.getState().hasActiveLoopForSession(sessionId),
        getSessionActiveTurnId: (sessionId) => useSessionStore.getState().getSessionActiveTurnId(sessionId),
        addActiveAgentLoop: (sessionId, turnId) => useAgentStore.getState().addActiveAgentLoop(sessionId, turnId),
        startAgentTurn: (turnId, sessionId) => useSessionStore.getState().startAgentTurn(turnId, sessionId),
        setAwaitingFirstChunk: deps.setAwaitingFirstChunk,
      },
    );
    deps.onContextInvalidated?.();
  })()
    .catch((err: unknown) => {
      console.error('[ChatInterface] reconnect history reload failed', err instanceof Error ? err : new Error(String(err)));
    });
}
