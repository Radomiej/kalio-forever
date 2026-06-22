import type {
  ArchitectureChatProjection,
  ArchitectureExecutionEvent,
  ArchitectureGraphProjection,
  ChatMessage,
  ChatSession,
} from '@kalio/types';
import { apiClient } from '../../services/apiClient';
import { buildArchitectureRunMetadata, findArchitectureRunInMessages } from './architectureChatSummary';
import { buildTurnsFromHistory, mergeFetchedMessages } from './chatUtils';
import { architectureRunIdForSession } from '../sessions/sessionTreeDisplay';

type SetMessages = (messages: ChatMessage[], sessionId?: string | null) => void;
type SetAgentTurns = (turns: ReturnType<typeof buildTurnsFromHistory>, sessionId?: string | null) => void;
type FetchMessages = (sessionId: string) => Promise<ChatMessage[]>;
type FetchArchitectureRunProjection = (
  runId: string,
) => Promise<{
  chat: ArchitectureChatProjection;
  events: ArchitectureExecutionEvent[];
  graph: ArchitectureGraphProjection;
}>;
type GetSessions = () => ChatSession[];
type GetSessionMessages = (sessionId: string) => ChatMessage[];

function defaultFetchMessages(sessionId: string): Promise<ChatMessage[]> {
  return apiClient
    .get<ChatMessage[]>(`/api/sessions/${sessionId}/messages`)
    .then((response) => response.data);
}

function defaultFetchArchitectureRunProjection(
  runId: string,
): Promise<{
  chat: ArchitectureChatProjection;
  events: ArchitectureExecutionEvent[];
  graph: ArchitectureGraphProjection;
}> {
  return Promise.all([
    apiClient.get<ArchitectureExecutionEvent[]>(`/api/architecture-runs/${runId}/events`),
    apiClient.get<ArchitectureGraphProjection>(`/api/architecture-runs/${runId}/graph`),
    apiClient.get<ArchitectureChatProjection>(`/api/architecture-runs/${runId}/chat`),
  ]).then(([events, graph, chat]) => ({
    chat: chat.data,
    events: events.data,
    graph: graph.data,
  }));
}

function buildReloadedArchitectureSummaryMessage(
  sessionId: string,
  messages: ChatMessage[],
  summary: NonNullable<ReturnType<typeof findArchitectureRunInMessages>>,
): ChatMessage {
  const firstAssistantAt = messages
    .filter((message) => message.role === 'assistant')
    .map((message) => message.createdAt)
    .sort((left, right) => left - right)[0];
  const lastUserAt = [...messages]
    .reverse()
    .find((message) => message.role === 'user')
    ?.createdAt ?? Date.now();

  return {
    id: `architecture-rehydrate:${sessionId}:${summary.runId}`,
    sessionId,
    role: 'assistant',
    content: '',
    architectureRun: {
      ...summary,
      finalArtifact: undefined,
    },
    createdAt: typeof firstAssistantAt === 'number' ? Math.max(0, firstAssistantAt - 1) : lastUserAt + 1,
  };
}

function persistedArchitectureRunInMessages(
  messages: ChatMessage[],
): NonNullable<ReturnType<typeof findArchitectureRunInMessages>> | null {
  const persisted = [...messages].reverse().find((message) => message.architectureRun)?.architectureRun;
  return persisted ?? null;
}

