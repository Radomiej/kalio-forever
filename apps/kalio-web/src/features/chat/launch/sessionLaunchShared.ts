import { nanoid } from 'nanoid';
import type { ChatMessage, ChatSession, VFSFile } from '@kalio/types';
import { apiClient, getSessionVfsFiles } from '../../../services/apiClient';
import { eventBus } from '../../../services/eventBus';
import type { AgentTurn } from '../../../store/sessionStore';
import { buildArchitectureRunTurnProjection } from '../architectureChatSummary';
import { resolveArchitectureRunTurnUpdate } from '../architectureTurnProjection';
import {
  startArchitectureRun,
  startGoalGuardAgentFlowRun,
} from '../../architect/architect.api';
import type { ArchitectSchema } from '../../architect/architect.types';
import {
  buildArchitectureRunContext,
  buildArchitectureSessionRuntimeContext,
  buildGoalGuardRunContext,
  persistArchitectureSessionRuntimeContext,
  persistSessionLaunchRuntimeContext,
} from './launchContext';

interface CreateAndActivateHostSessionParams {
  personaId: string;
  title?: string;
  runtimeContext?: ChatSession['runtimeContext'];
  addSession: (session: ChatSession) => void;
  setActiveSession: (sessionId: string | null) => void;
  setMessages: (messages: ChatMessage[], sessionId?: string | null) => void;
  setAgentTurns: (turns: AgentTurn[], sessionId?: string | null) => void;
}

interface LaunchSingleChatPromptParams {
  session: ChatSession;
  content: string;
  personaId: string;
  projectPath: string;
  isStreaming: boolean;
  hasActiveLoop: boolean;
  interrupt?: boolean;
  clearToolActivities: (sessionId?: string) => void;
  setStreaming: (streaming: boolean, messageId?: string, sessionId?: string | null) => void;
  setAwaitingFirstChunk?: (value: boolean) => void;
  addMessage: (message: ChatMessage) => void;
  updateSession: (id: string, patch: Partial<ChatSession>) => void;
  setError: (value: string | null) => void;
  setRetryError?: (value: string | null) => void;
  shouldSeedOptimisticTitle?: boolean;
}

interface LaunchWorkflowPromptParams {
  session: ChatSession;
  content: string;
  schemaId: string;
  architectures: ArchitectSchema[];
  projectPath: string;
  activeToolNames: string[];
  clearToolActivities: (sessionId?: string) => void;
  setStreaming: (streaming: boolean, messageId?: string, sessionId?: string | null) => void;
  setAwaitingFirstChunk?: (value: boolean) => void;
  addMessage: (message: ChatMessage) => void;
  setMessages: (messages: ChatMessage[], sessionId?: string | null) => void;
  setAgentTurns: (turns: AgentTurn[], sessionId?: string | null) => void;
  getSessionMessages: (sessionId: string) => ChatMessage[];
  getSessionAgentTurns: (sessionId: string) => AgentTurn[];
  updateSession: (id: string, patch: Partial<ChatSession>) => void;
  setError: (value: string | null) => void;
  setRetryError?: (value: string | null) => void;
  onComplete?: (sessionId: string) => void;
}

const WORKFLOW_SOURCE_FILE_DISCOVERY_TIMEOUT_MS = 1000;

function persistArchitectureSessionRuntimeContextInBackground({
  session,
  projectPath,
  schema,
  nextRuntimeContext,
  updateSession,
}: {
  session: ChatSession;
  projectPath: string;
  schema: ArchitectSchema;
  nextRuntimeContext: ChatSession['runtimeContext'];
  updateSession: (id: string, patch: Partial<ChatSession>) => void;
}): void {
  updateSession(session.id, { runtimeContext: nextRuntimeContext });
  void persistArchitectureSessionRuntimeContext(
    session.id,
    projectPath,
    session.runtimeContext,
    {
      schemaId: schema.id,
      schemaName: schema.name,
      displayLabel: schema.name,
    },
    updateSession,
  ).catch((err: unknown) => {
    console.error('[sessionLaunchShared] architecture session runtime context persistence failed after launch continued', err);
  });
}

function buildOptimisticSessionTitle(content: string): string {
  const preview = content.slice(0, 50).trim();
  return preview + (content.length > 50 ? '...' : '');
}

