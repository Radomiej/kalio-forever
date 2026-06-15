import type { RefObject } from 'react';
import type { ChatMessage, SocketEvents } from '@kalio/types';
import type { ChatConnectionState } from '../ChatInterface.Parts';

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

interface LiveSessionStatusMaterializationDeps {
  hasActiveLoopForSession: (sessionId: string) => boolean;
  getSessionActiveTurnId: (sessionId: string) => string | null;
  addActiveAgentLoop: (sessionId: string, turnId: string) => void;
  startAgentTurn: (turnId: string, sessionId: string) => void;
  setAwaitingFirstChunk?: (value: boolean) => void;
  setStreaming?: (value: boolean, messageId?: string, sessionId?: string | null) => void;
}

export function materializeLiveTurnFromSessionStatusSnapshot(
  snapshot: SocketEvents['session:status'] | undefined,
  deps: LiveSessionStatusMaterializationDeps,
): void {
  if (!snapshot?.active || !snapshot.turnId) {
    return;
  }

  if (!deps.hasActiveLoopForSession(snapshot.sessionId)) {
    deps.addActiveAgentLoop(snapshot.sessionId, snapshot.turnId);
  }
  if (deps.getSessionActiveTurnId(snapshot.sessionId) !== snapshot.turnId) {
    deps.startAgentTurn(snapshot.turnId, snapshot.sessionId);
  }
  deps.setAwaitingFirstChunk?.(false);
  deps.setStreaming?.(true, undefined, snapshot.sessionId);
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
    materializeLiveTurnFromSessionStatusSnapshot(payload, deps);
  }
}

export function handleConnectionStateEvent(
  state: { status: ChatConnectionState; recovered?: boolean },
  deps: {
    getConnectionState: () => ChatConnectionState;
    setConnectionState: (value: ChatConnectionState) => void;
    setRecoveryNotice: (value: string) => void;
  },
): void {
  const previousState = deps.getConnectionState();
  deps.setConnectionState(state.status);
  if (state.status === 'connected') {
    if (
      state.recovered
      && (previousState === 'reconnecting' || previousState === 'disconnected')
    ) {
      deps.setRecoveryNotice('Recovered missed stream events after reconnect.');
    }
    return;
  }
  if (state.status === 'reconnecting') {
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
