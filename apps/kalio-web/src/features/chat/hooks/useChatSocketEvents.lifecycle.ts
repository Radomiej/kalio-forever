import type { ChatSession } from '@kalio/types';
import { useAgentStore } from '../../../store/agentStore';
import { useSessionStore } from '../../../store/sessionStore';
import { apiClient } from '../../../services/apiClient';
import { backendHealth } from '../../../services/backendHealth';
import { eventBus } from '../../../services/eventBus';
import { identifyWatchedSession } from '../../../services/sessionWatchRegistry';
import type { ChatConnectionState } from '../ChatInterface.Parts';
import {
  handleSessionStatusEvent,
  handleConnectionStateEvent,
  runtimeSnapshotKeepsSessionLive,
  type ReconnectUiState,
} from './useChatSocketEvents.helpers';
import { handleCliChildSessionCreated } from './useChatSocketEvents.cliChild';
import { handleSocketReconnect } from './useChatSocketEvents.reconnect';
import { DEFAULT_SESSION_HISTORY_LIMIT, fetchSessionHistoryWindow } from '../sessionHistoryApi';

type AgentStoreState = ReturnType<typeof useAgentStore.getState>;
type SessionStoreState = ReturnType<typeof useSessionStore.getState>;
type CliChildDeps = Parameters<typeof handleCliChildSessionCreated>[0];

export function reconnectSocketWhenBrowserOnline({
  isConnected,
  connect,
  isBrowserOnline = () => globalThis.navigator?.onLine !== false,
}: {
  isConnected: () => boolean;
  connect: () => void;
  isBrowserOnline?: () => boolean;
}): void {
  if (!isBrowserOnline() || isConnected()) {
    return;
  }
  connect();
}

export function registerSessionLifecycleHandlers({
  cliChildDeps,
  addSession,
  setRecoveryNotice,
  addActiveAgentLoop,
  removeActiveAgentLoop,
  startAgentTurn,
  finalizeAgentTurn,
  setAwaitingFirstChunk,
  setStreaming,
  setQueuedDepth,
  recordSessionStatusSnapshot,
  setRuntimeActivitySnapshot,
  clearBufferedSessionStatusSnapshots,
}: {
  cliChildDeps: CliChildDeps;
  addSession: SessionStoreState['addSession'];
  setRecoveryNotice: (value: string | null) => void;
  addActiveAgentLoop: AgentStoreState['addActiveAgentLoop'];
  removeActiveAgentLoop: AgentStoreState['removeActiveAgentLoop'];
  startAgentTurn: SessionStoreState['startAgentTurn'];
  finalizeAgentTurn: SessionStoreState['finalizeAgentTurn'];
  setAwaitingFirstChunk: (value: boolean) => void;
  setStreaming: AgentStoreState['setStreaming'];
  setQueuedDepth: AgentStoreState['setQueuedDepth'];
  recordSessionStatusSnapshot: AgentStoreState['recordSessionStatusSnapshot'];
  setRuntimeActivitySnapshot: AgentStoreState['setRuntimeActivitySnapshot'];
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
      removeActiveAgentLoop,
      startAgentTurn,
      finalizeAgentTurn,
      setAwaitingFirstChunk,
      setStreaming,
      recordSessionStatusSnapshot,
      clearBufferedSessionStatusSnapshots,
    });
  });

  const offRuntimeSnapshot = eventBus.onRuntimeActivitySnapshot((payload) => {
    setRuntimeActivitySnapshot(payload);
    if (!runtimeSnapshotKeepsSessionLive(payload)) {
      finalizeAgentTurn(payload.sessionId, payload.turnId);
      removeActiveAgentLoop(payload.sessionId);
      setStreaming(false, undefined, payload.sessionId);
      if (payload.sessionId === useSessionStore.getState().activeSessionId) {
        setAwaitingFirstChunk(false);
      }
    }
  });

  const offSessionCreated = eventBus.onSessionCreated((session) => {
    addSession(session);
    identifyWatchedSession(session.id, 'session-created', { sticky: true });
    handleCliChildSessionCreated(cliChildDeps, session);
  });

  const offSessionUpdated = eventBus.onSessionUpdated?.((session) => {
    addSession(session);
    identifyWatchedSession(session.id, 'session-updated', { sticky: true });
  });

  const offQueued = eventBus.onQueued((payload) => {
    setQueuedDepth(payload.sessionId, payload.queueLength);
  });

  return () => {
    offSessionStatus();
    offRuntimeSnapshot();
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
      setSessionHistoryMeta: (sessionId, meta) => useSessionStore.getState().setSessionHistoryMeta(sessionId, meta),
      setAgentTurns,
      hasActiveLoopForSession: (sessionId) => useAgentStore.getState().hasActiveLoopForSession(sessionId),
      fetchSessions: async () => {
        const response = await apiClient.get<ChatSession[]>('/api/sessions');
        return response.data;
      },
      fetchMessages: async (sessionId) => {
        return fetchSessionHistoryWindow(sessionId, { limit: DEFAULT_SESSION_HISTORY_LIMIT });
      },
      onContextInvalidated,
    });
  });
  const handleBrowserOnline = () => {
    reconnectSocketWhenBrowserOnline({
      isConnected: () => eventBus.connected,
      connect: () => eventBus.connect(),
    });
  };
  globalThis.addEventListener?.('online', handleBrowserOnline);
  const reconnectInterval = globalThis.setInterval?.(handleBrowserOnline, 2_000);

  return () => {
    offConnectionState();
    offReconnect();
    globalThis.removeEventListener?.('online', handleBrowserOnline);
    if (reconnectInterval !== undefined) {
      globalThis.clearInterval?.(reconnectInterval);
    }
  };
}