function seedOptimisticWorkflowEnvelope({
  sessionId,
  userMessageId,
  addMessage,
  currentTurns,
  setAgentTurns,
}: {
  sessionId: string;
  userMessageId: string;
  addMessage: (message: ChatMessage) => void;
  currentTurns: AgentTurn[];
  setAgentTurns: (turns: AgentTurn[], sessionId?: string | null) => void;
}): string {
  const pendingAssistantMessageId = `architecture:${userMessageId}:pending`;
  addMessage({
    id: pendingAssistantMessageId,
    sessionId,
    role: 'assistant',
    content: 'Architecture run is starting.',
    createdAt: Date.now(),
  });
  setAgentTurns([
    ...currentTurns,
    {
      id: `architecture-turn-${pendingAssistantMessageId}`,
      sessionId,
      promptMessageId: userMessageId,
      turnKind: 'workflow-envelope',
      items: [{ kind: 'text', messageId: pendingAssistantMessageId }],
      done: false,
    },
  ], sessionId);
  return pendingAssistantMessageId;
}

async function resolveWorkflowSourceFiles(sessionId: string): Promise<VFSFile[]> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  let timedOut = false;
  try {
    const filesPromise = getSessionVfsFiles(sessionId)
      .then((result) => result.files)
      .catch((err: unknown) => {
        if (!timedOut) {
          throw err;
        }
        console.error('[sessionLaunchShared] workflow VFS context check failed after launch continued', err);
        return [];
      });
    const timeoutPromise = new Promise<VFSFile[]>((resolve) => {
      timeoutId = setTimeout(() => {
        timedOut = true;
        console.warn('[sessionLaunchShared] workflow VFS context check timed out; launching without attached source files');
        resolve([]);
      }, WORKFLOW_SOURCE_FILE_DISCOVERY_TIMEOUT_MS);
    });
    return await Promise.race([filesPromise, timeoutPromise]);
  } catch (err: unknown) {
    console.error('[sessionLaunchShared] workflow VFS context check failed', err);
    return [];
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}

export async function createAndActivateHostSession({
  personaId,
  title = 'New Chat',
  runtimeContext,
  addSession,
  setActiveSession,
  setMessages,
  setAgentTurns,
}: CreateAndActivateHostSessionParams): Promise<ChatSession> {
  const response = await apiClient.post<ChatSession>('/api/sessions', {
    personaId,
    title,
    ...(runtimeContext ? { runtimeContext } : {}),
  });
  addSession(response.data);
  setActiveSession(response.data.id);
  setMessages([], response.data.id);
  setAgentTurns([], response.data.id);
  return response.data;
}

export async function launchSingleChatPrompt({
  session,
  content,
  personaId,
  projectPath,
  isStreaming,
  hasActiveLoop,
  interrupt = false,
  clearToolActivities,
  setStreaming,
  setAwaitingFirstChunk,
  addMessage,
  updateSession,
  setError,
  setRetryError,
  shouldSeedOptimisticTitle = false,
}: LaunchSingleChatPromptParams): Promise<boolean> {
  if (!eventBus.connected) {
    setError('Backend connection is offline. Reconnect and retry this message.');
    setRetryError?.('Connection is offline. Kalio will resync the session after reconnect.');
    return false;
  }

  setError(null);
  setRetryError?.(null);
  const isActiveTurn = hasActiveLoop || isStreaming;
  if (!isActiveTurn || interrupt) {
    clearToolActivities(session.id);
  }

  if (shouldSeedOptimisticTitle && (session.title === 'New Chat' || session.title === '')) {
    updateSession(session.id, { title: buildOptimisticSessionTitle(content) });
  }

  await persistSessionLaunchRuntimeContext(
    session.id,
    projectPath,
    session.runtimeContext,
    updateSession,
  );

  const userMessageId = nanoid();
  addMessage({
    id: userMessageId,
    sessionId: session.id,
    role: 'user',
    content,
    createdAt: Date.now(),
  });

  if (!isActiveTurn || interrupt) {
    setAwaitingFirstChunk?.(true);
    setStreaming(true, undefined, session.id);
  }

  const sent = eventBus.sendMessage({
    sessionId: session.id,
    content,
    personaId,
    interrupt,
    clientMessageId: userMessageId,
  });

  if (!sent) {
    setAwaitingFirstChunk?.(false);
    setStreaming(false, undefined, session.id);
    setError('Backend connection is offline. Reconnect and retry this message.');
    return false;
  }

  return true;
}

