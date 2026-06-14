import type { ChatMessage, ChatSession } from '@kalio/types';
import { apiClient } from '../../services/apiClient';
import { findArchitectureRunInMessages } from './architectureChatSummary';
import { buildTurnsFromHistory, mergeFetchedMessages } from './chatUtils';
import { architectureRunIdForSession } from '../sessions/sessionTreeDisplay';

type SetMessages = (messages: ChatMessage[], sessionId?: string | null) => void;
type SetAgentTurns = (turns: ReturnType<typeof buildTurnsFromHistory>, sessionId?: string | null) => void;
type FetchMessages = (sessionId: string) => Promise<ChatMessage[]>;
type GetSessions = () => ChatSession[];
type GetSessionMessages = (sessionId: string) => ChatMessage[];

function defaultFetchMessages(sessionId: string): Promise<ChatMessage[]> {
  return apiClient
    .get<ChatMessage[]>(`/api/sessions/${sessionId}/messages`)
    .then((response) => response.data);
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

export async function hydrateArchitectureProjectionFromDescendants(
  activeSessionId: string,
  mergedMessages: ChatMessage[],
  setMessages: SetMessages,
  setAgentTurns: SetAgentTurns,
  fetchMessages: FetchMessages = defaultFetchMessages,
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
}: {
  sessionId: string;
  getActiveSessionId?: () => string | null;
  getSessions?: GetSessions;
  getSessionMessages: (sessionId: string) => ChatMessage[];
  setMessages: SetMessages;
  setAgentTurns: SetAgentTurns;
  fetchMessages?: FetchMessages;
}): Promise<ChatMessage[] | null> {
  const fetchedMessages = await fetchMessages(sessionId);
  if (getActiveSessionId && getActiveSessionId() !== sessionId) {
    return null;
  }

  const mergedMessages = mergeFetchedMessages(getSessionMessages(sessionId), fetchedMessages);
  const hydratedMessages = await hydrateArchitectureProjectionFromDescendants(
    sessionId,
    mergedMessages,
    setMessages,
    setAgentTurns,
    fetchMessages,
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
