import type { RefObject } from 'react';
import { nanoid } from 'nanoid';
import type { ChatMessage, RuntimeActivitySnapshot, SocketEvents, ToolConfirmationRequest } from '@kalio/types';
import type { ChatConnectionState } from '../ChatInterface.Parts';

export interface ReconnectUiState {
  hasConnectedOnce: boolean;
  hadRealDisconnect: boolean;
}

export interface UseChatSocketEventsOptions {
  hasPendingChunksForSession: (sessionId: string | null) => boolean;
  requestGeneratedTitleIfNeeded: (sessionId: string | null) => void;
  setAwaitingFirstChunk: (value: boolean) => void;
  setConnectionState: (value: ChatConnectionState) => void;
  setError: (value: string | null) => void;
  setRecoveryNotice: (value: string | null) => void;
  setVfsRefreshSignal: (updater: (value: number) => number) => void;
  toolArgProgressSeenRef: RefObject<Record<string, Set<string>>>;
  onContextInvalidated?: () => void;
}

type ToolArgProgress = { toolName: string; totalChars: number; charsPerSec: number };

interface ToolArgProgressHandlersOptions {
  toolArgProgressSeenRef: RefObject<Record<string, Set<string>>>;
  setToolArgProgress: (progress: ToolArgProgress | null) => void;
  getActiveSessionId: () => string | null;
}

export function createToolArgProgressHandlers({
  toolArgProgressSeenRef,
  setToolArgProgress,
  getActiveSessionId,
}: ToolArgProgressHandlersOptions) {
  const markToolArgProgressSeen = (sessionId: string, toolName: string) => {
    const seenForSession = toolArgProgressSeenRef.current[sessionId] ?? new Set<string>();
    seenForSession.add(toolName);
    toolArgProgressSeenRef.current[sessionId] = seenForSession;
  };

  const clearToolArgProgressTracking = (sessionId?: string | null) => {
    if (!sessionId) {
      toolArgProgressSeenRef.current = {};
      setToolArgProgress(null);
      return;
    }
    delete toolArgProgressSeenRef.current[sessionId];
    if (sessionId === getActiveSessionId()) {
      setToolArgProgress(null);
    }
  };

  const ensureSyntheticToolIntent = (sessionId: string | null | undefined, toolName: string) => {
    if (!sessionId || sessionId !== getActiveSessionId()) {
      return;
    }
    if (toolArgProgressSeenRef.current[sessionId]?.has(toolName)) {
      return;
    }
    setToolArgProgress({ toolName, totalChars: 0, charsPerSec: 0 });
  };

  return {
    markToolArgProgressSeen,
    clearToolArgProgressTracking,
    ensureSyntheticToolIntent,
  };
}

interface ComposerReleaseState {
  hasActiveTurn: boolean;
  hasActiveLoop: boolean;
  hasActiveTool: boolean;
  hasPendingChunks: boolean;
}

export function canReleaseComposerAfterToolResult({
  hasActiveTurn,
  hasActiveLoop,
  hasActiveTool,
  hasPendingChunks,
}: ComposerReleaseState): boolean {
  if (!hasActiveTurn) {
    return true;
  }

  return !hasActiveLoop && !hasActiveTool && !hasPendingChunks;
}

export function findPendingConfirmationForToolResult(params: {
  callId: string;
  sessionId?: string | null;
  pendingConfirmations: Record<string, ToolConfirmationRequest[]>;
}): ToolConfirmationRequest | null {
  const sessionEntries = params.sessionId
    ? [[params.sessionId, params.pendingConfirmations[params.sessionId] ?? []] as const]
    : Object.entries(params.pendingConfirmations);

  for (const [, confirmations] of sessionEntries) {
    const match = confirmations.find((confirmation) => confirmation.toolCallId === params.callId);
    if (match) {
      return match;
    }
  }

  return null;
}

export function createToolResultMessage(params: {
  result: SocketEvents['tool:result'];
  resultSessionId?: string | null;
  toolName?: string | null;
  isCliChildToolName: (toolName: string) => boolean;
}): ChatMessage | null {
  const { result, resultSessionId, toolName } = params;
  if (result.data === undefined || !resultSessionId || !toolName) {
    return null;
  }

  const content = params.isCliChildToolName(toolName) && result.data && typeof result.data === 'object' && !Array.isArray(result.data)
    ? JSON.stringify({
        ...(result.data as Record<string, unknown>),
        toolResultStatus: result.status,
        ...(result.errorCode ? { toolResultErrorCode: result.errorCode } : {}),
        ...(result.errorMessage ? { toolResultErrorMessage: result.errorMessage } : {}),
      })
    : JSON.stringify(result.data);

  return {
    id: nanoid(),
    sessionId: resultSessionId,
    role: 'tool_result',
    content,
    toolCallId: result.callId,
    createdAt: Date.now(),
  };
}

