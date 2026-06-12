import { useRef, type MutableRefObject } from 'react';
import { nanoid } from 'nanoid';
import type { ChatMessage, VFSFile } from '@kalio/types';
import { useAgentStore } from '../../../store/agentStore';
import { useSessionStore, type AgentTurn } from '../../../store/sessionStore';
import { getSessionVfsFiles } from '../../../services/apiClient';
import { eventBus } from '../../../services/eventBus';
import { buildArchitectureRunTurnProjection } from '../architectureChatSummary';
import { startArchitectureRun, startGoalGuardAgentFlowRun } from '../../architect/architect.api';
import type { ArchitectSchema } from '../../architect/architect.types';
import {
  buildArchitectureRunContext,
  buildGoalGuardRunContext,
  persistArchitectureSessionRuntimeContext,
  persistSessionLaunchRuntimeContext,
} from '../launch/launchContext';

interface UseChatComposerActionsArgs {
  architectures: ArchitectSchema[];
  lastSentContentRef: MutableRefObject<string>;
  projectPath: string;
  requestGeneratedTitleIfNeeded: (sessionId: string | null) => void;
  selectedArchitectureId: string;
  setAwaitingFirstChunk: (value: boolean) => void;
  setDraftUserMessage: (value: string) => void;
  setError: (value: string | null) => void;
  setRetryError: (value: string | null) => void;
}

export function useChatComposerActions({
  architectures,
  lastSentContentRef,
  projectPath,
  requestGeneratedTitleIfNeeded,
  selectedArchitectureId,
  setAwaitingFirstChunk,
  setDraftUserMessage,
  setError,
  setRetryError,
}: UseChatComposerActionsArgs): {
  handleComposerSend: (content: string, personaId: string, options?: { interrupt?: boolean }) => void;
  handleSendRef: MutableRefObject<(content: string, personaId: string) => void>;
} {
  const handleSendRef = useRef<(content: string, personaId: string) => void>(() => {});
  const {
    activeSessionId,
    sessions,
    addMessage,
    setMessages,
    setAgentTurns,
    updateSession,
    getSessionMessages,
    getSessionAgentTurns,
  } = useSessionStore();
  const {
    isStreaming,
    clearToolActivities,
    setStreaming,
    hasActiveLoopForSession,
    getContextForSession,
  } = useAgentStore();

  const handleComposerSend = (content: string, personaId: string, options?: { interrupt?: boolean }) => {
    if (selectedArchitectureId !== 'single-chat') {
      void handleArchitectureRun(content, selectedArchitectureId);
      return;
    }
    void handleSend(content, personaId, options);
  };

  const handleSend = async (content: string, personaId: string, options?: { interrupt?: boolean }) => {
    if (!activeSessionId) return;
    if (!eventBus.connected) {
      setError('Backend connection is offline. Reconnect and retry this message.');
      setRetryError('Connection is offline. Kalio will resync the session after reconnect.');
      return;
    }

    setError(null);
    setRetryError(null);
    lastSentContentRef.current = content;
    const isActiveTurn = hasActiveLoopForSession(activeSessionId) || isStreaming;
    const shouldInterrupt = options?.interrupt === true;
    if (!isActiveTurn || shouldInterrupt) {
      clearToolActivities(activeSessionId);
    }

    const session = sessions.find((item) => item.id === activeSessionId);

    try {
      await persistSessionLaunchRuntimeContext(
        activeSessionId,
        projectPath,
        session?.runtimeContext,
        updateSession,
      );
    } catch (err: unknown) {
      console.error('[ChatInterface] session launch runtime context update failed', err instanceof Error ? err : new Error(String(err)));
      setError('Failed to save project scope for this session.');
      return;
    }

    const userMsg: ChatMessage = {
      id: nanoid(),
      sessionId: activeSessionId,
      role: 'user',
      content,
      createdAt: Date.now(),
    };
    addMessage(userMsg);

    if (!isActiveTurn || shouldInterrupt) {
      setAwaitingFirstChunk(true);
      setStreaming(true);
    }
    console.debug('[ChatInterface] sendMessage', {
      sessionId: activeSessionId,
      content: content.slice(0, 60),
      interrupt: shouldInterrupt,
      queued: isActiveTurn && !shouldInterrupt,
    });

    const sent = eventBus.sendMessage({
      sessionId: activeSessionId,
      content,
      personaId,
      interrupt: shouldInterrupt,
    });

    if (!sent) {
      setAwaitingFirstChunk(false);
      setStreaming(false);
      setError('Backend connection is offline. Reconnect and retry this message.');
    }
  };

  const handleArchitectureRun = async (content: string, schemaId: string) => {
    if (!activeSessionId) return;
    if (isStreaming) return;
    const schema = architectures.find((item) => item.id === schemaId);
    if (!schema) {
      setError('Selected architecture is no longer available. Refresh the registry and retry.');
      return;
    }

    setError(null);
    setRetryError(null);
    lastSentContentRef.current = content;
    setDraftUserMessage('');
    clearToolActivities(activeSessionId);
    const session = sessions.find((item) => item.id === activeSessionId);

    try {
      await persistArchitectureSessionRuntimeContext(
        activeSessionId,
        projectPath,
        session?.runtimeContext,
        {
          schemaId: schema.id,
          schemaName: schema.name,
          displayLabel: schema.name,
        },
        updateSession,
      );
    } catch (err: unknown) {
      console.error('[ChatInterface] architecture launch runtime context update failed', err instanceof Error ? err : new Error(String(err)));
      setError('Failed to save project scope for this session.');
      return;
    }

    const userMessageId = nanoid();
    addMessage({
      id: userMessageId,
      sessionId: activeSessionId,
      role: 'user',
      content,
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
      const currentTurns = getSessionAgentTurns(activeSessionId);
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
        console.debug('[ChatInterface] architecture run has no attached session files');
      }
      const contextGetter = typeof getContextForSession === 'function' ? getContextForSession : null;
      const activeToolNames = contextGetter ? (contextGetter(activeSessionId)?.activeToolNames ?? []) : [];
      const applyArchitectureProjection = (result: Awaited<ReturnType<typeof startArchitectureRun>>) => {
        const projection = buildArchitectureRunTurnProjection(result, activeSessionId);
        const currentMessages = getSessionMessages(activeSessionId)
          .filter((message) => message.id !== pendingAssistantMessageId)
          .filter((message) => !message.id.startsWith(`architecture:${result.run.id}:`));
        setMessages([...currentMessages, ...projection.messages], activeSessionId);
        const currentTurns = getSessionAgentTurns(activeSessionId)
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
          buildGoalGuardRunContext(activeSessionId, sourceFiles, activeToolNames, projectPath),
          activeSessionId,
        )
        : await startArchitectureRun(
          schemaId,
          content,
          {},
          'subagent_execution',
          undefined,
          buildArchitectureRunContext(activeSessionId, sourceFiles, activeToolNames, projectPath),
          applyArchitectureProjection,
        );
      applyArchitectureProjection(result);
      requestGeneratedTitleIfNeeded(activeSessionId);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to run selected architecture';
      setError(message);
      const currentMessages = getSessionMessages(activeSessionId)
        .filter((item) => item.id !== pendingAssistantMessageId);
      setMessages(currentMessages, activeSessionId);
      addArchitectureAssistantMessage(`Architecture run failed: ${message}`);
    } finally {
      setAwaitingFirstChunk(false);
      setStreaming(false);
    }
  };

  handleSendRef.current = handleComposerSend;

  return {
    handleComposerSend,
    handleSendRef,
  };
}
