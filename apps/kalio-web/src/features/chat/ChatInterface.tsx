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
import { useAwaitingFirstChunk } from './hooks/useAwaitingFirstChunk';
import { buildTurnsFromHistory, computeAnsweredCallIds, buildConversationTimeline, mergeFetchedMessages } from './chatUtils';
import { apiClient } from '../../services/apiClient';
import type { ChatMessage, ConversationTitleSettings } from '@kalio/types';
import type { TalkView } from '../../App.types';
import { getArchitectureSchemas } from '../architect/architect.api';
import { ARCHITECTURE_REGISTRY_CHANGED_EVENT } from '../architect/architectureRegistryEvents';
import type { ArchitectSchema } from '../architect/architect.types';
import { persistSessionLaunchPersona } from './launch/launchContext';
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
import { DEFAULT_SESSION_HISTORY_LIMIT, fetchSessionHistoryWindow } from './sessionHistoryApi';
import { useChatAutoScroll } from './useChatAutoScroll';
import { SessionBudgetApprovalBanner } from './SessionBudgetApprovalBanner';
import { useChatProjectSelection } from './useChatProjectSelection';

export { computeAnsweredCallIds } from './chatUtils';
export { buildArchitectureRunContext, buildGoalGuardRunContext } from './launch/launchContext';

const DEFAULT_SESSION_TITLE = 'New Chat';

function resolveRuntimeProvider(executionProfileId: string | undefined, provider: string | undefined): string | null {
  const profileId = executionProfileId?.trim().toLowerCase();
  if (profileId?.startsWith('codex-')) {
    return 'Codex';
  }

  const providerLabels: Record<string, string> = {
    openai: 'ChatGPT',
    openrouter: 'OpenRouter',
    cometapi: 'CometAPI',
    xiaomimimo: 'MiMo',
    ollama: 'Ollama',
    deepseek: 'DeepSeek',
    bitnet: 'BitNet',
    custom: 'Custom LLM',
    mock: 'Local LLM',
  };
  return provider ? providerLabels[provider.toLowerCase()] ?? provider : null;
}

function resolveRuntimeModel(model: string | undefined): string | null {
  const normalized = model?.trim();
  return normalized && normalized.toLowerCase() !== 'mock' ? normalized : null;
}

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

export interface ChatInterfaceProps {
  talkView?: TalkView;
  onTalkViewChange?: (view: TalkView) => void;
}