interface LiveSessionStatusMaterializationDeps {
  hasActiveLoopForSession: (sessionId: string) => boolean;
  getSessionActiveTurnId: (sessionId: string) => string | null;
  addActiveAgentLoop: (sessionId: string, turnId: string) => void;
  startAgentTurn: (turnId: string, sessionId: string) => void;
  getActiveSessionId?: () => string | null;
  removeActiveAgentLoop?: (sessionId: string) => void;
  setAwaitingFirstChunk?: (value: boolean) => void;
  setStreaming?: (value: boolean, messageId?: string, sessionId?: string | null) => void;
}

function materializeLiveTurn(
  sessionId: string,
  turnId: string,
  deps: LiveSessionStatusMaterializationDeps,
): void {
  if (!deps.hasActiveLoopForSession(sessionId)) {
    deps.addActiveAgentLoop(sessionId, turnId);
  }
  if (deps.getSessionActiveTurnId(sessionId) !== turnId) {
    deps.startAgentTurn(turnId, sessionId);
  }
  deps.setAwaitingFirstChunk?.(false);
  deps.setStreaming?.(true, undefined, sessionId);
}

function releaseLiveTurn(
  sessionId: string,
  deps: LiveSessionStatusMaterializationDeps,
): void {
  deps.removeActiveAgentLoop?.(sessionId);
  deps.setStreaming?.(false, undefined, sessionId);
  if (deps.getActiveSessionId?.() === sessionId) {
    deps.setAwaitingFirstChunk?.(false);
  }
}

export function sessionStatusKeepsSessionLive(
  snapshot: SocketEvents['session:status'],
): boolean {
  const runStatus = snapshot.run?.status as string | undefined;
  return snapshot.active
    || (snapshot.queueLength ?? 0) > 0
    || runStatus === 'active'
    || runStatus === 'waiting_on_orchestrator';
}

export function runtimeSnapshotKeepsSessionLive(
  snapshot: RuntimeActivitySnapshot,
): boolean {
  const runStatus = snapshot.run?.status as string | undefined;
  return snapshot.active
    || runStatus === 'active'
    || runStatus === 'waiting_on_orchestrator'
    || snapshot.queueLength > 0
    || snapshot.toolActivities.some((activity) => (
      activity.status === 'running' || activity.status === 'pending_confirmation'
    ))
    || snapshot.childExecutions.some((execution) => (
      execution.status === 'running' || execution.status === 'waiting'
    ));
}

export function materializeLiveTurnFromSessionStatusSnapshot(
  snapshot: SocketEvents['session:status'] | undefined,
  deps: LiveSessionStatusMaterializationDeps,
): void {
  if (!snapshot?.active || !snapshot.turnId) {
    return;
  }

  materializeLiveTurn(snapshot.sessionId, snapshot.turnId, deps);
}

export function materializeLiveTurnFromRuntimeActivitySnapshot(
  snapshot: RuntimeActivitySnapshot | null | undefined,
  deps: LiveSessionStatusMaterializationDeps,
): void {
  if (!snapshot?.turnId || !runtimeSnapshotKeepsSessionLive(snapshot)) {
    return;
  }

  materializeLiveTurn(snapshot.sessionId, snapshot.turnId, deps);
}

export function selectReplayableSessionStatusSnapshot(
  bufferedSnapshots: SocketEvents['session:status'][],
  latestSnapshot: SocketEvents['session:status'] | undefined,
): SocketEvents['session:status'] | undefined {
  const orderedSnapshots = bufferedSnapshots.length > 0
    ? bufferedSnapshots
    : (latestSnapshot ? [latestSnapshot] : []);
  const finalSnapshot = orderedSnapshots[orderedSnapshots.length - 1];
  if (!finalSnapshot?.active || !finalSnapshot.turnId) {
    return undefined;
  }
  return finalSnapshot;
}

