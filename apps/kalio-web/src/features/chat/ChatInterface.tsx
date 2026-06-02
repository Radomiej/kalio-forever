import { useCallback, useEffect, useRef, useState } from 'react';
import { nanoid } from 'nanoid';
import { useSessionStore } from '../../store/sessionStore';
import type { AgentTurn } from '../../store/sessionStore';
import { useAgentStore } from '../../store/agentStore';
import { useSettingsStore } from '../settings/settingsStore';
import { eventBus } from '../../services/eventBus';
import { MessageBubble } from './MessageBubble';
import { AgentTurnBubble } from './AgentTurnBubble';
import { ChatInput } from './ChatInput';
import { useContextUsage } from './hooks/useContextUsage';
import { useChatSessionActivation } from './hooks/useChatSessionActivation';
import { useChatSocketEvents } from './hooks/useChatSocketEvents';
import { computeAnsweredCallIds, buildConversationTimeline } from './chatUtils';
import { apiClient, getSessionVfsFiles } from '../../services/apiClient';
import type { ChatMessage, Persona, VFSFile } from '@kalio/types';
import { getArchitectureSchemas, startArchitectureRun, startGoalGuardAgentFlowRun } from '../architect/architect.api';
import type { ArchitectSchema } from '../architect/architect.types';
import { buildArchitectureRunTurnProjection } from './architectureChatSummary';
import {
  buildCopiedChatText,
  type ChatConnectionState,
  ChatSessionHeader,
  ChatStatusBanners,
  ChatWelcomeScreen,
} from './ChatInterface.Parts';

export { computeAnsweredCallIds } from './chatUtils';

const DEFAULT_SESSION_TITLE = 'New Chat';

