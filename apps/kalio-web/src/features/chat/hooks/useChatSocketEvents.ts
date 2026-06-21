import { useEffect, useRef, type RefObject } from 'react';
import { nanoid } from 'nanoid';
import type { ChatMessage } from '@kalio/types';
import { useAgentStore } from '../../../store/agentStore';
import { useSessionStore } from '../../../store/sessionStore';
import { eventBus } from '../../../services/eventBus';
import { identifyWatchedSession } from '../../../services/sessionWatchRegistry';
import { shouldRefreshVfsForToolResult } from '../ChatInterface.Parts';
import type { ChatConnectionState } from '../ChatInterface.Parts';
import {
  canReleaseComposerAfterToolResult,
  createToolArgProgressHandlers,
  mergeRaAppNativeResultIntoMessages,
  type ReconnectUiState,
} from './useChatSocketEvents.helpers';
import {
  handleCliChildProgress,
  handleCliChildToolResult,
  isCliChildToolName,
  resolveCliToolName,
} from './useChatSocketEvents.cliChild';
import { registerConnectionRecoveryHandlers, registerSessionLifecycleHandlers } from './useChatSocketEvents.lifecycle';

interface UseChatSocketEventsOptions {
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

export function useChatSocketEvents({
  hasPendingChunksForSession,
  requestGeneratedTitleIfNeeded,
  setAwaitingFirstChunk,
  setConnectionState,
  setError,
  setRecoveryNotice,
  setVfsRefreshSignal,
  toolArgProgressSeenRef,
  onContextInvalidated,
}: UseChatSocketEventsOptions): void {
  const connectionStateRef = useRef<ChatConnectionState>(eventBus.connected ? 'connected' : 'connecting');
  const reconnectUiStateRef = useRef<ReconnectUiState>({
    hasConnectedOnce: eventBus.connected,
    hadRealDisconnect: false,
  });
  const {
    setSessions,
    setActiveSession,
    appendChunk,
    finalizeChunk,
    addMessage,
    startAgentTurn,
    finalizeAgentTurn,
    markAgentTurnError,
    removeLastAgentTurn,
    flushThinkingChunks,
    flushStreamingChunks,
    setMessages,
    setAgentTurns,
  } = useSessionStore();
  const {
    setPendingConfirmation,
    setPendingBudgetApproval,
    removePendingConfirmation,
    removePendingBudgetApproval,
    setToolArgProgress,
    addToolActivity,
    updateToolActivity,
    clearToolActivities,
    setContext,
    registerCallId,
    addActiveAgentLoop,
    removeActiveAgentLoop,
    appendCLIAgentChunk,
    clearCLIAgentOutput,
    getToolActivitiesForSession,
    setStreaming,
    upsertCLIChildProjection,
    updateCLIChildProjection,
    rebuildCLIChildProjections,
    setQueuedDepth,
    recordSessionStatusSnapshot,
    setRuntimeActivitySnapshot,
    clearBufferedSessionStatusSnapshots,
  } = useAgentStore();
  const { addSession } = useSessionStore();

  useEffect(() => {
    if (!eventBus.connected) eventBus.connect();

    const { markToolArgProgressSeen, clearToolArgProgressTracking, ensureSyntheticToolIntent } = createToolArgProgressHandlers({
      toolArgProgressSeenRef,
      setToolArgProgress,
      getActiveSessionId: () => useSessionStore.getState().activeSessionId,
    });

    const cliChildDeps = {
      upsertCLIChildProjection,
      updateCLIChildProjection,
      rebuildCLIChildProjections,
      appendCLIAgentChunk,
      registerCallId,
      getAgentState: () => useAgentStore.getState(),
      getSessionState: () => useSessionStore.getState(),
      identifySession: (sessionId: string) => identifyWatchedSession(sessionId, 'cli-child-runtime', { sticky: true }),
    };

    const offChunk = eventBus.onChunk((chunk) => {
      const targetSessionId = chunk.sessionId ?? useSessionStore.getState().activeSessionId;

      if (!chunk.done) {
        if (targetSessionId === useSessionStore.getState().activeSessionId) {
          setAwaitingFirstChunk(false);
        }
        appendChunk(chunk.messageId, chunk.delta, chunk.thinking, chunk.sessionId);

        if (targetSessionId) {
          const { getSessionActiveTurnId, getSessionAgentTurns, addTurnItem } = useSessionStore.getState();
          const currentTurnId = getSessionActiveTurnId(targetSessionId);
          if (currentTurnId) {
            const turn = getSessionAgentTurns(targetSessionId).find((item) => item.id === currentTurnId);
            if (turn) {
              const hasItem = turn.items.some(
                (item) => item.kind === (chunk.thinking ? 'thinking' : 'text') && item.messageId === chunk.messageId,
              );
              if (!hasItem) {
                addTurnItem({ kind: chunk.thinking ? 'thinking' : 'text', messageId: chunk.messageId }, targetSessionId);
              }
            }
          }
        }
      } else {
        if (chunk.sessionId === useSessionStore.getState().activeSessionId) {
          setAwaitingFirstChunk(false);
        }
        finalizeChunk(chunk.messageId);
        setStreaming(false, undefined, chunk.sessionId);
      }
    });

    const offComplete = eventBus.onComplete((payload) => {
      console.debug('[EventBus] chat:complete', payload.messageId);
      if (payload.sessionId === useSessionStore.getState().activeSessionId) {
        setAwaitingFirstChunk(false);
      }
      const { streamingChunks, thinkingChunks, finalizeChunk, chunkSessionIds } = useSessionStore.getState();
      const ids = new Set([...Object.keys(streamingChunks), ...Object.keys(thinkingChunks)]);
      ids.forEach((id) => {
        if (!chunkSessionIds[id] || chunkSessionIds[id] === payload.sessionId) finalizeChunk(id);
      });
      setStreaming(false, undefined, payload.sessionId);
      if (payload.sessionId === useSessionStore.getState().activeSessionId) {
        requestGeneratedTitleIfNeeded(payload.sessionId);
      }
      onContextInvalidated?.();
    });

    const offError = eventBus.onError((payload) => {
      if (payload.code === 'INTERRUPTED') {
        console.debug('[EventBus] chat:error', payload);
      } else {
        console.error('[EventBus] chat:error', payload);
      }
      if (payload.sessionId === useSessionStore.getState().activeSessionId) {
        setAwaitingFirstChunk(false);
      }
      const { activeSessionId: currentActiveSessionId, getSessionActiveTurnId } = useSessionStore.getState();
      setStreaming(false, undefined, payload.sessionId ?? currentActiveSessionId);
      const targetSessionId = payload.sessionId ?? currentActiveSessionId;
      if (targetSessionId) {
        clearToolArgProgressTracking(targetSessionId);
        removeActiveAgentLoop(targetSessionId);
        setPendingConfirmation(targetSessionId, null);
        setPendingBudgetApproval?.(targetSessionId, null);

        const terminalToolStatus = payload.code === 'INTERRUPTED' ? 'cancelled' : 'error';
        const finishedAt = Date.now();
        const activeActivities = getToolActivitiesForSession(targetSessionId).filter(
          (activity) => activity.status === 'running' || activity.status === 'awaiting_confirmation',
        );

        activeActivities.forEach((activity) => {
          updateToolActivity(activity.callId, {
            status: terminalToolStatus,
            finishedAt,
            result: {
              callId: activity.callId,
              status: terminalToolStatus,
              ...(terminalToolStatus === 'error'
                ? { errorCode: payload.code, errorMessage: payload.message }
                : {}),
            },
          });
        });
      }

      const activeTurnId = targetSessionId ? getSessionActiveTurnId(targetSessionId) : null;
      if (!activeTurnId) {
        if (targetSessionId === currentActiveSessionId) {
          setError(payload.message);
        }
      } else if (payload.hadContent) {
        markAgentTurnError(activeTurnId, { code: payload.code, message: payload.message }, targetSessionId);
      } else if (payload.code === 'INTERRUPTED') {
        removeLastAgentTurn(targetSessionId);
      } else {
        removeLastAgentTurn(targetSessionId);
        if (targetSessionId === currentActiveSessionId) {
          setError(payload.message);
        }
      }
    });

    const offConfirmation = eventBus.onToolConfirmation((req) => {
      setPendingConfirmation(req.sessionId, req);
      ensureSyntheticToolIntent(req.sessionId, req.toolName);
      addToolActivity({
        callId: req.toolCallId,
        requestId: req.requestId,
        toolName: req.toolName,
        args: req.args,
        sessionId: req.sessionId,
        agentRun: req.agentRun,
        status: 'awaiting_confirmation',
        startedAt: Date.now(),
      });
    });

    const offBudgetRequired = eventBus.onAgentBudgetRequired?.((req) => {
      setPendingBudgetApproval?.(req.sessionId, req);
    });

    const offConfirmationInvalidated = eventBus.onToolConfirmationInvalidated((payload) => {
      const agentState = useAgentStore.getState();
      const pendingConfirmation = (agentState.pendingConfirmations[payload.sessionId] ?? [])
        .find((pending) => pending.requestId === payload.requestId);
      const staleActivity = agentState
        .getToolActivitiesForSession(payload.sessionId)
        .find((activity) => activity.requestId === payload.requestId);
      const targetCallId = payload.toolCallId
        ?? (pendingConfirmation?.requestId === payload.requestId
          ? pendingConfirmation.toolCallId
          : staleActivity?.callId ?? payload.requestId);
      removePendingConfirmation(payload.sessionId, payload.requestId);
      if (payload.reason !== 'confirmed') {
        clearToolArgProgressTracking(payload.sessionId);
      }
      if (payload.reason === 'confirmed') {
        updateToolActivity(targetCallId, {
          status: 'running',
          finishedAt: undefined,
          result: undefined,
        });
        return;
      }
      updateToolActivity(targetCallId, {
        status: payload.reason === 'cancelled' ? 'cancelled' : 'expired',
        finishedAt: Date.now(),
        result: {
          callId: targetCallId,
          status: 'cancelled',
          ...(payload.message ? { errorMessage: payload.message } : {}),
        },
      });
    });

    const offBudgetInvalidated = eventBus.onAgentBudgetInvalidated?.((payload) => {
      removePendingBudgetApproval?.(payload.sessionId, payload.requestId);
    });

    const offToolStart = eventBus.onToolStart((payload) => {
      const payloadSessionId = payload.sessionId ?? useSessionStore.getState().activeSessionId;
      ensureSyntheticToolIntent(payloadSessionId, payload.toolName);
      flushThinkingChunks(payloadSessionId);
      flushStreamingChunks(payloadSessionId);
      registerCallId(payload.callId, payload.toolName);
      addToolActivity({
        callId: payload.callId,
        toolName: payload.toolName,
        args: payload.args,
        sessionId: payloadSessionId ?? undefined,
        agentRun: payload.agentRun,
        status: 'running',
        startedAt: Date.now(),
      });
      if (payloadSessionId) {
        const { getSessionActiveTurnId, getSessionAgentTurns, addTurnItem } = useSessionStore.getState();
        const currentTurnId = getSessionActiveTurnId(payloadSessionId);
        if (currentTurnId) {
          const turn = getSessionAgentTurns(payloadSessionId).find((item) => item.id === currentTurnId);
          const hasItem = turn?.items.some((item) => item.kind === 'tool' && item.callId === payload.callId) ?? false;
          if (!hasItem) {
            addTurnItem({ kind: 'tool', callId: payload.callId }, payloadSessionId);
          }
        }
      }
      clearToolArgProgressTracking(payloadSessionId);
    });

    const offToolArgProgress = eventBus.onToolArgProgress((payload) => {
      markToolArgProgressSeen(payload.sessionId, payload.toolName);
      if (payload.sessionId !== useSessionStore.getState().activeSessionId) {
        return;
      }
      setToolArgProgress({
        toolName: payload.toolName,
        totalChars: payload.totalChars,
        charsPerSec: payload.charsPerSec,
      });
    });

    const offAgentStart = eventBus.onAgentStart((payload) => {
      clearToolArgProgressTracking(payload.sessionId);
      addActiveAgentLoop(payload.sessionId, payload.turnId, payload.agentRun);
      startAgentTurn(payload.turnId, payload.sessionId, payload.agentRun);
      clearToolActivities(payload.sessionId);
      setPendingConfirmation(payload.sessionId, null);
      setPendingBudgetApproval?.(payload.sessionId, null);
      setQueuedDepth(payload.sessionId, 0);
      if (payload.sessionId === useSessionStore.getState().activeSessionId) {
        setAwaitingFirstChunk(true);
        setStreaming(true, undefined, payload.sessionId);
      }
    });

    const offAgentDone = eventBus.onAgentDone((payload) => {
      removeActiveAgentLoop(payload.sessionId, payload.agentRun);
      clearToolArgProgressTracking(payload.sessionId);
      finalizeAgentTurn(payload.sessionId);
      if (hasPendingChunksForSession(payload.sessionId)) {
        flushThinkingChunks(payload.sessionId);
        flushStreamingChunks(payload.sessionId);
      }
      setStreaming(false, undefined, payload.sessionId);
      if (payload.sessionId === useSessionStore.getState().activeSessionId) {
        setAwaitingFirstChunk(false);
      }
      setPendingConfirmation(payload.sessionId, null);
      setPendingBudgetApproval?.(payload.sessionId, null);
    });

    const offContext = eventBus.onContext((payload) => {
      setContext(payload.systemPrompt, payload.toolNames, payload.sessionId);
      onContextInvalidated?.();
    });

    const offToolResult = eventBus.onToolResult((result) => {
      const activeSessionId = useSessionStore.getState().activeSessionId;
      const resultSessionId = result.sessionId ?? activeSessionId;
      clearToolArgProgressTracking(resultSessionId);
      updateToolActivity(result.callId, {
        status: result.status === 'success' ? 'success' : result.status === 'cancelled' ? 'cancelled' : 'error',
        finishedAt: Date.now(),
        result,
      });
      const agentState = useAgentStore.getState();
      const toolName = resolveCliToolName(result, agentState.callIdToName, agentState.toolActivities);
      handleCliChildToolResult(cliChildDeps, result, resultSessionId);
      clearCLIAgentOutput(result.callId);
      if (result.status === 'success') {
        if (shouldRefreshVfsForToolResult(toolName, result.data)) setVfsRefreshSignal((value) => value + 1);
      }
      if (result.data !== undefined && resultSessionId && toolName && (result.status === 'success' || isCliChildToolName(toolName))) {
        const content = toolName && isCliChildToolName(toolName) && result.data && typeof result.data === 'object' && !Array.isArray(result.data)
          ? JSON.stringify({
              ...(result.data as Record<string, unknown>),
              toolResultStatus: result.status,
              ...(result.errorCode ? { toolResultErrorCode: result.errorCode } : {}),
              ...(result.errorMessage ? { toolResultErrorMessage: result.errorMessage } : {}),
            })
          : JSON.stringify(result.data);
        const toolResultMsg: ChatMessage = {
          id: nanoid(),
          sessionId: resultSessionId,
          role: 'tool_result',
          content,
          toolCallId: result.callId,
          createdAt: Date.now(),
        };
        addMessage(toolResultMsg);
      }
      onContextInvalidated?.();
      if (
        resultSessionId === activeSessionId
        && canReleaseComposerAfterToolResult({
          hasActiveTurn: Boolean(useSessionStore.getState().getSessionActiveTurnId(resultSessionId)),
          hasActiveLoop: useAgentStore.getState().hasActiveLoopForSession(resultSessionId),
          hasActiveTool: useAgentStore.getState().getToolActivitiesForSession(resultSessionId).some(
            (activity) => activity.status === 'running' || activity.status === 'awaiting_confirmation',
          ),
          hasPendingChunks: hasPendingChunksForSession(resultSessionId),
        })
      ) {
        setStreaming(false, undefined, resultSessionId);
      }
    });

    const offCLIAgentProgress = eventBus.onCLIAgentProgress((payload) => {
      handleCliChildProgress(cliChildDeps, payload);
    });

    const offSessionLifecycle = registerSessionLifecycleHandlers({
      cliChildDeps,
      addSession,
      setRecoveryNotice,
      addActiveAgentLoop,
      startAgentTurn,
      setAwaitingFirstChunk,
      setStreaming,
      setQueuedDepth,
      recordSessionStatusSnapshot,
      setRuntimeActivitySnapshot,
      clearBufferedSessionStatusSnapshots,
    });

    const offRaAppNative = eventBus.onRaAppNativeResult((payload) => {
      const targetSessionId = payload.sessionId;
      if (!targetSessionId) return;
      const { getSessionMessages, setMessages: applySessionMessages } = useSessionStore.getState();
      applySessionMessages(
        mergeRaAppNativeResultIntoMessages(getSessionMessages(targetSessionId), payload.toolCallId, payload.results),
        targetSessionId,
      );
    });

    const offConnectionRecovery = registerConnectionRecoveryHandlers({
      cliChildDeps,
      getConnectionState: () => connectionStateRef.current,
      getReconnectUiState: () => reconnectUiStateRef.current,
      setReconnectUiStateRef: (value) => {
        reconnectUiStateRef.current = value;
      },
      setConnectionStateRef: (value) => {
        connectionStateRef.current = value;
      },
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
    });

    return () => {
      offChunk();
      offComplete();
      offError();
      offConfirmation();
      offBudgetRequired?.();
      offConfirmationInvalidated();
      offBudgetInvalidated?.();
      offToolStart();
      offToolArgProgress();
      offAgentStart();
      offAgentDone();
      offContext();
      offToolResult();
      offCLIAgentProgress();
      offSessionLifecycle();
      offRaAppNative();
      offConnectionRecovery();
    };
  }, [
    addActiveAgentLoop,
    addMessage,
    addSession,
    addToolActivity,
    appendChunk,
    appendCLIAgentChunk,
    clearCLIAgentOutput,
    clearToolActivities,
    finalizeAgentTurn,
    finalizeChunk,
    flushStreamingChunks,
    flushThinkingChunks,
    setMessages,
    setAgentTurns,
    getToolActivitiesForSession,
    hasPendingChunksForSession,
    markAgentTurnError,
    registerCallId,
    rebuildCLIChildProjections,
    removeActiveAgentLoop,
    removeLastAgentTurn,
    requestGeneratedTitleIfNeeded,
    onContextInvalidated,
    setAwaitingFirstChunk,
    setConnectionState,
    setContext,
    setError,
    setPendingConfirmation,
    setPendingBudgetApproval,
    setQueuedDepth,
    recordSessionStatusSnapshot,
    setRuntimeActivitySnapshot,
    clearBufferedSessionStatusSnapshots,
    setRecoveryNotice,
    setStreaming,
    setToolArgProgress,
    setVfsRefreshSignal,
    startAgentTurn,
    toolArgProgressSeenRef,
    updateCLIChildProjection,
    updateToolActivity,
    upsertCLIChildProjection,
  ]);
}