export function materializeLiveTurnFromHydratedRuntimeState(
  params: {
    runtimeSnapshot: RuntimeActivitySnapshot | null | undefined;
    bufferedSessionStatusSnapshots: SocketEvents['session:status'][];
    latestSessionStatusSnapshot: SocketEvents['session:status'] | undefined;
  },
  deps: LiveSessionStatusMaterializationDeps,
): void {
  if (params.runtimeSnapshot) {
    materializeLiveTurnFromRuntimeActivitySnapshot(params.runtimeSnapshot, deps);
    return;
  }

  materializeLiveTurnFromSessionStatusSnapshot(
    selectReplayableSessionStatusSnapshot(
      params.bufferedSessionStatusSnapshots,
      params.latestSessionStatusSnapshot,
    ),
    deps,
  );
}

export function handleSessionStatusEvent(
  payload: SocketEvents['session:status'],
  deps: {
    getActiveSessionId: () => string | null;
    isSessionHydrated: (sessionId: string) => boolean;
    hasActiveLoopForSession: (sessionId: string) => boolean;
    getSessionActiveTurnId: (sessionId: string) => string | null;
    setRecoveryNotice: (value: string) => void;
    addActiveAgentLoop: (sessionId: string, turnId: string) => void;
    startAgentTurn: (turnId: string, sessionId: string) => void;
    removeActiveAgentLoop: (sessionId: string) => void;
    setAwaitingFirstChunk: (value: boolean) => void;
    setStreaming: (value: boolean, messageId?: string, sessionId?: string | null) => void;
    recordSessionStatusSnapshot: (snapshot: SocketEvents['session:status']) => void;
    clearBufferedSessionStatusSnapshots: (sessionId: string) => void;
  },
): void {
  deps.recordSessionStatusSnapshot(payload);

  if (payload.run?.status === 'interrupted_needs_retry' && payload.sessionId === deps.getActiveSessionId()) {
    deps.setRecoveryNotice(
      payload.run.safeResume
        ? 'Backend restarted during LLM work. Retry is safe from the current transcript.'
        : 'Backend restarted during tool execution. Manual retry avoids duplicate tool execution.',
    );
  }

  if (
    payload.sessionId === deps.getActiveSessionId()
    && deps.isSessionHydrated(payload.sessionId)
  ) {
    deps.clearBufferedSessionStatusSnapshots(payload.sessionId);
    if (sessionStatusKeepsSessionLive(payload)) {
      materializeLiveTurnFromSessionStatusSnapshot(payload, deps);
      return;
    }
    releaseLiveTurn(payload.sessionId, deps);
  }
}

export function handleConnectionStateEvent(
  state: { status: ChatConnectionState; recovered?: boolean },
  deps: {
    getConnectionState: () => ChatConnectionState;
    getReconnectUiState: () => ReconnectUiState;
    setReconnectUiState: (value: ReconnectUiState) => void;
    setConnectionState: (value: ChatConnectionState) => void;
    setRecoveryNotice: (value: string) => void;
  },
): void {
  const previousState = deps.getConnectionState();
  const reconnectUiState = deps.getReconnectUiState();
  let nextReconnectUiState = reconnectUiState;

  deps.setConnectionState(state.status);

  if (state.status === 'connected') {
    if (
      state.recovered
      && reconnectUiState.hasConnectedOnce
      && reconnectUiState.hadRealDisconnect
      && (previousState === 'reconnecting' || previousState === 'disconnected')
    ) {
      deps.setRecoveryNotice('Recovered missed stream events after reconnect.');
    }
    nextReconnectUiState = {
      hasConnectedOnce: true,
      hadRealDisconnect: false,
    };
    deps.setReconnectUiState(nextReconnectUiState);
    return;
  }

  if (
    (state.status === 'reconnecting' || state.status === 'disconnected')
    && reconnectUiState.hasConnectedOnce
  ) {
    nextReconnectUiState = {
      hasConnectedOnce: true,
      hadRealDisconnect: true,
    };
    deps.setReconnectUiState(nextReconnectUiState);
  }

  if (state.status === 'reconnecting' && reconnectUiState.hasConnectedOnce) {
    deps.setRecoveryNotice('Connection dropped. Reconnecting and preserving this session.');
  }
}

export function mergeRaAppNativeResultIntoMessages(
  messages: ChatMessage[],
  toolCallId: string,
  results: unknown,
): ChatMessage[] {
  return messages.map((message) => {
    if (message.toolCallId !== toolCallId || message.role !== 'tool_result') return message;
    try {
      const data = JSON.parse(message.content) as Record<string, unknown>;
      return {
        ...message,
        content: JSON.stringify({ ...data, nativeResults: results, pendingApprovals: [] }),
      };
    } catch (err) {
      console.error('[ChatInterface] failed to merge RA-App native result', err instanceof Error ? err : new Error(String(err)));
      return message;
    }
  });
}
