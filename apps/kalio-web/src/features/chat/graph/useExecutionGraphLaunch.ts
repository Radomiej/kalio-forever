import { useEffect, useState, type Dispatch, type SetStateAction } from 'react';
import { nanoid } from 'nanoid';
import type { ChatSession, Persona, VFSFile } from '@kalio/types';
import { useAgentStore } from '../../../store/agentStore';
import { useSessionStore, type AgentTurn } from '../../../store/sessionStore';
import { apiClient, getSessionVfsFiles } from '../../../services/apiClient';
import { eventBus } from '../../../services/eventBus';
import { buildArchitectureRunTurnProjection } from '../architectureChatSummary';
import { getArchitectureSchemas, startArchitectureRun, startGoalGuardAgentFlowRun } from '../../architect/architect.api';
import type { ArchitectSchema } from '../../architect/architect.types';
import {
  buildArchitectureRunContext,
  buildGoalGuardRunContext,
  buildSessionLaunchRuntimeContext,
  getLaunchProjectPath,
  persistSessionLaunchRuntimeContext,
} from '../launch/launchContext';

export interface ExecutionGraphLaunchState {
  activeSession: ChatSession | null;
  architectures: ArchitectSchema[];
  creatingGraphSession: boolean;
  emptyPromptError: string | null;
  isBusy: boolean;
  personas: Persona[];
  projectPath: string;
  selectedArchitectureId: string;
  selectedPersonaId: string;
  setProjectPath: Dispatch<SetStateAction<string>>;
  setSelectedArchitectureId: Dispatch<SetStateAction<string>>;
  setSelectedPersonaId: Dispatch<SetStateAction<string>>;
  sendEmptyGraphPrompt: (content: string) => void;
  handleGraphSessionPersonaChange: (personaId: string) => void;
}

