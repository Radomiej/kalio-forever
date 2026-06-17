import type { ChatMessage } from '@kalio/types';
import type { ChatSession } from '@kalio/types';
import { useAgentStore } from '../../../store/agentStore';
import { useSessionStore } from '../../../store/sessionStore';
import { apiClient } from '../../../services/apiClient';
import { backendHealth } from '../../../services/backendHealth';
import { eventBus } from '../../../services/eventBus';
import type { ChatConnectionState } from '../ChatInterface.Parts';
import { handleSessionStatusEvent, handleConnectionStateEvent, type ReconnectUiState } from './useChatSocketEvents.helpers';
import { handleCliChildSessionCreated } from './useChatSocketEvents.cliChild';
import { handleSocketReconnect } from './useChatSocketEvents.reconnect';

type AgentStoreState = ReturnType<typeof useAgentStore.getState>;
type SessionStoreState = ReturnType<typeof useSessionStore.getState>;
type CliChildDeps = Parameters<typeof handleCliChildSessionCreated>[0];

export function registerSessionLifecycleHandlers({
  cliChildDeps,
  addSession,
  setRecoveryNotice,
  addActiveAgentLoop,
  startAgentTurn,
  setAwaitingFirstChunk,
  setStreaming,
  setQueuedDepth,
  recordSessionStatusSnapshot,
  clearBufferedSessionStatusSnapshots,
}: {
  cliChildDeps: CliChildDeps;
  addSession: SessionStoreState['addSession'];
  setRecoveryNotice: (value: string | null) => void;
  addActiveAgentLoop: AgentStoreState['addActiveAgentLoop'];
  startAgentTurn: SessionStoreState['startAgentTurn'];
  setAwaitingFirstChunk: (value: boolean) => void;
  setStreaming: AgentStoreState['setStreaming'];
  setQueuedDepth: AgentStoreState['setQueuedDepth'];
  recordSessionStatusSnapshot: AgentStoreState['recordSessionStatusSnapshot'];
  clearBufferedSessionStatusSnapshots: AgentStoreState['clearBufferedSessionStatusSnapshots'];
}): () => void {
  const offSessionStatus = eventBus.onSessionStatus((payload) => {
    handleSessionStatusEvent(payload, {
      getActiveSessionId: () => useSessionStore.getState().activeSessionId,
      isSessionHydrated: (sessionId) => useSessionStore.getState().isSessionHydrated(sessionId),
      hasActiveLoopForSession: (sessionId) => useAgentStore.getState().hasActiveLoopForSession(sessionId),
      getSessionActiveTurnId: (sessionId) => useSessionStore.getState().getSessionActiveTurnId(sessionId),
      setRecoveryNotice,
      addActiveAgentLoop,
      startAgentTurn,
      setAwaitingFirstChunk,
      setStreaming,
      recordSessionStatusSnapshot,
      clearBufferedSessionStatusSnapshots,
    });
  });

  const offSessionCreated = eventBus.onSessionCreated((session) => {
    addSession(session);
    eventBus.identifySession(session.id);
    handleCliChildSessionCreated(cliChildDeps, session);
  });

  const offSessionUpdated = eventBus.onSessionUpdated?.((session) => {
    addSession(session);
  });

  const offQueued = eventBus.onQueued((payload) => {
    setQueuedDepth(payload.sessionId, payload.queueLength);
  });

  return () => {
    offSessionStatus();
    offSessionCreated();
    offSessionUpdated?.();
    offQueued();
  };
}

export function registerConnectionRecoveryHandlers({
  cliChildDeps,
  getConnectionState,
  getReconnectUiState,
  setReconnectUiStateRef,
  setConnectionStateRef,
  setConnectionState,
  setRecoveryNotice,
  setStreaming,
  setAwaitingFirstChunk,
  clearToolArgProgressTracking,
  clearToolActivities,
  removeActiveAgentLoop,
  setPendingConfirmation,
  setActiveSession,
  setSessions,
  setMessages,
  setAgentTurns,
  onContextInvalidated,
}: {
  cliChildDeps: CliChildDeps;
  getConnectionState: () => ChatConnectionState;
  getReconnectUiState: () => ReconnectUiState;
  setReconnectUiStateRef: (value: ReconnectUiState) => void;
  setConnectionStateRef: (value: ChatConnectionState) => void;
  setConnectionState: (value: ChatConnectionState) => void;
  setRecoveryNotice: (value: string | null) => void;
  setStreaming: AgentStoreState['setStreaming'];
  setAwaitingFirstChunk: (value: boolean) => void;
  clearToolArgProgressTracking: (sessionId?: string | null) => void;
  clearToolActivities: AgentStoreState['clearToolActivities'];
  removeActiveAgentLoop: AgentStoreState['removeActiveAgentLoop'];
  setPendingConfirmation: AgentStoreState['setPendingConfirmation'];
  setActiveSession: SessionStoreState['setActiveSession'];
  setSessions: SessionStoreState['setSessions'];
  setMessages: SessionStoreState['setMessages'];
  setAgentTurns: SessionStoreState['setAgentTurns'];
  onContextInvalidated: (() => void) | undefined;
}): () => void {
  const offConnectionState = eventBus.onConnectionState((state) => {
    handleConnectionStateEvent(state, {
      getConnectionState,
      getReconnectUiState,
      setReconnectUiState: setReconnectUiStateRef,
      setConnectionState: (value) => {
        setConnectionStateRef(value);
        setConnectionState(value);
      },
      setRecoveryNotice,
    });
  });

  const offReconnect = eventBus.onReconnect(() => {
    backendHealth.reportSuccess();
    handleSocketReconnect({
      cliChild: cliChildDeps,
      setStreaming,
      setAwaitingFirstChunk,
      clearToolArgProgressTracking,
      clearToolActivities,
      removeActiveAgentLoop,
      setPendingConfirmation,
      setActiveSession,
      setSessions,
      getActiveSessionId: () => useSessionStore.getState().activeSessionId,
      getSessionMessages: (sessionId) => useSessionStore.getState().getSessionMessages(sessionId),
      setMessages,
      setAgentTurns,
      hasActiveLoopForSession: (sessionId) => useAgentStore.getState().hasActiveLoopForSession(sessionId),
      fetchSessions: async () => {
        const response = await apiClient.get<ChatSession[]>('/api/sessions');
        return response.data;
      },
      fetchMessages: async (sessionId) => {
        const response = await apiClient.get<ChatMessage[]>(`/api/sessions/${sessionId}/messages`);
        return response.data;
      },
      onContextInvalidated,
    });
  });

  return () => {
    offConnectionState();
    offReconnect();
  };
}
