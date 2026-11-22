import { useRef, type MutableRefObject } from 'react';
import { useAgentStore } from '../../../store/agentStore';
import { useSessionStore } from '../../../store/sessionStore';
import type { ArchitectSchema } from '../../architect/architect.types';
import { uploadComposerImages, type ComposerSendOptions } from '../composerImages';
import { findArchitectureRunInMessages } from '../architectureChatSummary';
import {
  launchSingleChatPrompt,
  launchWorkflowPrompt,
} from '../launch/sessionLaunchShared';

interface UseChatComposerActionsArgs {
  architectures: ArchitectSchema[];
  lastSentContentRef: MutableRefObject<string>;
  projectPath: string;
  requestGeneratedTitleIfNeeded: (sessionId: string | null) => void;
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
  setAwaitingFirstChunk,
  setDraftUserMessage,
  setError,
  setRetryError,
}: UseChatComposerActionsArgs): {
  handleComposerSend: (content: string, personaId: string, options?: ComposerSendOptions) => boolean | void | Promise<boolean | void>;
  handleArchitectureRun: (content: string, schemaId: string) => Promise<void>;
  handleSendRef: MutableRefObject<(content: string, personaId: string) => void>;
} {
  const handleSendRef = useRef<(content: string, personaId: string) => void>(() => {});
  const {
    activeSessionId,
    addMessage,
    setMessages,
    setAgentTurns,
    updateSession,
    getSessionMessages,
    getSessionAgentTurns,
  } = useSessionStore();
  const {
    isStreaming,
    streamingSessionId,
    clearToolActivities,
    setStreaming,
    hasActiveLoopForSession,
    getContextForSession,
  } = useAgentStore();
  const isStreamingForActiveSession = isStreaming && streamingSessionId === activeSessionId;

  const handleSend = async (content: string, personaId: string, options?: ComposerSendOptions) => {
    const { activeSessionId, sessions } = useSessionStore.getState();
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

    const hasImages = Boolean(options?.images?.length || options?.attachments?.length);
    lastSentContentRef.current = hasImages ? '' : content;

    try {
      const attachments = options?.images?.length
        ? await uploadComposerImages(activeSessionId, options.images)
        : options?.attachments;
      if (hasImages && useSessionStore.getState().activeSessionId !== activeSessionId) return false;
      return await launchSingleChatPrompt({
        session,
        content,
        personaId,
        projectPath,
        isStreaming: isStreamingForActiveSession,
        hasActiveLoop: typeof hasActiveLoopForSession === 'function'
          ? hasActiveLoopForSession(activeSessionId)
          : false,
        interrupt: options?.interrupt === true,
        ...(attachments?.length ? { attachments } : {}),
        clearToolActivities,
        setStreaming,
        setAwaitingFirstChunk,
        addMessage,
        updateSession,
        setError,
        ...(hasImages ? {} : { setRetryError }),
      });
    } catch (err: unknown) {
      console.error('[ChatInterface] session launch runtime context update failed', err instanceof Error ? err : new Error(String(err)));
      setError(hasImages ? 'Failed to send the images. Check your connection and retry.' : 'Failed to save project scope for this session.');
      return false;
    }
  };

  const handleArchitectureRun = async (content: string, schemaId: string) => {
    const { activeSessionId, sessions } = useSessionStore.getState();
    if (!activeSessionId || isStreamingForActiveSession) {
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

  const handleComposerSend = (content: string, personaId: string, options?: ComposerSendOptions) => {
    const state = useSessionStore.getState();
    const session = state.sessions.find((item) => item.id === state.activeSessionId);
    const persistedSchemaId = session?.runtimeContext?.architectureContext?.['schemaId'];
    // TODO: legacy fallback — older workflow sessions only persisted architecture metadata in messages.
    const schemaId = typeof persistedSchemaId === 'string' && persistedSchemaId.trim()
      ? persistedSchemaId
      : findArchitectureRunInMessages(state.getSessionMessages(state.activeSessionId))?.schemaId ?? 'single-chat';
    if (schemaId !== 'single-chat') {
      if (options?.images?.length || options?.attachments?.length) {
        setError('Image attachments are unavailable in this workflow.');
        return false;
      }
      void handleArchitectureRun(content, schemaId);
      return;
    }

    return handleSend(content, personaId, options);
  };

  handleSendRef.current = handleComposerSend;

  return {
    handleComposerSend,
    handleArchitectureRun,
    handleSendRef,
  };
}