export function useExecutionGraphLaunch(): ExecutionGraphLaunchState {
  const {
    activeSessionId,
    sessionMessages,
    sessionAgentTurns,
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
    clearToolActivities,
    getContextForSession,
    setStreaming,
  } = useAgentStore();
  const [personas, setPersonas] = useState<Persona[]>([]);
  const [architectures, setArchitectures] = useState<ArchitectSchema[]>([]);
  const [selectedPersonaId, setSelectedPersonaId] = useState('default');
  const [selectedArchitectureId, setSelectedArchitectureId] = useState('single-chat');
  const [projectPath, setProjectPath] = useState('');
  const [emptyPromptError, setEmptyPromptError] = useState<string | null>(null);
  const [creatingGraphSession, setCreatingGraphSession] = useState(false);
  const activeSession = sessions.find((session) => session.id === activeSessionId) ?? null;
  const activeContext = typeof getContextForSession === 'function'
    ? getContextForSession(activeSessionId)
    : null;
  const activeToolNames = activeContext?.activeToolNames ?? [];
  const getMessagesForSession = (sessionId: string) => (
    typeof getSessionMessages === 'function'
      ? getSessionMessages(sessionId)
      : sessionMessages[sessionId] ?? []
  );
  const getAgentTurnsForSession = (sessionId: string) => (
    typeof getSessionAgentTurns === 'function'
      ? getSessionAgentTurns(sessionId)
      : sessionAgentTurns[sessionId] ?? []
  );

  useEffect(() => {
    apiClient
      .get<Persona[]>('/api/personas')
      .then((response) => setPersonas(response.data))
      .catch((err: unknown) => console.error('[ExecutionGraphView] personas load failed', err));
  }, []);

  useEffect(() => {
    getArchitectureSchemas()
      .then((schemas) => setArchitectures(schemas))
      .catch((err: unknown) => console.error('[ExecutionGraphView] architecture registry load failed', err));
  }, []);

  useEffect(() => {
    setSelectedPersonaId(activeSession?.personaId ?? 'default');
    setProjectPath(getLaunchProjectPath(activeSession?.runtimeContext));
  }, [activeSession?.personaId, activeSession?.runtimeContext, activeSessionId]);

  const sendGraphPromptToSession = async (session: ChatSession, content: string, isFirstMessage: boolean) => {
    if (isStreaming) {
      return;
    }
    if (!eventBus.connected) {
      setEmptyPromptError('Backend connection is offline. Reconnect and retry this message.');
      return;
    }

    setEmptyPromptError(null);
    clearToolActivities(session.id);
    if ((session.title === 'New Chat' || session.title === '') && isFirstMessage) {
      const preview = content.slice(0, 50).trim();
      updateSession(session.id, { title: preview + (content.length > 50 ? '...' : '') });
    }

    const nextRuntimeContext = buildSessionLaunchRuntimeContext(session.runtimeContext, projectPath);
    const sessionWithScope = nextRuntimeContext
      ? { ...session, runtimeContext: nextRuntimeContext }
      : session;
    if (nextRuntimeContext && JSON.stringify(session.runtimeContext ?? null) !== JSON.stringify(nextRuntimeContext)) {
      try {
        await persistSessionLaunchRuntimeContext(session.id, projectPath, session.runtimeContext, updateSession);
      } catch {
        return;
      }
    }

    addMessage({
      id: nanoid(),
      sessionId: sessionWithScope.id,
      role: 'user',
      content,
      createdAt: Date.now(),
    });
    setStreaming(true);

    const sent = eventBus.sendMessage({
      sessionId: sessionWithScope.id,
      content,
      personaId: sessionWithScope.personaId,
    });

    if (!sent) {
      setStreaming(false);
      setEmptyPromptError('Backend connection is offline. Reconnect and retry this message.');
    }
  };

  const runGraphArchitecturePrompt = async (session: ChatSession, content: string, schemaId: string, isFirstMessage: boolean) => {
    if (isStreaming || creatingGraphSession) {
      return;
    }
    const schema = architectures.find((item) => item.id === schemaId);
    if (!schema) {
      setEmptyPromptError('Selected workflow is no longer available. Refresh the registry and retry.');
      return;
    }

    setEmptyPromptError(null);
    clearToolActivities(session.id);
    if ((session.title === 'New Chat' || session.title === '') && isFirstMessage) {
      const preview = content.slice(0, 50).trim();
      updateSession(session.id, { title: preview + (content.length > 50 ? '...' : '') });
    }

    const nextRuntimeContext = buildSessionLaunchRuntimeContext(session.runtimeContext, projectPath);
    const sessionWithScope = nextRuntimeContext
      ? { ...session, runtimeContext: nextRuntimeContext }
      : session;
    if (nextRuntimeContext && JSON.stringify(session.runtimeContext ?? null) !== JSON.stringify(nextRuntimeContext)) {
      try {
        await persistSessionLaunchRuntimeContext(session.id, projectPath, session.runtimeContext, updateSession);
      } catch {
        return;
      }
    }
    const userMessageId = nanoid();
    addMessage({
      id: userMessageId,
      sessionId: sessionWithScope.id,
      role: 'user',
      content: `[Architecture: ${schema.name}]\n${content}`,
      createdAt: Date.now(),
    });
    const pendingAssistantMessageId = `architecture:${userMessageId}:pending`;
    addMessage({
      id: pendingAssistantMessageId,
      sessionId: sessionWithScope.id,
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

    const addArchitectureAssistantMessage = (assistantContent: string) => {
      const assistantMessageId = nanoid();
      addMessage({
        id: assistantMessageId,
        sessionId: sessionWithScope.id,
        role: 'assistant',
        content: assistantContent,
        createdAt: Date.now(),
      });
      const currentTurns = getSessionAgentTurns(sessionWithScope.id);
      const turn: AgentTurn = {
        id: `architecture-turn-${assistantMessageId}`,
        sessionId: sessionWithScope.id,
        promptMessageId: userMessageId,
        items: [{ kind: 'text', messageId: assistantMessageId }],
        done: true,
      };
      setAgentTurns([...currentTurns, turn], sessionWithScope.id);
    };

    try {
      let sourceFiles: VFSFile[] = [];
      try {
        sourceFiles = (await getSessionVfsFiles(sessionWithScope.id)).files;
      } catch (err: unknown) {
        console.error('[ExecutionGraphView] architecture VFS context check failed', err);
      }
      const applyArchitectureProjection = (result: Awaited<ReturnType<typeof startArchitectureRun>>) => {
        const projection = buildArchitectureRunTurnProjection(result, sessionWithScope.id);
        const currentMessages = getMessagesForSession(sessionWithScope.id)
          .filter((message) => message.id !== pendingAssistantMessageId)
          .filter((message) => !message.id.startsWith(`architecture:${result.run.id}:`));
        setMessages([...currentMessages, ...projection.messages], sessionWithScope.id);
        const currentTurns = getAgentTurnsForSession(sessionWithScope.id)
          .filter((turn) => turn.id !== `architecture-turn-${result.run.id}`);
        setAgentTurns([...currentTurns, {
          id: `architecture-turn-${result.run.id}`,
          sessionId: sessionWithScope.id,
          promptMessageId: userMessageId,
          items: projection.turnItems,
          done: result.run.status !== 'queued' && result.run.status !== 'running',
        }], sessionWithScope.id);
      };
      const result = schemaId === 'goal-master-delivery-loop'
        ? await startGoalGuardAgentFlowRun(
          content,
          buildGoalGuardRunContext(sessionWithScope.id, sourceFiles, activeToolNames, projectPath),
          sessionWithScope.id,
        )
        : await startArchitectureRun(
          schemaId,
          content,
          {},
          'subagent_execution',
          undefined,
          buildArchitectureRunContext(sessionWithScope.id, sourceFiles, activeToolNames, projectPath),
          applyArchitectureProjection,
        );
      applyArchitectureProjection(result);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to run selected workflow';
      setEmptyPromptError(message);
      const currentMessages = getMessagesForSession(sessionWithScope.id)
        .filter((item) => item.id !== pendingAssistantMessageId);
      setMessages(currentMessages, sessionWithScope.id);
      addArchitectureAssistantMessage(`Workflow run failed: ${message}`);
    } finally {
      setStreaming(false);
    }
  };

  const ensureGraphSession = async (): Promise<ChatSession | null> => {
    if (activeSession) {
      return activeSession;
    }

    if (isStreaming || creatingGraphSession) {
      return null;
    }
    if (!eventBus.connected) {
      setEmptyPromptError('Backend connection is offline. Reconnect and retry this message.');
      return null;
    }

    setCreatingGraphSession(true);
    setEmptyPromptError(null);
    try {
      const runtimeContext = buildSessionLaunchRuntimeContext(undefined, projectPath);
      const dto: { personaId: string; title: string; runtimeContext?: ReturnType<typeof buildSessionLaunchRuntimeContext> } = {
        personaId: selectedPersonaId,
        title: 'New Chat',
      };
      if (runtimeContext) {
        dto.runtimeContext = runtimeContext;
      }
      const response = await apiClient.post<ChatSession>('/api/sessions', {
        ...dto,
      });
      addSession(response.data);
      setActiveSession(response.data.id);
      setMessages([], response.data.id);
      return response.data;
    } catch (err) {
      setEmptyPromptError(err instanceof Error ? err.message : 'Failed to create a graph chat.');
      return null;
    } finally {
      setCreatingGraphSession(false);
    }
  };

  const handleGraphLaunchPrompt = async (content: string) => {
    if (activeSession) {
      const isFirstMessage = (sessionMessages[activeSession.id]?.length ?? 0) === 0;
      if (selectedArchitectureId !== 'single-chat') {
        await runGraphArchitecturePrompt(activeSession, content, selectedArchitectureId, isFirstMessage);
        return;
      }
      await sendGraphPromptToSession(activeSession, content, isFirstMessage);
      return;
    }

    const session = await ensureGraphSession();
    if (!session) {
      return;
    }

    const isFirstMessage = (sessionMessages[session.id]?.length ?? 0) === 0;
    if (selectedArchitectureId !== 'single-chat') {
      await runGraphArchitecturePrompt(session, content, selectedArchitectureId, isFirstMessage);
      return;
    }
    await sendGraphPromptToSession(session, content, isFirstMessage);
  };

  const handleGraphSessionPersonaChange = (personaId: string) => {
    if (!activeSessionId) {
      setSelectedPersonaId(personaId);
      return;
    }
    void apiClient.patch(`/api/sessions/${activeSessionId}`, { personaId })
      .then(() => {
        updateSession(activeSessionId, { personaId });
        setSelectedPersonaId(personaId);
      })
      .catch((err: unknown) => {
        console.error('[ExecutionGraphView] persona change failed', err instanceof Error ? err : new Error(String(err)));
      });
  };

  const sendEmptyGraphPrompt = (content: string) => {
    void handleGraphLaunchPrompt(content);
  };

  return {
    activeSession,
    architectures,
    creatingGraphSession,
    emptyPromptError,
    isBusy: isStreaming || creatingGraphSession,
    personas,
    projectPath,
    selectedArchitectureId,
    selectedPersonaId,
    setProjectPath,
    setSelectedArchitectureId,
    setSelectedPersonaId,
    sendEmptyGraphPrompt,
    handleGraphSessionPersonaChange,
  };
}
