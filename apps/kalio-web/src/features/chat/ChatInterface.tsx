import { useCallback, useEffect, useRef, useState } from 'react';
import { nanoid } from 'nanoid';
import { useSessionStore } from '../../store/sessionStore';
import { useAgentStore } from '../../store/agentStore';
import { useSettingsStore } from '../settings/settingsStore';
import { eventBus } from '../../services/eventBus';
import { identifyWatchedSession } from '../../services/sessionWatchRegistry';
import { MessageBubble } from './MessageBubble';
import { AgentTurnBubble } from './AgentTurnBubble';
import { ChatInput } from './ChatInput';
import { useContextUsage } from './hooks/useContextUsage';
import { useContextPreview } from './hooks/useContextPreview';
import { useChatSessionActivation } from './hooks/useChatSessionActivation';
import { useChatSocketEvents } from './hooks/useChatSocketEvents';
import { useChatComposerActions } from './hooks/useChatComposerActions';
import { computeAnsweredCallIds, buildConversationTimeline } from './chatUtils';
import { apiClient } from '../../services/apiClient';
import type { ChatMessage, ConversationTitleSettings } from '@kalio/types';
import { getArchitectureSchemas } from '../architect/architect.api';
import type { ArchitectSchema } from '../architect/architect.types';
import {
  getLaunchProjectPath,
  persistSessionLaunchPersona,
} from './launch/launchContext';
import { useLaunchPersonas } from './launch/useLaunchPersonas';
import {
  buildCopiedChatText,
  type ChatConnectionState,
  ChatSessionHeader,
  ChatStatusBanners,
  PendingAssistantBubble,
  ChatWelcomeScreen,
} from './ChatInterface.Parts';
import { resolveConversationShellState } from './conversationShellState';
import { resolveLiveTurnState } from './liveTurnState';
import { resolveRenderableConversationProjection } from './conversationTranscriptProjection';
import { selectQueuedDepth } from '../../store/agentRuntimeSelectors';

export { computeAnsweredCallIds } from './chatUtils';
export { buildArchitectureRunContext, buildGoalGuardRunContext } from './launch/launchContext';

const DEFAULT_SESSION_TITLE = 'New Chat';

function buildOptimisticSessionTitle(content: string): string {
  const preview = content.slice(0, 50).trim();
  return preview + (content.length > 50 ? '...' : '');
}

function shouldRequestGeneratedTitle(
  sessionTitle: string,
  sessionMessages: ChatMessage[],
  settings: ConversationTitleSettings,
): boolean {
  const userMessages = sessionMessages.filter((message) => message.role === 'user');
  const assistantMessages = sessionMessages.filter((message) => message.role === 'assistant');

  if (
    settings.autoRenameEnabled
    && assistantMessages.length >= settings.renameEveryReplies
    && assistantMessages.length % settings.renameEveryReplies === 0
  ) {
    return true;
  }

  if (userMessages.length !== 1 || assistantMessages.length < 1) {
    return false;
  }

  if (sessionTitle === DEFAULT_SESSION_TITLE || sessionTitle === '') {
    return true;
  }

  if (sessionTitle === buildOptimisticSessionTitle(userMessages[0].content)) {
    return true;
  }

  return false;
}