export async function launchWorkflowPrompt({
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
  onComplete,
}: LaunchWorkflowPromptParams): Promise<boolean> {
  const schema = architectures.find((item) => item.id === schemaId);
  if (!schema) {
    setError('Selected workflow is no longer available. Refresh the registry and retry.');
    return false;
  }

  setError(null);
  setRetryError?.(null);
  clearToolActivities(session.id);

  const nextRuntimeContext = buildArchitectureSessionRuntimeContext(session.runtimeContext, projectPath, {
    schemaId: schema.id,
    schemaName: schema.name,
    displayLabel: schema.name,
  });
  const sessionWithScope = nextRuntimeContext
    ? { ...session, runtimeContext: nextRuntimeContext }
    : session;
  if (nextRuntimeContext && JSON.stringify(session.runtimeContext ?? null) !== JSON.stringify(nextRuntimeContext)) {
    persistArchitectureSessionRuntimeContextInBackground({
      session,
      projectPath,
      schema,
      nextRuntimeContext,
      updateSession,
    });
  }

  const userMessageId = nanoid();
  addMessage({
    id: userMessageId,
    sessionId: sessionWithScope.id,
    role: 'user',
    content,
    createdAt: Date.now(),
  });
  const pendingAssistantMessageId = seedOptimisticWorkflowEnvelope({
    sessionId: sessionWithScope.id,
    userMessageId,
    addMessage,
    currentTurns: getSessionAgentTurns(sessionWithScope.id),
    setAgentTurns,
  });
  setStreaming(true, undefined, sessionWithScope.id);
  setAwaitingFirstChunk?.(true);

  const applyArchitectureProjection = (result: Awaited<ReturnType<typeof startArchitectureRun>>) => {
    const projection = buildArchitectureRunTurnProjection(result, sessionWithScope.id);
    const resolvedProjection = resolveArchitectureRunTurnUpdate({
      currentMessages: getSessionMessages(sessionWithScope.id),
      currentTurns: getSessionAgentTurns(sessionWithScope.id),
      pendingAssistantMessageId,
      promptMessageId: userMessageId,
      projection,
      result,
      sessionId: sessionWithScope.id,
    });
    setMessages(resolvedProjection.messages, sessionWithScope.id);
    setAgentTurns(resolvedProjection.turns, sessionWithScope.id);
  };

  const addFailureAssistantMessage = (message: string) => {
    const assistantMessageId = nanoid();
    addMessage({
      id: assistantMessageId,
      sessionId: sessionWithScope.id,
      role: 'assistant',
      content: message,
      createdAt: Date.now(),
    });
    setAgentTurns([
      ...getSessionAgentTurns(sessionWithScope.id),
      {
        id: `architecture-turn-${assistantMessageId}`,
        sessionId: sessionWithScope.id,
        promptMessageId: userMessageId,
        items: [{ kind: 'text', messageId: assistantMessageId }],
        done: true,
      },
    ], sessionWithScope.id);
  };

  try {
    const sourceFiles = await resolveWorkflowSourceFiles(sessionWithScope.id);
    const result = schemaId === 'goal-master-delivery-loop'
      ? await startGoalGuardAgentFlowRun(
        content,
        buildGoalGuardRunContext(sessionWithScope.id, sourceFiles, activeToolNames, projectPath, userMessageId),
        sessionWithScope.id,
        applyArchitectureProjection,
      )
      : await startArchitectureRun(
        schemaId,
        content,
        {},
        'subagent_execution',
        undefined,
        buildArchitectureRunContext(sessionWithScope.id, sourceFiles, activeToolNames, projectPath, userMessageId),
        applyArchitectureProjection,
      );
    applyArchitectureProjection(result);
    onComplete?.(sessionWithScope.id);
    return true;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to run selected workflow';
    setError(message);
    const currentMessages = getSessionMessages(sessionWithScope.id)
      .filter((item) => item.id !== pendingAssistantMessageId);
    setMessages(currentMessages, sessionWithScope.id);
    addFailureAssistantMessage(`Workflow run failed: ${message}`);
    return false;
  } finally {
    setAwaitingFirstChunk?.(false);
    setStreaming(false, undefined, sessionWithScope.id);
  }
}
