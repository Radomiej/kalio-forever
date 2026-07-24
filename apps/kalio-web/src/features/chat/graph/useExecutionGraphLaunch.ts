import { useEffect, useState, type Dispatch, type SetStateAction } from 'react';
import type { ChatSession, Persona } from '@kalio/types';
import { useAgentStore } from '../../../store/agentStore';
import { useSessionStore } from '../../../store/sessionStore';
import { apiClient } from '../../../services/apiClient';
import { getArchitectureSchemas } from '../../architect/architect.api';
import type { ArchitectSchema } from '../../architect/architect.types';
import {
  buildSessionLaunchRuntimeContext,
  getLaunchProjectPath,
  persistSessionLaunchPersona,
} from '../launch/launchContext';
import {
  launchSingleChatPrompt,
  launchWorkflowPrompt,
} from '../launch/sessionLaunchShared';
import { createAndActivateEmptyHostSession } from '../activeConversationSession';
import { useLaunchPersonas } from '../launch/useLaunchPersonas';

export interface ExecutionGraphLaunchState {
  activeSession: ChatSession | null;
  architectures: ArchitectSchema[];
  creatingGraphSession: boolean;
  emptyPromptError: string | null;
  isBusy: boolean;
  personas: Persona[];
  projectPath: string;
  projectId: string;
  selectedPersonaId: string;
  selectedArchitectureId: string;
  setProjectPath: Dispatch<SetStateAction<string>>;
  setProjectId: Dispatch<SetStateAction<string>>;
  setSelectedPersonaId: Dispatch<SetStateAction<string>>;
  setSelectedArchitectureId: Dispatch<SetStateAction<string>>;
  sendEmptyGraphPrompt: (content: string) => void;
}