export function ChatInterface() {
  const {
    messages, activeSessionId, sessions, addMessage, setMessages,
    agentTurns, setAgentTurns, updateAgentTurn, updateSession,
    getSessionActiveTurnId,
    streamingChunks,
    thinkingChunks,
    chunkSessionIds,
  } = useSessionStore();
  const activeSession = sessions.find((s) => s.id === activeSessionId) ?? null;
  const activeModel = useSettingsStore((s) => s.getEffectiveModel());
  const conversationTitleSettings = useSettingsStore((state) => state.conversationTitleSettings);
  const setConversationTitleSettings = useSettingsStore((state) => state.setConversationTitleSettings);
  const {
    isStreaming,
    streamingSessionId,
    setPendingConfirmation,
    setToolArgProgress,
    clearToolActivities,
    addLlmActivity,
    updateLlmActivity,
    getToolActivitiesForSession,
    getContextForSession,
    queuedDepthBySession,
    runtimeActivitySnapshots,
    hasActiveLoopForSession,
  } = useAgentStore();
  const isStreamingForActiveSession = isStreaming && streamingSessionId === activeSessionId;
  const queuedDepth = selectQueuedDepth({
    sessionId: activeSessionId,
    queuedDepthBySession,
    runtimeActivitySnapshots,
  });
  const activeToolActivities = getToolActivitiesForSession(activeSessionId);
  const activeContext = getContextForSession(activeSessionId);
  const [error, setError] = useState<string | null>(null);
  const [retryError, setRetryError] = useState<string | null>(null);
  const [connectionState, setConnectionState] = useState<ChatConnectionState>(
    eventBus.connected ? 'connected' : 'connecting',
  );
  const [recoveryNotice, setRecoveryNotice] = useState<string | null>(null);
  const [awaitingFirstChunk, setAwaitingFirstChunk] = useState(false);
  const lastSentContentRef = useRef<string>('');
  const [architectures, setArchitectures] = useState<ArchitectSchema[]>([]);
  const [selectedArchitectureId, setSelectedArchitectureId] = useState('single-chat');
  const [projectPath, setProjectPath] = useState('');
  const [draftUserMessage, setDraftUserMessage] = useState('');
  const [contextPreviewRefreshKey, setContextPreviewRefreshKey] = useState(0);
  const toolArgProgressSeenRef = useRef<Record<string, Set<string>>>({});

  useEffect(() => {
    setProjectPath(getLaunchProjectPath(activeSession?.runtimeContext));
  }, [activeSession?.runtimeContext, activeSessionId]);

  useEffect(() => {
    getArchitectureSchemas()
      .then((schemas) => setArchitectures(schemas))
      .catch((err: unknown) => console.error('[ChatInterface] architecture registry load failed', err));
  }, []);

  useEffect(() => {
    apiClient
      .get<ConversationTitleSettings>('/api/credentials/settings/conversation-title')
      .then((response) => setConversationTitleSettings(response.data))
      .catch((err: unknown) => console.error('[ChatInterface] conversation title settings load failed', err));
  }, []);

  const [showContextStats, setShowContextStats] = useState(false);
  const [vfsRefreshSignal, setVfsRefreshSignal] = useState(0);
  const messageListRef = useRef<HTMLDivElement>(null);
  const shouldAutoScrollRef = useRef(true);
  const bottomRef = useRef<HTMLDivElement>(null);
  const {
    personas,
    selectedPersonaId,
    setSelectedPersonaId,
  } = useLaunchPersonas(activeSession?.personaId);

  const renderableConversationProjection = resolveRenderableConversationProjection({
    session: activeSession,
    messages,
    agentTurns,
  });
  const answeredCallIds = computeAnsweredCallIds(renderableConversationProjection.messages);
  const conversationTimeline = buildConversationTimeline(
    renderableConversationProjection.messages,
    renderableConversationProjection.agentTurns,
  );
  const liveTurnState = resolveLiveTurnState({
    sessionId: activeSessionId,
    sessionMessages: messages,
    agentTurns,
    activeTurnId: getSessionActiveTurnId(activeSessionId),
    isStreaming: isStreamingForActiveSession,
    streamingSessionId,
    awaitingFirstChunk,
    hasActiveLoop: hasActiveLoopForSession(activeSessionId),
    queuedDepth,
    activeToolActivities,
    streamingChunks,
    thinkingChunks,
    chunkSessionIds,
  });
  const conversationShellState = resolveConversationShellState({
    activeSession,
    activeSessionId,
    conversationTimelineLength: conversationTimeline.length,
    liveTurnState,
  });
  const hasRenderableConversation = conversationShellState.mode === 'timeline';
  const composerBusy = liveTurnState.stoppable;

  const { tokenCount: fallbackTokenCount, compactMessages } = useContextUsage();
  const invalidateContextPreview = useCallback(() => {
    setContextPreviewRefreshKey((value) => value + 1);
  }, []);
  const contextPreview = useContextPreview({
    sessionId: activeSessionId,
    personaId: conversationShellState.mode === 'launch-form'
      ? selectedPersonaId
      : activeSession?.personaId ?? null,
    draftUserMessage,
    refreshKey: contextPreviewRefreshKey,
  });
  const tokenCount = contextPreview.tokenCount ?? fallbackTokenCount;
  const needsCompact = tokenCount.total > tokenCount.contextLimit;

  const hasPendingChunksForSession = useCallback((sessionId: string | null): boolean => {
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
  }, []);

  const requestGeneratedTitleIfNeeded = useCallback((sessionId: string | null) => {
    const {
      sessions,
      activeSessionId: currentActiveSessionId,
      messages: sessionMessages,
    } = useSessionStore.getState();

    if (!sessionId || sessionId !== currentActiveSessionId) {
      return;
    }

    const session = sessions.find((item) => item.id === sessionId);
    if (!session || !shouldRequestGeneratedTitle(session.title, sessionMessages, conversationTitleSettings)) {
      return;
    }

    addLlmActivity({ id: 'title-gen', label: 'Generating title...', status: 'running', startedAt: Date.now() });
    apiClient.post<{ title: string }>(`/api/sessions/${sessionId}/generate-title`)
      .then((response) => {
        const data = response.data;
        useSessionStore.getState().updateSession(sessionId, { title: data.title });
        updateLlmActivity('title-gen', { status: 'done', finishedAt: Date.now() });
      })
      .catch((err: unknown) => {
        console.error('[ChatInterface] title generation failed', err instanceof Error ? err : new Error(String(err)));
        updateLlmActivity('title-gen', { status: 'error', finishedAt: Date.now() });
      });
  }, [addLlmActivity, conversationTitleSettings, updateLlmActivity]);

  useChatSocketEvents({
    hasPendingChunksForSession,
    requestGeneratedTitleIfNeeded,
    setAwaitingFirstChunk,
    setConnectionState,
    setError,
    setRecoveryNotice,
    setVfsRefreshSignal,
    toolArgProgressSeenRef,
    onContextInvalidated: invalidateContextPreview,
  });

  useEffect(() => {
    lastSentContentRef.current = '';
    setAwaitingFirstChunk(false);
    toolArgProgressSeenRef.current = {};
    setToolArgProgress(null);
    setDraftUserMessage('');
    invalidateContextPreview();
    shouldAutoScrollRef.current = true;
  }, [activeSessionId, invalidateContextPreview, setToolArgProgress]);

  useEffect(() => {
    if (activeSessionId && eventBus.connected) {
      identifyWatchedSession(activeSessionId, 'chat-interface-active', { sticky: true });
    }
  }, [activeSessionId]);

  useEffect(() => {
    if (shouldAutoScrollRef.current) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, activeToolActivities]);

  const handleMessageListScroll = () => {
    const list = messageListRef.current;
    if (!list) {
      return;
    }
    const distanceFromBottom = list.scrollHeight - list.scrollTop - list.clientHeight;
    shouldAutoScrollRef.current = distanceFromBottom < 96;
  };

  // Flush queued RA-App user actions when agent finishes streaming
  const prevStreamingRef = useRef(isStreamingForActiveSession);
  useEffect(() => {
    if (prevStreamingRef.current && !isStreamingForActiveSession) {
      const { dequeueUserAction, activeSessionId: sid, sessions } = useSessionStore.getState();
      if (!eventBus.connected) {
        setRecoveryNotice('Queued action is waiting for backend reconnect.');
        prevStreamingRef.current = isStreamingForActiveSession;
        return;
      }
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
          if (!eventBus.sendMessage({ sessionId: sid, content: action, personaId: session.personaId })) {
            setRecoveryNotice('Backend connection is offline. Retry the queued action after reconnect.');
          }
        }
        action = dequeueUserAction();
      }
    }
    prevStreamingRef.current = isStreamingForActiveSession;
  }, [isStreamingForActiveSession, addMessage]);

  const {
    handleComposerSend,
    handleSendRef,
  } = useChatComposerActions({
    architectures,
    lastSentContentRef,
    projectPath,
    requestGeneratedTitleIfNeeded,
    selectedArchitectureId,
    setAwaitingFirstChunk,
    setDraftUserMessage,
    setError,
    setRetryError,
  });

  useChatSessionActivation({
    activeSessionId,
    clearToolActivities,
    handleSendRef,
    setAgentTurns,
    setMessages,
    setPendingConfirmation,
    updateAgentTurn,
  });

  useEffect(() => {
    if (
      recoveryNotice === 'Recovered missed stream events after reconnect.'
      && activeSessionId
      && conversationShellState.mode === 'launch-form'
      && !composerBusy
    ) {
      setRecoveryNotice(null);
    }
  }, [activeSessionId, composerBusy, conversationShellState.mode, recoveryNotice]);

  const handleStop = () => {
    if (!activeSessionId) return;
    if (!eventBus.stopTurn(activeSessionId)) {
      setError('Backend connection is offline. Stop could not be delivered.');
    }
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

  const handleLaunchSend = useCallback(async (content: string, personaId: string) => {
    if (!activeSession) {
      return;
    }

    try {
      await persistSessionLaunchPersona(activeSession, personaId, updateSession);
    } catch (err: unknown) {
      console.error('[ChatInterface] launch persona update failed', err instanceof Error ? err : new Error(String(err)));
      setError('Failed to save selected persona for this chat.');
      return;
    }

    handleComposerSend(content, personaId);
  }, [activeSession, handleComposerSend, updateSession]);

  return (
    <div data-testid="chat-interface" className="flex h-full flex-col bg-base-200 overflow-hidden">
      <ChatStatusBanners
        connectionState={connectionState}
        error={error}
        onCloseError={() => setError(null)}
        onCloseRecoveryNotice={() => setRecoveryNotice(null)}
        onCloseRetryError={() => setRetryError(null)}
        onRetry={() => {
          const content = lastSentContentRef.current;
          const session = sessions.find((item) => item.id === activeSessionId);
          if (content && session) {
            setRetryError(null);
            handleComposerSend(content, session.personaId);
          }
        }}
        recoveryNotice={recoveryNotice}
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
          contextPreview={contextPreview.preview}
          contextPreviewStatus={{
            loading: contextPreview.loading,
            stale: contextPreview.stale,
            error: contextPreview.error,
          }}
          vfsRefreshSignal={vfsRefreshSignal}
        />
      )}

      <div
        ref={messageListRef}
        data-testid="message-list"
        className="flex-1 overflow-y-auto px-1.5 py-3 sm:px-2 lg:px-2"
        onScroll={handleMessageListScroll}
      >
        <div className="flex w-full flex-col gap-1">
          {(conversationShellState.mode === 'launch-form' || conversationShellState.mode === 'pending-child-session') && (
            <ChatWelcomeScreen
              activeSession={activeSession}
              activeSessionId={activeSessionId}
              architectures={architectures}
              isStreaming={composerBusy}
              onArchitectureChange={setSelectedArchitectureId}
              onArchitectureRun={(content) => void handleComposerSend(content, selectedPersonaId)}
              onDraftChange={setDraftUserMessage}
              onPersonaChange={setSelectedPersonaId}
              onProjectPathChange={setProjectPath}
              onSend={(content, personaId) => {
                void handleLaunchSend(content, personaId);
              }}
              personas={personas}
              projectPath={projectPath}
              selectedPersonaId={selectedPersonaId}
              selectedArchitectureId={selectedArchitectureId}
            />
          )}

          {conversationTimeline.map((entry) => (
            entry.kind === 'user_message'
              ? <MessageBubble key={entry.message.id} message={entry.message} />
              : (
                <AgentTurnBubble
                  key={entry.turn.id}
                  turn={entry.turn}
                  toolActivities={activeToolActivities}
                  answeredCallIds={answeredCallIds}
                  renderedMessages={renderableConversationProjection.messages}
                />
              )
          ))}

          {conversationShellState.mode !== 'pending-child-session' && liveTurnState.showPlaceholderBubble && (
            <PendingAssistantBubble liveTurnState={liveTurnState} />
          )}

          <div ref={bottomRef} />
        </div>
      </div>

      {hasRenderableConversation && (
        <ChatInput
          architectures={architectures}
          disabled={!activeSessionId}
          isStreaming={composerBusy}
          queuedDepth={queuedDepth}
          onArchitectureChange={setSelectedArchitectureId}
          onArchitectureRun={(content) => void handleComposerSend(content, activeSession?.personaId ?? 'default')}
          onDraftChange={setDraftUserMessage}
          onSend={handleComposerSend}
          onStop={handleStop}
          selectedArchitectureId={selectedArchitectureId}
        />
      )}
    </div>
  );
}