function architectureContextValue(session: ChatSession, key: string): string | null {
  const value = session.runtimeContext?.architectureContext?.[key];
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function matchesArchitectureNodeEvent(
  event: ArchitectureExecutionEvent,
  node: ArchitectureGraphProjection['nodes'][number] | undefined,
  roleSlotId: string | null,
): boolean {
  if (node && event.nodeId === node.id) {
    return true;
  }
  return roleSlotId !== null && event.roleSlotId === roleSlotId;
}

function matchesArchitectureNodeChatMessage(
  message: ArchitectureChatProjection['messages'][number],
  node: ArchitectureGraphProjection['nodes'][number] | undefined,
  roleSlotId: string | null,
): boolean {
  if (node?.eventIds.includes(message.eventId)) {
    return true;
  }
  return roleSlotId !== null && message.roleSlotId === roleSlotId;
}

function buildSyntheticArchitectureChildMessage(
  session: ChatSession,
  projection: {
    chat: ArchitectureChatProjection;
    events: ArchitectureExecutionEvent[];
    graph: ArchitectureGraphProjection;
  },
): ChatMessage | null {
  const runId = architectureRunIdForSession(session);
  if (!runId) {
    return null;
  }

  const roleSlotId = architectureContextValue(session, 'roleSlotId')
    ?? session.runtimeContext?.architectureSlotId
    ?? null;
  const node = projection.graph.nodes.find((candidate) => candidate.sessionId === session.id);
  const latestChatMessage = [...projection.chat.messages]
    .reverse()
    .find((message) => matchesArchitectureNodeChatMessage(message, node, roleSlotId));
  const latestEvent = [...projection.events]
    .reverse()
    .find((event) => matchesArchitectureNodeEvent(event, node, roleSlotId));

  if (!node && !latestChatMessage && !latestEvent) {
    return null;
  }

  const label = node?.label
    ?? architectureContextValue(session, 'displayLabel')
    ?? session.title.split(':').at(-1)?.trim()
    ?? 'Workflow node';
  const relatedStatus = node?.status ?? projection.graph.status ?? 'pending';
  const architectureLabel = projection.graph.schemaName
    ?? architectureContextValue(session, 'schemaName')
    ?? architectureContextValue(session, 'displayLabel')
    ?? 'Architecture workflow';
  const latestAction = latestEvent?.message?.trim() || node?.incompleteReason?.trim() || null;
  const content = latestChatMessage?.content?.trim().length
    ? latestChatMessage.content.trim()
    : [
        `### ${label}`,
        `Architecture: ${architectureLabel}`,
        `Status: ${relatedStatus}`,
        latestAction ? `Last action: ${latestAction}` : null,
      ].filter((line): line is string => Boolean(line)).join('\n\n');

  return {
    id: `architecture-node-rehydrate:${session.id}:${runId}:${latestEvent?.id ?? node?.id ?? 'state'}`,
    sessionId: session.id,
    role: 'assistant',
    content,
    createdAt: latestEvent?.createdAt ?? Date.now(),
  };
}

async function hydrateArchitectureActivityForSession(
  sessionId: string,
  getSessions: GetSessions | undefined,
  fetchArchitectureRunProjection: FetchArchitectureRunProjection,
): Promise<ChatMessage[] | null> {
  const session = getSessions?.().find((candidate) => candidate.id === sessionId);
  if (!session) {
    return null;
  }

  const runId = architectureRunIdForSession(session);
  if (!runId) {
    return null;
  }

  const syntheticMessage = buildSyntheticArchitectureChildMessage(
    session,
    await fetchArchitectureRunProjection(runId),
  );
  return syntheticMessage ? [syntheticMessage] : null;
}

export async function hydrateArchitectureProjectionFromDescendants(
  activeSessionId: string,
  mergedMessages: ChatMessage[],
  setMessages: SetMessages,
  setAgentTurns: SetAgentTurns,
  fetchMessages: FetchMessages = defaultFetchMessages,
  fetchArchitectureRunProjection: FetchArchitectureRunProjection = defaultFetchArchitectureRunProjection,
  getActiveSessionId: () => string | null = () => null,
  getSessions: GetSessions = () => [],
  getSessionMessages: GetSessionMessages = () => [],
): Promise<ChatMessage[]> {
  if (persistedArchitectureRunInMessages(mergedMessages)) {
    return mergedMessages;
  }

  const inferredSummary = findArchitectureRunInMessages(mergedMessages);
  if (inferredSummary?.hostProjectionKind === 'workflow-envelope') {
    const syntheticMessage = buildReloadedArchitectureSummaryMessage(activeSessionId, mergedMessages, inferredSummary);
    const withoutPreviousSynthetic = mergedMessages.filter((message) => message.id !== syntheticMessage.id);
    return [...withoutPreviousSynthetic, syntheticMessage].sort((left, right) => left.createdAt - right.createdAt);
  }

  const candidateSessions = getSessions().filter((session) => (
    session.parentSessionId === activeSessionId
    && architectureRunIdForSession(session)
  ));
  if (candidateSessions.length === 0) {
    return mergedMessages;
  }

  let derivedSummary: ReturnType<typeof findArchitectureRunInMessages> = null;
  for (const session of candidateSessions) {
    const currentChildMessages = getSessionMessages(session.id);
    const childMessages = currentChildMessages.length > 0
      ? currentChildMessages
      : mergeFetchedMessages(
          currentChildMessages,
          await fetchMessages(session.id),
        );
    if (getActiveSessionId() !== activeSessionId) {
      return mergedMessages;
    }
    if (currentChildMessages.length === 0) {
      setMessages(childMessages, session.id);
      setAgentTurns(buildTurnsFromHistory(childMessages, session.id), session.id);
    }
    derivedSummary ??= findArchitectureRunInMessages(childMessages);
  }

  if (!derivedSummary) {
    const candidateRunIds = [...new Set(
      candidateSessions
        .map((session) => architectureRunIdForSession(session))
        .filter((runId): runId is string => typeof runId === 'string' && runId.length > 0),
    )];
    for (const runId of candidateRunIds) {
      const projection = await fetchArchitectureRunProjection(runId);
      if (getActiveSessionId() !== activeSessionId) {
        return mergedMessages;
      }
      derivedSummary = buildArchitectureRunMetadata({
        run: {
          id: runId,
          status: projection.graph.status ?? 'running',
          schemaId: projection.graph.schemaId ?? projection.graph.schemaName ?? runId,
        } as never,
        events: projection.events,
        graph: projection.graph,
        chat: projection.chat,
      });
      if (derivedSummary) {
        break;
      }
    }
  }

  if (!derivedSummary) {
    return mergedMessages;
  }

  const syntheticMessage = buildReloadedArchitectureSummaryMessage(activeSessionId, mergedMessages, derivedSummary);
  const withoutPreviousSynthetic = mergedMessages.filter((message) => message.id !== syntheticMessage.id);
  return [...withoutPreviousSynthetic, syntheticMessage].sort((left, right) => left.createdAt - right.createdAt);
}

export async function reloadSessionHistoryWithArchitectureProjection({
  sessionId,
  getActiveSessionId,
  getSessions,
  getSessionMessages,
  setMessages,
  setAgentTurns,
  fetchMessages = defaultFetchMessages,
  fetchArchitectureRunProjection = defaultFetchArchitectureRunProjection,
}: {
  sessionId: string;
  getActiveSessionId?: () => string | null;
  getSessions?: GetSessions;
  getSessionMessages: (sessionId: string) => ChatMessage[];
  setMessages: SetMessages;
  setAgentTurns: SetAgentTurns;
  fetchMessages?: FetchMessages;
  fetchArchitectureRunProjection?: FetchArchitectureRunProjection;
}): Promise<ChatMessage[] | null> {
  const fetchedMessages = await fetchMessages(sessionId);
  if (getActiveSessionId && getActiveSessionId() !== sessionId) {
    return null;
  }

  let mergedMessages = mergeFetchedMessages(getSessionMessages(sessionId), fetchedMessages);
  if (mergedMessages.length === 0) {
    const syntheticMessages = await hydrateArchitectureActivityForSession(
      sessionId,
      getSessions,
      fetchArchitectureRunProjection,
    );
    if (getActiveSessionId && getActiveSessionId() !== sessionId) {
      return null;
    }
    if (syntheticMessages) {
      mergedMessages = syntheticMessages;
    }
  }
  const hydratedMessages = await hydrateArchitectureProjectionFromDescendants(
    sessionId,
    mergedMessages,
    setMessages,
    setAgentTurns,
    fetchMessages,
    fetchArchitectureRunProjection,
    getActiveSessionId,
    getSessions,
    getSessionMessages,
  );
  if (getActiveSessionId && getActiveSessionId() !== sessionId) {
    return null;
  }

  setMessages(hydratedMessages, sessionId);
  return hydratedMessages;
}