export function ChatInterface({ talkView = 'conversation', onTalkViewChange = () => undefined }: ChatInterfaceProps = {}) {
  const {
    messages, activeSessionId, sessions, addMessage, setMessages,
    agentTurns, setAgentTurns, updateAgentTurn, updateSession,
    getSessionActiveTurnId,
    getSessionHistoryMeta,
    setSessionHistoryMeta,
    streamingChunks,
    thinkingChunks,
    chunkSessionIds,
  } = useSessionStore();
  const activeSession = sessions.find((s) => s.id === activeSessionId) ?? null;
  const backendProvider = useSettingsStore((s) => s.backendConfig?.provider);
  const backendModel = useSettingsStore((s) => s.backendConfig?.model);
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
  const activeSessionHistoryMeta = getSessionHistoryMeta(activeSessionId);
  const { messageListRef, handleMessageListScroll } = useChatAutoScroll({
    activeSessionId,
    messages,
    activeToolActivities,
  });
  const [error, setError] = useState<string | null>(null);
  const [retryError, setRetryError] = useState<string | null>(null);
  const [connectionState, setConnectionState] = useState<ChatConnectionState>(
    eventBus.connected ? 'connected' : 'connecting',
  );
  const [recoveryNotice, setRecoveryNotice] = useState<string | null>(null);
  const [awaitingFirstChunk, setAwaitingFirstChunk] = useAwaitingFirstChunk();
  const lastSentContentRef = useRef<string>('');
  const [architectures, setArchitectures] = useState<ArchitectSchema[]>([]);
  const [selectedArchitectureId, setSelectedArchitectureId] = useState('single-chat');
  const [draftUserMessage, setDraftUserMessage] = useState('');
  const [contextPreviewRefreshKey, setContextPreviewRefreshKey] = useState(0);
  const [loadingOlderMessages, setLoadingOlderMessages] = useState(false);
  const toolArgProgressSeenRef = useRef<Record<string, Set<string>>>({});

  const { projectPath, setProjectPath, projectId, handleProjectChange } = useChatProjectSelection({
    activeSession,
    activeSessionId,
    updateSession,
    onError: setError,
  });

  const refreshArchitectures = useCallback(() => {
    getArchitectureSchemas()
      .then((schemas) => {
        setArchitectures(schemas);
        setSelectedArchitectureId((current) => (
          current === 'single-chat' || schemas.some((schema) => schema.id === current)
            ? current
            : 'single-chat'
        ));
      })
      .catch((err: unknown) => console.error('[ChatInterface] architecture registry load failed', err));
  }, []);

  useEffect(() => {
    refreshArchitectures();
  }, [refreshArchitectures]);

  useEffect(() => {
    window.addEventListener(ARCHITECTURE_REGISTRY_CHANGED_EVENT, refreshArchitectures);
    return () => window.removeEventListener(ARCHITECTURE_REGISTRY_CHANGED_EVENT, refreshArchitectures);
  }, [refreshArchitectures]);

  useEffect(() => {
    apiClient
      .get<ConversationTitleSettings>('/api/credentials/settings/conversation-title')
      .then((response) => setConversationTitleSettings(response.data))
      .catch((err: unknown) => console.error('[ChatInterface] conversation title settings load failed', err));
  }, []);

  const [showContextStats, setShowContextStats] = useState(false);
  const [vfsRefreshSignal, setVfsRefreshSignal] = useState(0);
  const {
    personas,
    selectedPersonaId,
    setSelectedPersonaId,
  } = useLaunchPersonas(activeSession?.personaId);
  const activePersona = personas.find((persona) => persona.id === activeSession?.personaId);
  const activeModel = resolveRuntimeModel(activePersona?.model || backendModel);
  const activeProvider = resolveRuntimeProvider(
    activeSession?.executionProfileId ?? activePersona?.executionProfileId,
    backendProvider,
  );

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
  const activeSessionHasVisibleAgentTurn = activeSessionId
    ? conversationTimeline.some((entry) => entry.kind === 'agent_turn' && entry.turn.sessionId === activeSessionId)
    : false;
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
    session: activeSession,
    personaId: conversationShellState.mode === 'launch-form'
      ? selectedPersonaId
      : activeSession?.personaId ?? null,
    draftUserMessage,
    refreshKey: contextPreviewRefreshKey,
    enabled: !composerBusy && !awaitingFirstChunk,
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
  }, [activeSessionId, invalidateContextPreview, setAwaitingFirstChunk, setToolArgProgress]);

  useEffect(() => {
    if (activeSessionId && connectionState === 'connected') {
      identifyWatchedSession(activeSessionId, 'chat-interface-active', { sticky: true });
    }
  }, [activeSessionId, connectionState]);

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
  const remainingHistoryCount = activeSessionHistoryMeta
    ? Math.max(0, activeSessionHistoryMeta.totalCount - messages.length)
    : 0;
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

  const handleLoadOlderMessages = useCallback(async () => {
    if (!activeSessionId || !activeSessionHistoryMeta?.hasMoreBefore || loadingOlderMessages) {
      return;
    }

    setLoadingOlderMessages(true);
    try {
      const response = await fetchSessionHistoryWindow(activeSessionId, {
        limit: DEFAULT_SESSION_HISTORY_LIMIT,
        beforeMessageId: activeSessionHistoryMeta.oldestLoadedMessageId,
      });
      const currentMessages = useSessionStore.getState().getSessionMessages(activeSessionId);
      const mergedMessages = mergeFetchedMessages(currentMessages, response.messages);
      setSessionHistoryMeta(activeSessionId, response.meta);
      setMessages(mergedMessages, activeSessionId);
      setAgentTurns(buildTurnsFromHistory(mergedMessages, activeSessionId), activeSessionId);
    } catch (err: unknown) {
      console.error('[ChatInterface] older history load failed', err instanceof Error ? err : new Error(String(err)));
      setError('Failed to load older messages.');
    } finally {
      setLoadingOlderMessages(false);
    }
  }, [
    activeSessionHistoryMeta,
    activeSessionId,
    loadingOlderMessages,
    setAgentTurns,
    setMessages,
    setSessionHistoryMeta,
  ]);

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
          activeProvider={activeProvider}
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
          talkView={talkView}
          onTalkViewChange={onTalkViewChange}
          projectId={projectId}
          onProjectChange={handleProjectChange}
          projectPickerDisabled={isStreamingForActiveSession}
        />
      )}

      <div
        ref={messageListRef}
        data-testid="message-list"
        className="flex-1 overflow-y-auto px-1.5 py-3 sm:px-2 lg:px-2"
        style={{ overflowAnchor: 'none' }}
        onScroll={handleMessageListScroll}
      >
        <div className="flex w-full flex-col gap-1">
          {activeSessionId && activeSessionHistoryMeta?.hasMoreBefore && (
            <div className="flex justify-center pb-2">
              <button
                type="button"
                className="btn btn-ghost btn-xs text-[11px]"
                onClick={() => void handleLoadOlderMessages()}
                disabled={loadingOlderMessages}
                data-testid="chat-load-older-btn"
              >
                {loadingOlderMessages
                  ? 'Loading older messages...'
                  : `Load older messages${remainingHistoryCount > 0 ? ` (${remainingHistoryCount} remaining)` : ''}`}
              </button>
            </div>
          )}
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
              onProjectChange={handleProjectChange}
              onSend={(content, personaId) => {
                void handleLaunchSend(content, personaId);
              }}
              personas={personas}
              projectPath={projectPath}
              projectId={projectId}
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
            <>
              <SessionBudgetApprovalBanner sessionId={activeSessionHasVisibleAgentTurn ? null : activeSessionId} />
              <PendingAssistantBubble liveTurnState={liveTurnState} />
            </>
          )}

          <div />
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
