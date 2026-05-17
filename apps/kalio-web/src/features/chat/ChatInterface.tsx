import { useEffect, useRef, useState } from 'react';
import { nanoid } from 'nanoid';
import { useSessionStore } from '../../store/sessionStore';
import { useAgentStore } from '../../store/agentStore';
import { useSettingsStore } from '../settings/settingsStore';
import { eventBus } from '../../services/eventBus';
import { backendHealth } from '../../services/backendHealth';
import { MessageBubble } from './MessageBubble';
import { AgentTurnBubble } from './AgentTurnBubble';
import { ChatInput } from './ChatInput';
import { useContextUsage } from './hooks/useContextUsage';
import { useChatSessionActivation } from './hooks/useChatSessionActivation';
import { computeAnsweredCallIds, buildConversationTimeline, buildTurnsFromHistory } from './chatUtils';
import { apiClient } from '../../services/apiClient';
import type { ChatMessage, Persona } from '@kalio/types';
import {
  buildCopiedChatText,
  ChatSessionHeader,
  ChatStatusBanners,
  ChatWelcomeScreen,
  shouldRefreshVfsForToolResult,
} from './ChatInterface.Parts';

export { computeAnsweredCallIds } from './chatUtils';

const DEFAULT_SESSION_TITLE = 'New Chat';

function buildOptimisticSessionTitle(content: string): string {
  const preview = content.slice(0, 50).trim();
  return preview + (content.length > 50 ? '…' : '');
}

function shouldRequestGeneratedTitle(sessionTitle: string, sessionMessages: ChatMessage[]): boolean {
  const userMessages = sessionMessages.filter((message) => message.role === 'user');
  const assistantMessages = sessionMessages.filter((message) => message.role === 'assistant');

  if (userMessages.length !== 1 || assistantMessages.length < 1) {
    return false;
  }

  if (sessionTitle === DEFAULT_SESSION_TITLE || sessionTitle === '') {
    return true;
  }

  return sessionTitle === buildOptimisticSessionTitle(userMessages[0].content);
}