export function useExecutionGraphLaunch(): ExecutionGraphLaunchState {
  const {
    activeSessionId,
    sessionMessages,
    sessions,
    addSession,
    addMessage,
    setActiveSession,
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
    getContextForSession,
    setStreaming,
    hasActiveLoopForSession,
  } = useAgentStore();
  const isStreamingForActiveSession = isStreaming && streamingSessionId === activeSessionId;
  const [architectures, setArchitectures] = useState<ArchitectSchema[]>([]);
  const [selectedArchitectureId, setSelectedArchitectureId] = useState('single-chat');
  const [projectPath, setProjectPath] = useState('');
  const [projectId, setProjectId] = useState('system:none');
  const [emptyPromptError, setEmptyPromptError] = useState<string | null>(null);
  const [creatingGraphSession, setCreatingGraphSession] = useState(false);
  const activeSession = sessions.find((session) => session.id === activeSessionId) ?? null;
  useEffect(() => {
    setProjectId(activeSession?.projectId ?? 'system:none');
  }, [activeSession?.projectId, activeSessionId]);
  const {
    personas,
    selectedPersonaId,
    setSelectedPersonaId,
  } = useLaunchPersonas(activeSession?.personaId);
  const activeToolNames = typeof getContextForSession === 'function'
    ? (getContextForSession(activeSessionId)?.activeToolNames ?? [])
    : [];
  const getMessagesForSession = (sessionId: string) => (
    typeof getSessionMessages === 'function'
      ? getSessionMessages(sessionId)
      : sessionMessages[sessionId] ?? []
  );
  const getTurnsForSession = (sessionId: string) => (
    typeof getSessionAgentTurns === 'function'
      ? getSessionAgentTurns(sessionId)
      : []
  );

  useEffect(() => {
    getArchitectureSchemas()
      .then((schemas) => setArchitectures(schemas))
      .catch((err: unknown) => console.error('[ExecutionGraphView] architecture registry load failed', err));
  }, []);

  useEffect(() => {
    setProjectPath(getLaunchProjectPath(activeSession?.runtimeContext));
  }, [activeSession?.runtimeContext, activeSessionId]);

  const requestWorkflowTitle = (sessionId: string, shouldGenerateTitle: boolean) => {
    if (!shouldGenerateTitle) {
      return;
    }

    void apiClient.post<{ title: string }>(`/api/sessions/${sessionId}/generate-title`)
      .then((response) => {
        updateSession(sessionId, { title: response.data.title });
      })
      .catch((err: unknown) => {
        console.error('[ExecutionGraphView] workflow title generation failed', err instanceof Error ? err : new Error(String(err)));
      });
  };

  const ensureGraphSession = async (personaId: string): Promise<ChatSession | null> => {
    if (activeSession) {
      return activeSession;
    }

    if (isStreamingForActiveSession || creatingGraphSession) {
      return null;
    }

    setCreatingGraphSession(true);
    setEmptyPromptError(null);
    try {
      return await createAndActivateEmptyHostSession({
        personaId,
        projectId,
        runtimeContext: buildSessionLaunchRuntimeContext(undefined, projectPath) ?? undefined,
        addSession,
        setActiveSession,
        setMessages,
        setAgentTurns,
        reason: 'graph',
      });
    } catch (err) {
      setEmptyPromptError(err instanceof Error ? err.message : 'Failed to create a graph chat.');
      return null;
    } finally {
      setCreatingGraphSession(false);
    }
  };

  const sendGraphPromptToSession = async (session: ChatSession, content: string, isFirstMessage: boolean, personaId: string) => {
    try {
      const sessionWithPersona = await persistSessionLaunchPersona(session, personaId, updateSession);
      await launchSingleChatPrompt({
        session: sessionWithPersona,
        content,
        personaId,
        projectPath,
        isStreaming: isStreamingForActiveSession,
        hasActiveLoop: typeof hasActiveLoopForSession === 'function'
          ? hasActiveLoopForSession(session.id)
          : false,
        clearToolActivities,
        setStreaming,
        addMessage,
        updateSession,
        setError: setEmptyPromptError,
        shouldSeedOptimisticTitle: isFirstMessage,
      });
    } catch (err: unknown) {
      console.error('[ExecutionGraphView] graph session launch failed', err instanceof Error ? err : new Error(String(err)));
      setEmptyPromptError('Failed to save project scope for this session.');
    }
  };

  const runGraphArchitecturePrompt = async (session: ChatSession, content: string, schemaId: string, isFirstMessage: boolean) => {
    if (isStreamingForActiveSession || creatingGraphSession) {
      return;
    }

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
        addMessage,
        setMessages,
        setAgentTurns,
        getSessionMessages: getMessagesForSession,
        getSessionAgentTurns: getTurnsForSession,
        updateSession,
        setError: setEmptyPromptError,
        onComplete: (sessionId) => requestWorkflowTitle(
          sessionId,
          isFirstMessage || session.title === 'New Chat' || session.title === '',
        ),
      });
    } catch (err: unknown) {
      console.error('[ExecutionGraphView] workflow launch failed', err instanceof Error ? err : new Error(String(err)));
      setEmptyPromptError('Failed to save project scope for this session.');
    }
  };

  const handleGraphLaunchPrompt = async (content: string) => {
    const isWorkflowMode = selectedArchitectureId !== 'single-chat';
    const chatPersonaId = selectedPersonaId;

    const session = activeSession ?? await ensureGraphSession(isWorkflowMode ? 'default' : chatPersonaId);
    if (!session) {
      return;
    }

    const isFirstMessage = getMessagesForSession(session.id).length === 0;
    if (isWorkflowMode) {
      await runGraphArchitecturePrompt(session, content, selectedArchitectureId, isFirstMessage);
      return;
    }

    await sendGraphPromptToSession(session, content, isFirstMessage, chatPersonaId);
  };

  const sendEmptyGraphPrompt = (content: string) => {
    void handleGraphLaunchPrompt(content);
  };

  return {
    activeSession,
    architectures,
    creatingGraphSession,
    emptyPromptError,
    isBusy: isStreamingForActiveSession || creatingGraphSession,
    personas,
    projectPath,
    projectId,
    selectedPersonaId,
    selectedArchitectureId,
    setProjectPath,
    setProjectId,
    setSelectedPersonaId,
    setSelectedArchitectureId,
    sendEmptyGraphPrompt,
  };
}