function buildOptimisticSessionTitle(content: string): string {
  const preview = content.slice(0, 50).trim();
  return preview + (content.length > 50 ? '...' : '');
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

export function buildArchitectureRunContext(
  sessionId: string,
  files: VFSFile[],
): Record<string, unknown> {
  const context: Record<string, unknown> = { parentSessionId: sessionId };
  if (files.length > 0) {
    context['hydrateFromSessionId'] = sessionId;
    context['hydrateTargetPrefix'] = 'project';
    context['hydrateFilePaths'] = files.map((file) => file.path);
  }
  return context;
}

function buildGoalGuardRunContext(sessionId: string, files: VFSFile[]): Record<string, unknown> {
  return {
    ...buildArchitectureRunContext(sessionId, files),
    requireGoalMasterLoopProof: true,
    requireImplementerWriteProof: true,
  };
}

export function ChatInterface() {
  const {
    messages, activeSessionId, sessions, addMessage, setMessages,
    agentTurns, setAgentTurns,
  } = useSessionStore();
  const activeSession = sessions.find((s) => s.id === activeSessionId) ?? null;
  const activeModel = useSettingsStore((s) => s.getEffectiveModel());
  const {
    isStreaming,
    setStreaming,
    setPendingConfirmation,
    setToolArgProgress,
    clearToolActivities,
    addLlmActivity,
    updateLlmActivity,
    getToolActivitiesForSession,
    getContextForSession,
  } = useAgentStore();
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
  const [personas, setPersonas] = useState<Persona[]>([]);
  const [architectures, setArchitectures] = useState<ArchitectSchema[]>([]);
  const [selectedArchitectureId, setSelectedArchitectureId] = useState('single-chat');
  const toolArgProgressSeenRef = useRef<Record<string, Set<string>>>({});
  const { updateSession } = useSessionStore();

  useEffect(() => {
    apiClient
      .get<Persona[]>('/api/personas')
      .then((r) => setPersonas(r.data))
      .catch((err: unknown) => console.error('[ChatInterface] personas load failed', err));
  }, []);

  useEffect(() => {
    getArchitectureSchemas()
      .then((schemas) => setArchitectures(schemas))
      .catch((err: unknown) => console.error('[ChatInterface] architecture registry load failed', err));
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

  const { tokenCount, needsCompact, compactMessages, rawContext } = useContextUsage();

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
    if (!session || !shouldRequestGeneratedTitle(session.title, sessionMessages)) {
      return;
    }

    addLlmActivity({ id: 'title-gen', label: 'Generating title...', status: 'running', startedAt: Date.now() });
    fetch(`/api/sessions/${sessionId}/generate-title`, { method: 'POST' })
      .then((response) => response.json())
      .then((data: { title: string }) => {
        useSessionStore.getState().updateSession(sessionId, { title: data.title });
        updateLlmActivity('title-gen', { status: 'done', finishedAt: Date.now() });
      })
      .catch((err: unknown) => {
        console.error('[ChatInterface] title generation failed', err instanceof Error ? err : new Error(String(err)));
        updateLlmActivity('title-gen', { status: 'error', finishedAt: Date.now() });
      });
  }, [addLlmActivity, updateLlmActivity]);

  useChatSocketEvents({
    hasPendingChunksForSession,
    requestGeneratedTitleIfNeeded,
    setAwaitingFirstChunk,
    setConnectionState,
    setError,
    setRecoveryNotice,
    setVfsRefreshSignal,
    toolArgProgressSeenRef,
  });


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
      if (!eventBus.connected) {
        setRecoveryNotice('Queued action is waiting for backend reconnect.');
        prevStreamingRef.current = isStreaming;
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
    prevStreamingRef.current = isStreaming;
  }, [isStreaming, addMessage]);

  const handleSendRef = useRef<(content: string, personaId: string) => void>(() => {});

  const handleSend = (content: string, personaId: string) => {
    if (!activeSessionId) return;
    // Guard against double-submit: check store state synchronously before any renders
    if (useAgentStore.getState().isStreaming) return;
    if (!eventBus.connected) {
      setError('Backend connection is offline. Reconnect and retry this message.');
      setRecoveryNotice('Connection is offline. Kalio will resync the session after reconnect.');
      return;
    }
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

    const sent = eventBus.sendMessage({
      sessionId: activeSessionId,
      content,
      personaId,
    });

    if (!sent) {
      setAwaitingFirstChunk(false);
      setStreaming(false);
      setError('Backend connection is offline. Reconnect and retry this message.');
    }
  };

  const handleArchitectureRun = async (content: string, schemaId: string) => {
    if (!activeSessionId) return;
    if (useAgentStore.getState().isStreaming) return;
    const schema = architectures.find((item) => item.id === schemaId);
    if (!schema) {
      setError('Selected architecture is no longer available. Refresh the registry and retry.');
      return;
    }

    setError(null);
    setRetryError(null);
    lastSentContentRef.current = content;
    clearToolActivities(activeSessionId);

    const { sessions, updateSession } = useSessionStore.getState();
    const session = sessions.find((item) => item.id === activeSessionId);
    if (session && session.title === DEFAULT_SESSION_TITLE && messages.length === 0) {
      void updateSession(activeSessionId, { title: `Architecture: ${buildOptimisticSessionTitle(content)}` });
    }

    const userMessageId = nanoid();
    addMessage({
      id: userMessageId,
      sessionId: activeSessionId,
      role: 'user',
      content: `[Architecture: ${schema.name}]\n${content}`,
      createdAt: Date.now(),
    });
    const pendingAssistantMessageId = `architecture:${userMessageId}:pending`;
    addMessage({
      id: pendingAssistantMessageId,
      sessionId: activeSessionId,
      role: 'assistant',
      content: 'Architecture run is starting.',
      architectureRun: {
        runId: pendingAssistantMessageId,
        schemaId,
        status: 'running',
        trace: [],
        routeHops: [],
      },
      createdAt: Date.now(),
    });
    setStreaming(true);
    setAwaitingFirstChunk(true);

    const addArchitectureAssistantMessage = (assistantContent: string) => {
      const assistantMessageId = nanoid();
      addMessage({
        id: assistantMessageId,
        sessionId: activeSessionId,
        role: 'assistant',
        content: assistantContent,
        createdAt: Date.now(),
      });
      const currentTurns = useSessionStore.getState().getSessionAgentTurns(activeSessionId);
      const turn: AgentTurn = {
        id: `architecture-turn-${assistantMessageId}`,
        sessionId: activeSessionId,
        promptMessageId: userMessageId,
        items: [{ kind: 'text', messageId: assistantMessageId }],
        done: true,
      };
      setAgentTurns([...currentTurns, turn], activeSessionId);
    };

    try {
      let sourceFiles: VFSFile[] = [];
      try {
        sourceFiles = (await getSessionVfsFiles(activeSessionId)).files;
      } catch (err: unknown) {
        console.error('[ChatInterface] architecture VFS context check failed', err);
      }
      if (sourceFiles.length === 0) {
        setRecoveryNotice('Architecture run has no session files attached. Agents will only use the prompt context.');
      }
      const applyArchitectureProjection = (result: Awaited<ReturnType<typeof startArchitectureRun>>) => {
        const projection = buildArchitectureRunTurnProjection(result, activeSessionId);
        const currentMessages = useSessionStore.getState()
          .getSessionMessages(activeSessionId)
          .filter((message) => message.id !== pendingAssistantMessageId)
          .filter((message) => !message.id.startsWith(`architecture:${result.run.id}:`));
        setMessages([...currentMessages, ...projection.messages], activeSessionId);
        const currentTurns = useSessionStore.getState()
          .getSessionAgentTurns(activeSessionId)
          .filter((turn) => turn.id !== `architecture-turn-${result.run.id}`);
        setAgentTurns([...currentTurns, {
          id: `architecture-turn-${result.run.id}`,
          sessionId: activeSessionId,
          promptMessageId: userMessageId,
          items: projection.turnItems,
          done: result.run.status !== 'queued' && result.run.status !== 'running',
        }], activeSessionId);
      };
      const result = schemaId === 'goal-master-delivery-loop'
        ? await startGoalGuardAgentFlowRun(
          content,
          buildGoalGuardRunContext(activeSessionId, sourceFiles),
          activeSessionId,
        )
        : await startArchitectureRun(
          schemaId,
          content,
          {},
          'subagent_execution',
          undefined,
          buildArchitectureRunContext(activeSessionId, sourceFiles),
          applyArchitectureProjection,
        );
      applyArchitectureProjection(result);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to run selected architecture';
      setError(message);
      const currentMessages = useSessionStore.getState()
        .getSessionMessages(activeSessionId)
        .filter((item) => item.id !== pendingAssistantMessageId);
      setMessages(currentMessages, activeSessionId);
      addArchitectureAssistantMessage(`Architecture run failed: ${message}`);
    } finally {
      setAwaitingFirstChunk(false);
      setStreaming(false);
    }
  };

  const handleComposerSend = (content: string, personaId: string) => {
    if (selectedArchitectureId !== 'single-chat') {
      void handleArchitectureRun(content, selectedArchitectureId);
      return;
    }
    handleSend(content, personaId);
  };

  handleSendRef.current = handleComposerSend;

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

  return (
    <div data-testid="chat-interface" className="flex h-full flex-col bg-base-200 rounded-xl border border-base-300 overflow-hidden">
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
            handleSend(content, session.personaId);
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
          rawContext={rawContext}
          vfsRefreshSignal={vfsRefreshSignal}
        />
      )}

      <div data-testid="message-list" className="flex-1 overflow-y-auto p-4 space-y-1">
        {messages.length === 0 && (
          <ChatWelcomeScreen
            activeSession={activeSession}
            activeSessionId={activeSessionId}
            architectures={architectures}
            isStreaming={composerStreaming}
            onArchitectureChange={setSelectedArchitectureId}
            onArchitectureRun={(content, schemaId) => void handleArchitectureRun(content, schemaId)}
            onPersonaChange={(personaId) => void handlePersonaChange(personaId)}
            onSend={handleSend}
            personas={personas}
            selectedArchitectureId={selectedArchitectureId}
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

      <ChatInput
        architectures={architectures}
        disabled={composerStreaming || !activeSessionId}
        isStreaming={composerStreaming}
        onArchitectureChange={setSelectedArchitectureId}
        onArchitectureRun={(content, schemaId) => void handleArchitectureRun(content, schemaId)}
        onSend={handleComposerSend}
        onStop={handleStop}
        selectedArchitectureId={selectedArchitectureId}
      />
    </div>
  );
}