export function ChatInterface() {
  const {
    messages, activeSessionId, sessions, addMessage, addSession, appendChunk, finalizeChunk, setMessages,
    agentTurns, startAgentTurn, addTurnItem, finalizeAgentTurn,
    setAgentTurns, markAgentTurnError, removeLastAgentTurn, flushThinkingChunks, flushStreamingChunks,
    getSessionActiveTurnId, getSessionAgentTurns, clearPendingChunks,
  } = useSessionStore();
  const activeSession = sessions.find((s) => s.id === activeSessionId) ?? null;
  const activeModel = useSettingsStore((s) => s.getEffectiveModel());
  const {
    isStreaming,
    setStreaming,
    setPendingConfirmation,
    setToolArgProgress,
    addToolActivity,
    updateToolActivity,
    clearToolActivities,
    addLlmActivity,
    updateLlmActivity,
    setContext,
    registerCallId,
    addActiveAgentLoop,
    removeActiveAgentLoop,
    appendCLIAgentChunk,
    clearCLIAgentOutput,
    getToolActivitiesForSession,
    getContextForSession,
    hasActiveLoopForSession,
  } = useAgentStore();
  const activeToolActivities = getToolActivitiesForSession(activeSessionId);
  const activeContext = getContextForSession(activeSessionId);
  const [error, setError] = useState<string | null>(null);
  const [retryError, setRetryError] = useState<string | null>(null);
  const [awaitingFirstChunk, setAwaitingFirstChunk] = useState(false);
  const lastSentContentRef = useRef<string>('');
  const [personas, setPersonas] = useState<Persona[]>([]);
  const toolArgProgressSeenRef = useRef<Record<string, Set<string>>>({});
  const { updateSession } = useSessionStore();

  useEffect(() => {
    apiClient
      .get<Persona[]>('/api/personas')
      .then((r) => setPersonas(r.data))
      .catch((err: unknown) => console.error('[ChatInterface] personas load failed', err));
  }, []);

  const handlePersonaChange = async (personaId: string) => {
    if (!activeSessionId) return;
    try {
      await apiClient.patch(`/api/sessions/${activeSessionId}`, { personaId });
      updateSession(activeSessionId, { personaId });
    } catch (err: unknown) {
      console.error('[ChatInterface] persona change failed', err instanceof Error ? err : new Error(String(err)));
    }
  };
  const [showContextStats, setShowContextStats] = useState(false);
  const [vfsRefreshSignal, setVfsRefreshSignal] = useState(0);
  const bottomRef = useRef<HTMLDivElement>(null);

  const answeredCallIds = computeAnsweredCallIds(messages);

  const { tokenCount, needsCompact, compactMessages } = useContextUsage();

  const hasPendingChunksForSession = (sessionId: string | null): boolean => {
    if (!sessionId) return false;

    const { streamingChunks, thinkingChunks, chunkSessionIds } = useSessionStore.getState();
    const pendingChunkIds = new Set([
      ...Object.keys(streamingChunks),
      ...Object.keys(thinkingChunks),
    ]);

    for (const chunkId of pendingChunkIds) {
      if (chunkSessionIds[chunkId] === sessionId) {
        return true;
      }
    }

    return false;
  };

  useEffect(() => {
    if (!eventBus.connected) eventBus.connect();

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
      if (sessionId === useSessionStore.getState().activeSessionId) {
        setToolArgProgress(null);
      }
    };

    const ensureSyntheticToolIntent = (sessionId: string | null | undefined, toolName: string) => {
      if (!sessionId || sessionId !== useSessionStore.getState().activeSessionId) {
        return;
      }
      if (toolArgProgressSeenRef.current[sessionId]?.has(toolName)) {
        return;
      }
      setToolArgProgress({ toolName, totalChars: 0, charsPerSec: 0 });
    };

    const requestGeneratedTitleIfNeeded = (sessionId: string | null) => {
      const {
        sessions,
        activeSessionId: currentActiveSessionId,
        messages: sessionMessages,
      } = useSessionStore.getState();

      if (!sessionId || sessionId !== currentActiveSessionId) {
        return;
      }

      const session = sessions.find((item) => item.id === sessionId);
      if (!session || !shouldRequestGeneratedTitle(session.title, sessionMessages)) {
        return;
      }

      addLlmActivity({ id: 'title-gen', label: 'Generating title…', status: 'running', startedAt: Date.now() });
      fetch(`/api/sessions/${sessionId}/generate-title`, { method: 'POST' })
        .then((r) => r.json())
        .then((data: { title: string }) => {
          useSessionStore.getState().updateSession(sessionId, { title: data.title });
          updateLlmActivity('title-gen', { status: 'done', finishedAt: Date.now() });
        })
        .catch(() => {
          updateLlmActivity('title-gen', { status: 'error', finishedAt: Date.now() });
        });
    };

    const offChunk = eventBus.onChunk((chunk) => {
      const targetSessionId = chunk.sessionId ?? useSessionStore.getState().activeSessionId;

      if (!chunk.done) {
        if (targetSessionId === useSessionStore.getState().activeSessionId) {
          setAwaitingFirstChunk(false);
        }
        appendChunk(chunk.messageId, chunk.delta, chunk.thinking, chunk.sessionId);

        if (targetSessionId) {
          const { getSessionActiveTurnId: getTurnId, getSessionAgentTurns: getTurns, addTurnItem: addItem } = useSessionStore.getState();
          const currentTurnId = getTurnId(targetSessionId);
          if (currentTurnId) {
            const turn = getTurns(targetSessionId).find((t) => t.id === currentTurnId);
            if (turn) {
              const hasItem = turn.items.some(
                (item) => item.kind === (chunk.thinking ? 'thinking' : 'text') && item.messageId === chunk.messageId
              );
              if (!hasItem) {
                addItem({ kind: chunk.thinking ? 'thinking' : 'text', messageId: chunk.messageId }, targetSessionId);
              }
            }
          }
        }
      } else {
        if (chunk.sessionId === useSessionStore.getState().activeSessionId) {
          setAwaitingFirstChunk(false);
        }
        finalizeChunk(chunk.messageId);
        // Only update UI state for the active session
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
      const { streamingChunks, thinkingChunks, finalizeChunk: doFinalize, chunkSessionIds } = useSessionStore.getState();
      const ids = new Set([...Object.keys(streamingChunks), ...Object.keys(thinkingChunks)])
      ids.forEach((id) => {
        // Only finalize chunks belonging to this session
        if (!chunkSessionIds[id] || chunkSessionIds[id] === payload.sessionId) doFinalize(id);
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
      const { activeSessionId: currentActiveSessionId, getSessionActiveTurnId: getTurnId } = useSessionStore.getState();
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

      const activeTurnId = getTurnId(targetSessionId);
      if (!activeTurnId) {
        // Error before agent turn opened (e.g. QUEUE_FULL) → floating banner
        if (targetSessionId === currentActiveSessionId) {
          setError(payload.message);
        }
      } else if (payload.hadContent) {
        // Error after content was streamed → mark the turn bubble with an error indicator
        markAgentTurnError(activeTurnId, { code: payload.code, message: payload.message }, targetSessionId);
      } else if (payload.code === 'INTERRUPTED') {
        // User stopped before any content — silently remove the empty bubble
        removeLastAgentTurn(targetSessionId);
      } else {
        // Early failure (LLM down, session deleted, not configured) — remove empty bubble, show error banner
        removeLastAgentTurn(targetSessionId);
        if (targetSessionId === currentActiveSessionId) {
          setError(payload.message);
        }
      }
    });

    const offConfirmation = eventBus.onToolConfirmation((req) => {
      setPendingConfirmation(req.sessionId, req);
      ensureSyntheticToolIntent(req.sessionId, req.toolName);
      // Tool is awaiting confirmation — log it as an activity
      addToolActivity({
        callId: req.toolCallId,
        toolName: req.toolName,
        args: req.args,
        sessionId: req.sessionId,
        agentRun: req.agentRun,
        status: 'awaiting_confirmation',
        startedAt: Date.now(),
      });
    });

    const offConfirmationInvalidated = eventBus.onToolConfirmationInvalidated((payload) => {
      const pendingConfirmation = useAgentStore.getState().pendingConfirmations[payload.sessionId];
      const targetCallId = payload.toolCallId
        ?? (pendingConfirmation?.requestId === payload.requestId ? pendingConfirmation.toolCallId : payload.requestId);
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
      // Thinking is over once the agent calls a tool — flush any live thinkingChunks
      // so the ThinkingBlock stops animating (isThinkingStreaming → false).
      flushThinkingChunks(payloadSessionId);
      // Text streaming is over too — flush any live streamingChunks
      // so the text cursor stops blinking (isStreaming → false).
      flushStreamingChunks(payloadSessionId);
      // Persist this mapping permanently so older turns can still resolve tool names
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
        const { getSessionActiveTurnId: getTurnId, getSessionAgentTurns: getTurns, addTurnItem: addItem } = useSessionStore.getState();
        const currentTurnId = getTurnId(payloadSessionId);
        if (currentTurnId) {
          const turn = getTurns(payloadSessionId).find((item) => item.id === currentTurnId);
          const hasItem = turn?.items.some((item) => item.kind === 'tool' && item.callId === payload.callId) ?? false;
          if (!hasItem) {
            addItem({ kind: 'tool', callId: payload.callId }, payloadSessionId);
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
      clearToolActivities(payload.sessionId); // Fresh turn = fresh tool activities
      setPendingConfirmation(payload.sessionId, null); // Clear any stale confirmation from previous turn
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
      setPendingConfirmation(payload.sessionId, null); // Clear unanswered confirmations when turn ends
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
      // Clear accumulated live output so the cliAgentOutput map doesn't grow unbounded
      clearCLIAgentOutput(result.callId);
      // Refresh VFS file list after successful file-producing tool results.
      if (result.status === 'success') {
        const toolName = useAgentStore.getState().toolActivities.find((a) => a.callId === result.callId)?.toolName;
        if (shouldRefreshVfsForToolResult(toolName, result.data)) setVfsRefreshSignal((n) => n + 1);
      }
      // Persist tool result into message store so RAAppManager (and chat history) can see it
      if (result.status === 'success' && result.data !== undefined) {
        if (resultSessionId) {
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
      }
      // Re-enable streaming state for follow-up LLM response after successful tool
      if (result.status === 'success' && resultSessionId === activeSessionId) {
        setStreaming(true);
      }
    });

    const offCLIAgentProgress = eventBus.onCLIAgentProgress((payload) => {
      appendCLIAgentChunk(payload.callId, payload.chunk);
    });

    const offSessionCreated = eventBus.onSessionCreated((session) => {
      if (!useSessionStore.getState().sessions.some((item) => item.id === session.id)) {
        addSession(session);
      }
    });

    const offRaAppNative = eventBus.onRaAppNativeResult((payload) => {
      console.log('[RaAppNativeResult]', payload.toolCallId, payload.results);
      // Update the in-memory tool_result message to reflect executed native operations
      const sid = useSessionStore.getState().activeSessionId;
      if (!sid) return;
      const { messages: msgs, setMessages: setMsgs } = useSessionStore.getState();
      const updated = msgs.map((m) => {
        if (m.toolCallId !== payload.toolCallId || m.role !== 'tool_result') return m;
        try {
          const data = JSON.parse(m.content) as Record<string, unknown>;
          return {
            ...m,
            content: JSON.stringify({ ...data, nativeResults: payload.results, pendingApprovals: [] }),
          };
        } catch {
          return m;
        }
      });
      setMsgs(updated);
    });

    const offReconnect = eventBus.onReconnect(() => {
      console.log('[ChatInterface] socket reconnected — resetting streaming state');
      backendHealth.reportSuccess();
      setStreaming(false);
      clearToolActivities();
      clearToolArgProgressTracking();
      const { activeSessionId: sid } = useSessionStore.getState();
      if (sid) {
        removeActiveAgentLoop(sid);
        setPendingConfirmation(sid, null);
        // Identify immediately so the server can abort if the socket drops again
        eventBus.identifySession(sid);
        fetch(`/api/sessions/${sid}/messages`)
          .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
          .then((data: ChatMessage[]) => {
            if (useSessionStore.getState().activeSessionId !== sid) return;
            const { setMessages: doSetMessages, setAgentTurns: doSetAgentTurns } = useSessionStore.getState();
            doSetMessages(data);
            if (!useAgentStore.getState().hasActiveLoopForSession(sid)) {
              doSetAgentTurns(buildTurnsFromHistory(data, sid));
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
      offSessionCreated();
      offRaAppNative();
      offReconnect();
    };
  }, [appendChunk, finalizeChunk, setStreaming, setPendingConfirmation, setToolArgProgress, addToolActivity, updateToolActivity, setContext, startAgentTurn, addTurnItem, finalizeAgentTurn, markAgentTurnError, removeLastAgentTurn, addActiveAgentLoop, removeActiveAgentLoop, appendCLIAgentChunk, clearCLIAgentOutput, clearToolActivities, addSession, backendHealth, getSessionActiveTurnId, getSessionAgentTurns, hasActiveLoopForSession, clearPendingChunks]);

  useEffect(() => {
    lastSentContentRef.current = '';
    setAwaitingFirstChunk(false);
    toolArgProgressSeenRef.current = {};
    setToolArgProgress(null);
  }, [activeSessionId]);

  useEffect(() => {
    if (activeSessionId && eventBus.connected) {
      eventBus.identifySession(activeSessionId);
    }
  }, [activeSessionId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, activeToolActivities]);

  // Flush queued RA-App user actions when agent finishes streaming
  const prevStreamingRef = useRef(isStreaming);
  useEffect(() => {
    if (prevStreamingRef.current && !isStreaming) {
      const { dequeueUserAction, activeSessionId: sid, sessions } = useSessionStore.getState();
      let action = dequeueUserAction();
      while (action && sid) {
        const session = sessions.find((s) => s.id === sid);
        if (session) {
          const userMsg: ChatMessage = {
            id: nanoid(),
            sessionId: sid,
            role: 'user',
            content: action,
            createdAt: Date.now(),
          };
          addMessage(userMsg);
          eventBus.sendMessage({ sessionId: sid, content: action, personaId: session.personaId });
        }
        action = dequeueUserAction();
      }
    }
    prevStreamingRef.current = isStreaming;
  }, [isStreaming, addMessage]);

  const handleSendRef = useRef<(content: string, personaId: string) => void>(() => {});

  const handleSend = (content: string, personaId: string) => {
    if (!activeSessionId) return;
    // Guard against double-submit: check store state synchronously before any renders
    if (useAgentStore.getState().isStreaming) return;
    setError(null);
    setRetryError(null);
    lastSentContentRef.current = content;
    clearToolActivities(activeSessionId);

    // Auto-generate title from first message if session still has default title
    const { sessions, updateSession } = useSessionStore.getState();
    const session = sessions.find((s) => s.id === activeSessionId);
    if (session && session.title === DEFAULT_SESSION_TITLE && messages.length === 0) {
      const generatedTitle = buildOptimisticSessionTitle(content);
      void updateSession(activeSessionId, { title: generatedTitle });
    }

    const userMsg: ChatMessage = {
      id: nanoid(),
      sessionId: activeSessionId,
      role: 'user',
      content,
      createdAt: Date.now(),
    };
    addMessage(userMsg);

    setAwaitingFirstChunk(true);
    setStreaming(true);
    console.debug('[ChatInterface] sendMessage', { sessionId: activeSessionId, content: content.slice(0, 60) });

    eventBus.sendMessage({
      sessionId: activeSessionId,
      content,
      personaId,
    });
  };

  handleSendRef.current = handleSend;

  useChatSessionActivation({
    activeSessionId,
    clearToolActivities,
    handleSendRef,
    setAgentTurns,
    setMessages,
    setPendingConfirmation,
  });

  const composerStreaming = isStreaming || awaitingFirstChunk || hasPendingChunksForSession(activeSessionId);

  const handleStop = () => {
    if (!activeSessionId) return;
    eventBus.stopTurn(activeSessionId);
  };

  const handleCompactNow = () => {
    if (!activeSessionId) return;
    const compacted = compactMessages(messages, 'auto-trim');
    setMessages(compacted);
    setShowContextStats(false);
  };

  const [copied, setCopied] = useState(false);
  const handleCopyChat = () => {
    const text = buildCopiedChatText(messages);
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      console.log('[ChatInterface] chat copied to clipboard', { messageCount: messages.length });
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <div data-testid="chat-interface" className="flex h-full flex-col bg-base-200 rounded-xl border border-base-300 overflow-hidden">
      <ChatStatusBanners
        error={error}
        onCloseError={() => setError(null)}
        onCloseRetryError={() => setRetryError(null)}
        onRetry={() => {
          const content = lastSentContentRef.current;
          const session = sessions.find((item) => item.id === activeSessionId);
          if (content && session) {
            setRetryError(null);
            handleSend(content, session.personaId);
          }
        }}
        retryError={retryError}
      />

      {activeSession && activeSessionId && (
        <ChatSessionHeader
          activeContext={activeContext}
          activeModel={activeModel}
          activeSession={activeSession}
          activeSessionId={activeSessionId}
          copied={copied}
          messages={messages}
          needsCompact={needsCompact}
          onCloseContextStats={() => setShowContextStats(false)}
          onCompactNow={handleCompactNow}
          onCopyChat={handleCopyChat}
          onToggleContextStats={() => setShowContextStats((value) => !value)}
          showContextStats={showContextStats}
          tokenCount={tokenCount}
          vfsRefreshSignal={vfsRefreshSignal}
        />
      )}

      <div data-testid="message-list" className="flex-1 overflow-y-auto p-4 space-y-1">
        {messages.length === 0 && (
          <ChatWelcomeScreen
            activeSession={activeSession}
            activeSessionId={activeSessionId}
            isStreaming={composerStreaming}
            onPersonaChange={(personaId) => void handlePersonaChange(personaId)}
            onSend={handleSend}
            personas={personas}
          />
        )}

        {buildConversationTimeline(messages, agentTurns).map((entry) => (
          entry.kind === 'user_message'
            ? <MessageBubble key={entry.message.id} message={entry.message} />
            : (
              <AgentTurnBubble
                key={entry.turn.id}
                turn={entry.turn}
                toolActivities={activeToolActivities}
                answeredCallIds={answeredCallIds}
              />
            )
        ))}

        {composerStreaming && activeToolActivities.length === 0 && messages.length === 0 && (
          <div className="flex justify-start">
            <div className="bg-base-300 rounded-2xl px-4 py-2">
              <span data-testid="streaming-indicator" className="loading loading-dots loading-xs" />
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      <ChatInput onSend={handleSend} disabled={composerStreaming || !activeSessionId} isStreaming={composerStreaming} onStop={handleStop} />
    </div>
  );
}
