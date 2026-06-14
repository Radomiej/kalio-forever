import { useRef, type MutableRefObject } from 'react';
import { useAgentStore } from '../../../store/agentStore';
import { useSessionStore } from '../../../store/sessionStore';
import type { ArchitectSchema } from '../../architect/architect.types';
import {
  launchSingleChatPrompt,
  launchWorkflowPrompt,
} from '../launch/sessionLaunchShared';

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

  const handleSend = async (content: string, personaId: string, options?: { interrupt?: boolean }) => {
    if (!activeSessionId) {
      return;
    }

    const session = sessions.find((item) => item.id === activeSessionId) ?? {
      id: activeSessionId,
      personaId: 'default',
      title: 'New Chat',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    lastSentContentRef.current = content;

    try {
      await launchSingleChatPrompt({
        session,
        content,
        personaId,
        projectPath,
        isStreaming,
        hasActiveLoop: typeof hasActiveLoopForSession === 'function'
          ? hasActiveLoopForSession(activeSessionId)
          : false,
        interrupt: options?.interrupt === true,
        clearToolActivities,
        setStreaming,
        setAwaitingFirstChunk,
        addMessage,
        updateSession,
        setError,
        setRetryError,
      });
    } catch (err: unknown) {
      console.error('[ChatInterface] session launch runtime context update failed', err instanceof Error ? err : new Error(String(err)));
      setError('Failed to save project scope for this session.');
    }
  };

  const handleArchitectureRun = async (content: string, schemaId: string) => {
    if (!activeSessionId || isStreaming) {
      return;
    }

    const session = sessions.find((item) => item.id === activeSessionId) ?? {
      id: activeSessionId,
      personaId: 'default',
      title: 'New Chat',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    lastSentContentRef.current = content;
    setDraftUserMessage('');
    const activeToolNames = getContextForSession(activeSessionId)?.activeToolNames ?? [];

    try {
      await launchWorkflowPrompt({
        session,
        content,
        schemaId,
        architectures,
        projectPath,
        activeToolNames,
        clearToolActivities,
        setStreaming,
        setAwaitingFirstChunk,
        addMessage,
        setMessages,
        setAgentTurns,
        getSessionMessages,
        getSessionAgentTurns,
        updateSession,
        setError,
        setRetryError,
        onComplete: requestGeneratedTitleIfNeeded,
      });
    } catch (err: unknown) {
      console.error('[ChatInterface] architecture launch runtime context update failed', err instanceof Error ? err : new Error(String(err)));
      setError('Failed to save project scope for this session.');
    }
  };

  const handleComposerSend = (content: string, personaId: string, options?: { interrupt?: boolean }) => {
    if (selectedArchitectureId !== 'single-chat') {
      void handleArchitectureRun(content, selectedArchitectureId);
      return;
    }

    void handleSend(content, personaId, options);
  };

  handleSendRef.current = handleComposerSend;

  return {
    handleComposerSend,
    handleSendRef,
  };
}
