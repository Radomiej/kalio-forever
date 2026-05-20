import { useEffect, type RefObject } from 'react';
import { nanoid } from 'nanoid';
import type { ChatMessage } from '@kalio/types';
import { useAgentStore } from '../../../store/agentStore';
import { useSessionStore } from '../../../store/sessionStore';
import { backendHealth } from '../../../services/backendHealth';
import { eventBus } from '../../../services/eventBus';
import { buildTurnsFromHistory, mergeFetchedMessages } from '../chatUtils';
import { shouldRefreshVfsForToolResult } from '../ChatInterface.Parts';
import type { ChatConnectionState } from '../ChatInterface.Parts';
import { canReleaseComposerAfterToolResult, createToolArgProgressHandlers } from './useChatSocketEvents.helpers';

interface UseChatSocketEventsOptions {
  hasPendingChunksForSession: (sessionId: string | null) => boolean;
  requestGeneratedTitleIfNeeded: (sessionId: string | null) => void;
  setAwaitingFirstChunk: (value: boolean) => void;
  setConnectionState: (value: ChatConnectionState) => void;
  setError: (value: string | null) => void;
  setRecoveryNotice: (value: string | null) => void;
  setVfsRefreshSignal: (updater: (value: number) => number) => void;
  toolArgProgressSeenRef: RefObject<Record<string, Set<string>>>;
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
}: UseChatSocketEventsOptions): void {
  const {
    appendChunk,
    finalizeChunk,
    addMessage,
    startAgentTurn,
    finalizeAgentTurn,
    markAgentTurnError,
    removeLastAgentTurn,
    flushThinkingChunks,
    flushStreamingChunks,
  } = useSessionStore();
  const {
    setPendingConfirmation,
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
  } = useAgentStore();
  const { addSession } = useSessionStore();

  useEffect(() => {
    if (!eventBus.connected) eventBus.connect();

    const { markToolArgProgressSeen, clearToolArgProgressTracking, ensureSyntheticToolIntent } = createToolArgProgressHandlers({
      toolArgProgressSeenRef,
      setToolArgProgress,
      getActiveSessionId: () => useSessionStore.getState().activeSessionId,
    });

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
        if (chunk.sessionId === useSessionStore.getState().activeSessionId) {
          setStreaming(false);
        }
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
      if (payload.sessionId === useSessionStore.getState().activeSessionId) {
        setStreaming(false);
        requestGeneratedTitleIfNeeded(payload.sessionId);
      }
    });

    const offError = eventBus.onError((payload) => {
      console.error('[EventBus] chat:error', payload);
      if (payload.sessionId === useSessionStore.getState().activeSessionId) {
        setAwaitingFirstChunk(false);
      }
      setStreaming(false);
      const { activeSessionId: currentActiveSessionId, getSessionActiveTurnId } = useSessionStore.getState();
      const targetSessionId = payload.sessionId ?? currentActiveSessionId;
      if (targetSessionId) {
        clearToolArgProgressTracking(targetSessionId);
        removeActiveAgentLoop(targetSessionId);
        setPendingConfirmation(targetSessionId, null);

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

    const offConfirmationInvalidated = eventBus.onToolConfirmationInvalidated((payload) => {
      const agentState = useAgentStore.getState();
      const pendingConfirmation = agentState.pendingConfirmations[payload.sessionId];
      const staleActivity = agentState
        .getToolActivitiesForSession(payload.sessionId)
        .find((activity) => activity.requestId === payload.requestId);
      const targetCallId = payload.toolCallId
        ?? (pendingConfirmation?.requestId === payload.requestId
          ? pendingConfirmation.toolCallId
          : staleActivity?.callId ?? payload.requestId);
      setPendingConfirmation(payload.sessionId, null);
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

    const offToolStart = eventBus.onToolStart((payload) => {
      console.log('[ToolStart]', payload.toolName, 'callId:', payload.callId, 'args:', payload.args);
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
      console.log('[AgentStart]', payload.sessionId, payload.turnId);
      clearToolArgProgressTracking(payload.sessionId);
      addActiveAgentLoop(payload.sessionId, payload.turnId, payload.agentRun);
      startAgentTurn(payload.turnId, payload.sessionId, payload.agentRun);
      clearToolActivities(payload.sessionId);
      setPendingConfirmation(payload.sessionId, null);
    });

    const offAgentDone = eventBus.onAgentDone((payload) => {
      console.log('[AgentDone]', payload.sessionId, payload.turnId);
      removeActiveAgentLoop(payload.sessionId, payload.agentRun);
      clearToolArgProgressTracking(payload.sessionId);
      finalizeAgentTurn(payload.sessionId);
      if (hasPendingChunksForSession(payload.sessionId)) {
        flushThinkingChunks(payload.sessionId);
        flushStreamingChunks(payload.sessionId);
      }
      if (payload.sessionId === useSessionStore.getState().activeSessionId) {
        setAwaitingFirstChunk(false);
        setStreaming(false);
      }
      setPendingConfirmation(payload.sessionId, null);
    });

    const offContext = eventBus.onContext((payload) => {
      setContext(payload.systemPrompt, payload.toolNames, payload.sessionId);
    });

    const offToolResult = eventBus.onToolResult((result) => {
      console.log('[ToolResult]', result.callId, 'status:', result.status, result.status !== 'success' ? `error: ${result.errorCode}` : '');
      const activeSessionId = useSessionStore.getState().activeSessionId;
      const resultSessionId = result.sessionId ?? activeSessionId;
      clearToolArgProgressTracking(resultSessionId);
      updateToolActivity(result.callId, {
        status: result.status === 'success' ? 'success' : result.status === 'cancelled' ? 'cancelled' : 'error',
        finishedAt: Date.now(),
        result,
      });
      clearCLIAgentOutput(result.callId);
      if (result.status === 'success') {
        const toolName = useAgentStore.getState().toolActivities.find((activity) => activity.callId === result.callId)?.toolName;
        if (shouldRefreshVfsForToolResult(toolName, result.data)) setVfsRefreshSignal((value) => value + 1);
      }
      if (result.status === 'success' && result.data !== undefined && resultSessionId) {
        const toolResultMsg: ChatMessage = {
          id: nanoid(),
          sessionId: resultSessionId,
          role: 'tool_result',
          content: JSON.stringify(result.data),
          toolCallId: result.callId,
          createdAt: Date.now(),
        };
        addMessage(toolResultMsg);
      }
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
        setStreaming(false);
      }
    });

    const offCLIAgentProgress = eventBus.onCLIAgentProgress((payload) => {
      appendCLIAgentChunk(payload.callId, payload.chunk);
    });

    const offSessionStatus = eventBus.onSessionStatus((payload) => {
      if (payload.run?.status === 'interrupted_needs_retry' && payload.sessionId === useSessionStore.getState().activeSessionId) {
        setRecoveryNotice(
          payload.run.safeResume
            ? 'Backend restarted during LLM work. Retry is safe from the current transcript.'
            : 'Backend restarted during tool execution. Manual retry avoids duplicate tool execution.',
        );
      }

      if (!payload.active || !payload.turnId) {
        return;
      }
      if (!useAgentStore.getState().hasActiveLoopForSession(payload.sessionId)) {
        addActiveAgentLoop(payload.sessionId, payload.turnId);
      }
      if (!useSessionStore.getState().getSessionActiveTurnId(payload.sessionId)) {
        startAgentTurn(payload.turnId, payload.sessionId);
      }
      if (payload.sessionId === useSessionStore.getState().activeSessionId) {
        setAwaitingFirstChunk(false);
        setStreaming(true);
      }
    });

    const offSessionCreated = eventBus.onSessionCreated((session) => {
      if (!useSessionStore.getState().sessions.some((item) => item.id === session.id)) {
        addSession(session);
      }
    });

    const offRaAppNative = eventBus.onRaAppNativeResult((payload) => {
      console.log('[RaAppNativeResult]', payload.toolCallId, payload.results);
      const sid = useSessionStore.getState().activeSessionId;
      if (!sid) return;
      const { messages, setMessages } = useSessionStore.getState();
      const updated = messages.map((message) => {
        if (message.toolCallId !== payload.toolCallId || message.role !== 'tool_result') return message;
        try {
          const data = JSON.parse(message.content) as Record<string, unknown>;
          return {
            ...message,
            content: JSON.stringify({ ...data, nativeResults: payload.results, pendingApprovals: [] }),
          };
        } catch (err) {
          console.error('[ChatInterface] failed to merge RA-App native result', err instanceof Error ? err : new Error(String(err)));
          return message;
        }
      });
      setMessages(updated);
    });

    const offConnectionState = eventBus.onConnectionState((state) => {
      setConnectionState(state.status);
      if (state.status === 'connected') {
        if (state.recovered) {
          setRecoveryNotice('Recovered missed stream events after reconnect.');
        }
        return;
      }
      if (state.status === 'reconnecting') {
        setRecoveryNotice('Connection dropped. Reconnecting and preserving this session.');
      }
    });

    const offReconnect = eventBus.onReconnect(() => {
      console.log('[ChatInterface] socket reconnected - resetting streaming state');
      backendHealth.reportSuccess();
      setStreaming(false);
      clearToolActivities();
      clearToolArgProgressTracking();
      const { activeSessionId: sid } = useSessionStore.getState();
      if (sid) {
        removeActiveAgentLoop(sid);
        setPendingConfirmation(sid, null);
        eventBus.identifySession(sid);
        fetch(`/api/sessions/${sid}/messages`)
          .then((response) => (response.ok ? response.json() : Promise.reject(response.status)))
          .then((data: ChatMessage[]) => {
            if (useSessionStore.getState().activeSessionId !== sid) return;
            const { setMessages, setAgentTurns } = useSessionStore.getState();
            const currentMessages = useSessionStore.getState().getSessionMessages(sid);
            const mergedMessages = mergeFetchedMessages(currentMessages, data);
            setMessages(mergedMessages);
            if (!useAgentStore.getState().hasActiveLoopForSession(sid)) {
              setAgentTurns(buildTurnsFromHistory(mergedMessages, sid));
            }
          })
          .catch((err: unknown) => {
            console.error('[ChatInterface] reconnect history reload failed', err instanceof Error ? err : new Error(String(err)));
          });
      }
    });

    return () => {
      offChunk();
      offComplete();
      offError();
      offConfirmation();
      offConfirmationInvalidated();
      offToolStart();
      offToolArgProgress();
      offAgentStart();
      offAgentDone();
      offContext();
      offToolResult();
      offCLIAgentProgress();
      offSessionStatus();
      offSessionCreated();
      offRaAppNative();
      offConnectionState();
      offReconnect();
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
    getToolActivitiesForSession,
    hasPendingChunksForSession,
    markAgentTurnError,
    registerCallId,
    removeActiveAgentLoop,
    removeLastAgentTurn,
    requestGeneratedTitleIfNeeded,
    setAwaitingFirstChunk,
    setConnectionState,
    setContext,
    setError,
    setPendingConfirmation,
    setRecoveryNotice,
    setStreaming,
    setToolArgProgress,
    setVfsRefreshSignal,
    startAgentTurn,
    toolArgProgressSeenRef,
    updateToolActivity,
  ]);
}
