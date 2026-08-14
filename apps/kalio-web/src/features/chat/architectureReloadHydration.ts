import type {
  ArchitectureChatProjection,
  ArchitectureExecutionEvent,
  ArchitectureGraphProjection,
  ChatMessage,
  ChatSession,
} from '@kalio/types';
import { useSessionStore } from '../../store/sessionStore';
import { useAgentStore } from '../../store/agentStore';
import { apiClient } from '../../services/apiClient';
import { buildArchitectureRunMetadata, findArchitectureRunInMessages } from './architectureChatSummary';
import { budgetApprovalsBySessionFromArchitectureEvents } from './architectureBudgetApprovalProjection';
import { buildTurnsFromHistory, mergeFetchedMessages } from './chatUtils';
import { architectureRunIdForSession } from '../sessions/sessionTreeDisplay';
import { extractSubAgentFlowResult } from './subAgentFlowResult.parser';
import {
  DEFAULT_CHILD_SESSION_HISTORY_LIMIT,
  DEFAULT_SESSION_HISTORY_LIMIT,
  fetchSessionHistoryWindow,
  toSessionHistoryWindow,
  type SessionHistoryFetchResult,
  type SessionHistoryMeta,
  type SessionHistoryWindow,
} from './sessionHistoryApi';

type SetMessages = (messages: ChatMessage[], sessionId?: string | null) => void;
type SetAgentTurns = (turns: ReturnType<typeof buildTurnsFromHistory>, sessionId?: string | null) => void;
type SetSessionHistoryMeta = (sessionId: string, meta: SessionHistoryMeta | null) => void;
type FetchMessages = (sessionId: string) => Promise<SessionHistoryFetchResult>;
type ArchitectureRunSummary = NonNullable<ReturnType<typeof findArchitectureRunInMessages>>;
export type FetchArchitectureRunProjection = (
  runId: string,
) => Promise<{
  chat: ArchitectureChatProjection;
  events: ArchitectureExecutionEvent[];
  graph: ArchitectureGraphProjection;
}>;
type GetSessions = () => ChatSession[];
type GetSessionMessages = (sessionId: string) => ChatMessage[];

function defaultFetchMessages(sessionId: string): Promise<SessionHistoryWindow> {
  const session = useSessionStore.getState().sessions.find((candidate) => candidate.id === sessionId);
  const isChildSession = Boolean(session?.parentSessionId);
  return fetchSessionHistoryWindow(sessionId, {
    limit: isChildSession ? DEFAULT_CHILD_SESSION_HISTORY_LIMIT : DEFAULT_SESSION_HISTORY_LIMIT,
  });
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
  summary: ArchitectureRunSummary,
): ChatMessage {
  const turnId = `architecture-turn-${summary.runId}`;
  const fallbackPromptMessageId = `architecture:${summary.runId}:user`;
  const promptMessageId = promptMessageIdForArchitectureRun(messages, summary.runId)
    ?? fallbackPromptMessageId;
  const relatedMessages = messages.filter((message) => (
    message.architectureRun?.runId === summary.runId
    || message.turnId === turnId
    || message.id === promptMessageId
    || message.promptMessageId === promptMessageId
  ));
  const timestampMessages = relatedMessages.length > 0 ? relatedMessages : messages;
  const firstAssistantAt = timestampMessages
    .filter((message) => message.role === 'assistant')
    .map((message) => message.createdAt)
    .sort((left, right) => left - right)[0];
  const lastUserAt = [...timestampMessages]
    .reverse()
    .find((message) => message.role === 'user')
    ?.createdAt ?? Date.now();

  return {
    id: `architecture-rehydrate:${sessionId}:${summary.runId}`,
    sessionId,
    role: 'assistant',
    content: '',
    turnId,
    promptMessageId,
    architectureRun: {
      ...summary,
      finalArtifact: undefined,
    },
    createdAt: typeof firstAssistantAt === 'number' ? Math.max(0, firstAssistantAt - 1) : lastUserAt + 1,
  };
}

function promptMessageIdForArchitectureRun(messages: ChatMessage[], runId: string): string | null {
  for (const message of messages) {
    if (
      message.architectureRun?.runId === runId
      && typeof message.promptMessageId === 'string'
      && message.promptMessageId.trim().length > 0
    ) {
      return message.promptMessageId;
    }
    if (
      message.toolCalls?.some((toolCall) => toolCall.args['architectureRunId'] === runId) === true
      && typeof message.promptMessageId === 'string'
      && message.promptMessageId.trim().length > 0
    ) {
      return message.promptMessageId;
    }
  }
  const subAgentFlowCallId = subAgentFlowCallIdForArchitectureRun(messages, runId);
  if (subAgentFlowCallId) {
    const toolCallMessage = messages.find((message) => (
      message.role === 'assistant'
      && message.toolCalls?.some((toolCall) => toolCall.id === subAgentFlowCallId) === true
    ));
    if (
      toolCallMessage
      && typeof toolCallMessage.promptMessageId === 'string'
      && toolCallMessage.promptMessageId.trim().length > 0
    ) {
      return toolCallMessage.promptMessageId;
    }
    const toolCallCreatedAt = toolCallMessage?.createdAt;
    return [...messages]
      .filter((message) => (
        message.role === 'user'
        && (typeof toolCallCreatedAt !== 'number' || message.createdAt <= toolCallCreatedAt)
      ))
      .at(-1)
      ?.id ?? null;
  }
  return null;
}

function subAgentFlowCallIdForArchitectureRun(messages: ChatMessage[], runId: string): string | null {
  const subAgentFlowCallIds = new Set(messages
    .filter((message) => message.role === 'assistant' && message.toolCalls)
    .flatMap((message) => message.toolCalls ?? [])
    .filter((toolCall) => toolCall.name === 'run_sub_agentflow')
    .map((toolCall) => toolCall.id));

  for (const message of messages) {
    if (
      message.role !== 'tool_result'
      || typeof message.toolCallId !== 'string'
      || !subAgentFlowCallIds.has(message.toolCallId)
    ) {
      continue;
    }
    const result = extractSubAgentFlowResult(parseToolResultContent(message.content));
    if (result?.openGraphRunId === runId) {
      return message.toolCallId;
    }
  }
  return null;
}

function architectureRunIdsFromSubAgentFlowResults(messages: ChatMessage[]): string[] {
  const subAgentFlowCallIds = new Set(messages
    .filter((message) => message.role === 'assistant' && message.toolCalls)
    .flatMap((message) => message.toolCalls ?? [])
    .filter((toolCall) => toolCall.name === 'run_sub_agentflow')
    .map((toolCall) => toolCall.id));
  const runIds: string[] = [];

  for (const message of messages) {
    if (
      message.role !== 'tool_result'
      || typeof message.toolCallId !== 'string'
      || !subAgentFlowCallIds.has(message.toolCallId)
    ) {
      continue;
    }
    const result = extractSubAgentFlowResult(parseToolResultContent(message.content));
    const runId = result?.openGraphRunId?.trim();
    if (runId && !runIds.includes(runId)) {
      runIds.push(runId);
    }
  }
  return runIds;
}

function parseToolResultContent(content: string): unknown {
  try {
    return JSON.parse(content);
  } catch {
    return null;
  }
}

function mergeReloadedArchitectureSummaryMessage(
  sessionId: string,
  messages: ChatMessage[],
  summary: ArchitectureRunSummary,
): ChatMessage[] {
  const syntheticMessage = buildReloadedArchitectureSummaryMessage(sessionId, messages, summary);
  const withoutPreviousSummary = messages.filter((message) => (
    message.id !== syntheticMessage.id
    && message.architectureRun?.runId !== summary.runId
  ));
  return [...withoutPreviousSummary, syntheticMessage].sort((left, right) => left.createdAt - right.createdAt);
}

function mergeReloadedArchitectureSummaryMessages(
  sessionId: string,
  messages: ChatMessage[],
  summaries: ArchitectureRunSummary[],
): ChatMessage[] {
  return summaries.reduce(
    (nextMessages, summary) => mergeReloadedArchitectureSummaryMessage(sessionId, nextMessages, summary),
    messages,
  );
}

function buildArchitectureRunSummaryFromProjection(
  runId: string,
  projection: {
    chat: ArchitectureChatProjection;
    events: ArchitectureExecutionEvent[];
    graph: ArchitectureGraphProjection;
  },
): ReturnType<typeof findArchitectureRunInMessages> {
  if (!isUsableArchitectureProjection(runId, projection)) {
    return null;
  }
  return buildArchitectureRunMetadata({
    run: {
      id: runId,
      status: projection.graph.status ?? 'running',
      schemaId: projection.graph.schemaId ?? projection.graph.schemaName ?? runId,
    } as never,
    events: projection.events,
    graph: projection.graph,
    chat: projection.chat,
  });
}

function isUsableArchitectureProjection(
  runId: string,
  projection: {
    chat: ArchitectureChatProjection;
    events: ArchitectureExecutionEvent[];
    graph: ArchitectureGraphProjection;
  },
): boolean {
  if (!isRecord(projection.graph) || projection.graph.runId !== runId) {
    return false;
  }
  const graphNodes = Array.isArray(projection.graph.nodes) ? projection.graph.nodes : [];
  const events = Array.isArray(projection.events) ? projection.events : [];
  const chatMessages = Array.isArray(projection.chat?.messages) ? projection.chat.messages : [];
  if (graphNodes.length > 0 || chatMessages.length > 0) {
    return true;
  }
  if (projection.graph.status === 'completed' || projection.graph.status === 'failed' || projection.graph.status === 'cancelled') {
    return true;
  }
  return events.some((event) => (
    event.type === 'node_completed'
    || event.type === 'node_failed'
    || event.type === 'participant_output'
    || event.type === 'router_output'
    || event.type === 'final_artifact'
    || event.type === 'artifact_created'
    || event.status === 'failed'
    || event.status === 'cancelled'
    || event.errorCode !== undefined
    || event.failure !== undefined
    || event.runtimeDecision !== undefined
  ));
}

function syncBudgetApprovalsFromArchitectureProjection(
  projection: {
    events: ArchitectureExecutionEvent[];
  },
): void {
  const approvalsBySession = budgetApprovalsBySessionFromArchitectureEvents(projection.events);
  if (approvalsBySession.size === 0) {
    return;
  }
  const store = useAgentStore.getState();
  for (const [sessionId, approvals] of approvalsBySession) {
    for (const approval of approvals) {
      store.setPendingBudgetApproval(sessionId, approval);
    }
  }
}

async function fetchArchitectureRunProjectionAndSync(
  runId: string,
  fetchArchitectureRunProjection: FetchArchitectureRunProjection,
): Promise<Awaited<ReturnType<FetchArchitectureRunProjection>>> {
  const projection = await fetchArchitectureRunProjection(runId);
  syncBudgetApprovalsFromArchitectureProjection(projection);
  return projection;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function persistedArchitectureRunInMessages(
  messages: ChatMessage[],
): ArchitectureRunSummary | null {
  return persistedArchitectureRunsInMessages(messages).at(-1) ?? null;
}

function persistedArchitectureRunsInMessages(messages: ChatMessage[]): ArchitectureRunSummary[] {
  const summariesByRunId = new Map<string, ArchitectureRunSummary>();
  for (const message of messages) {
    const summary = message.architectureRun;
    if (summary) {
      summariesByRunId.set(summary.runId, summary);
    }
  }
  return [...summariesByRunId.values()];
}

export function hasUsableArchitectureRunSummary(messages: ChatMessage[]): boolean {
  const summary = persistedArchitectureRunInMessages(messages);
  return summary ? isUsablePersistedArchitectureSummary(summary) : false;
}

function isUsablePersistedArchitectureSummary(
  summary: ArchitectureRunSummary,
): boolean {
  const graphNodes = (summary as { graphNodes?: unknown }).graphNodes;
  return summary.hostProjectionKind === 'workflow-envelope'
    && Array.isArray(graphNodes);
}

function architectureContextValue(session: ChatSession, key: string): string | null {
  const value = session.runtimeContext?.architectureContext?.[key];
  return trimmedString(value);
}

function trimmedString(value: unknown): string | null {
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
  const latestAction = trimmedString(latestEvent?.message) ?? trimmedString(node?.incompleteReason);
  const latestContent = trimmedString(latestChatMessage?.content);
  const content = latestContent
    ? latestContent
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
    await fetchArchitectureRunProjectionAndSync(runId, fetchArchitectureRunProjection),
  );
  return syntheticMessage ? [syntheticMessage] : null;
}

export async function hydrateArchitectureProjectionFromDescendants(
  activeSessionId: string,
  mergedMessages: ChatMessage[],
  setMessages: SetMessages,
  setAgentTurns: SetAgentTurns,
  setSessionHistoryMeta: SetSessionHistoryMeta | undefined,
  fetchMessages: FetchMessages = defaultFetchMessages,
  fetchArchitectureRunProjection: FetchArchitectureRunProjection = defaultFetchArchitectureRunProjection,
  getActiveSessionId: () => string | null = () => null,
  getSessions: GetSessions = () => [],
  getSessionMessages: GetSessionMessages = () => [],
): Promise<ChatMessage[]> {
  const persistedSummaries = persistedArchitectureRunsInMessages(mergedMessages);
  if (persistedSummaries.length > 0) {
    let hydratedMessages = mergedMessages;
    let hydratedAny = false;

    for (const persistedSummary of persistedSummaries) {
      let summaryToMerge: ArchitectureRunSummary | null = null;
      try {
        const projection = await fetchArchitectureRunProjectionAndSync(persistedSummary.runId, fetchArchitectureRunProjection);
        summaryToMerge = buildArchitectureRunSummaryFromProjection(persistedSummary.runId, projection);
      } catch (error) {
        void error;
        // TODO: legacy fallback - projection fetch is best-effort during reconnect hydration.
      }
      if (getActiveSessionId() !== activeSessionId) {
        return mergedMessages;
      }
      if (!summaryToMerge && isUsablePersistedArchitectureSummary(persistedSummary)) {
        summaryToMerge = persistedSummary;
      }
      if (summaryToMerge) {
        hydratedMessages = mergeReloadedArchitectureSummaryMessage(activeSessionId, hydratedMessages, summaryToMerge);
        hydratedAny = true;
      }
    }

    if (hydratedAny) {
      return hydratedMessages;
    }
  }

  const inferredSummary = findArchitectureRunInMessages(mergedMessages);
  if (inferredSummary?.hostProjectionKind === 'workflow-envelope') {
    let typedSummary = inferredSummary;
    try {
      const projection = await fetchArchitectureRunProjectionAndSync(inferredSummary.runId, fetchArchitectureRunProjection);
      typedSummary = buildArchitectureRunSummaryFromProjection(inferredSummary.runId, projection) ?? inferredSummary;
    } catch (error) {
      void error;
      // TODO: legacy fallback - remove once persisted backend snapshots always include workflow-envelope summaries.
    }
    const currentActiveSessionId = getActiveSessionId();
    if (currentActiveSessionId !== null && currentActiveSessionId !== activeSessionId) {
      return mergedMessages;
    }
    return mergeReloadedArchitectureSummaryMessage(activeSessionId, mergedMessages, typedSummary);
  }

  const subAgentFlowRunIds = architectureRunIdsFromSubAgentFlowResults(mergedMessages);
  if (subAgentFlowRunIds.length > 0) {
    const derivedSummariesByRunId = new Map<string, ArchitectureRunSummary>();
    for (const runId of subAgentFlowRunIds) {
      let projection: Awaited<ReturnType<FetchArchitectureRunProjection>>;
      try {
        projection = await fetchArchitectureRunProjectionAndSync(runId, fetchArchitectureRunProjection);
      } catch (error) {
        void error;
        // TODO: legacy fallback - run_sub_agentflow results may outlive a transient projection fetch failure.
        continue;
      }
      if (getActiveSessionId() !== activeSessionId) {
        return mergedMessages;
      }
      const derivedSummary = buildArchitectureRunSummaryFromProjection(runId, projection);
      if (derivedSummary) {
        derivedSummariesByRunId.set(derivedSummary.runId, derivedSummary);
      }
    }
    if (derivedSummariesByRunId.size > 0) {
      return mergeReloadedArchitectureSummaryMessages(
        activeSessionId,
        mergedMessages,
        [...derivedSummariesByRunId.values()],
      );
    }
  }

  const candidateSessions = getSessions().filter((session) => (
    session.parentSessionId === activeSessionId
    && architectureRunIdForSession(session)
  ));
  if (candidateSessions.length === 0) {
    return mergedMessages;
  }

  const derivedSummariesByRunId = new Map<string, ArchitectureRunSummary>();
  for (const session of candidateSessions) {
    const currentChildMessages = getSessionMessages(session.id);
    const fetchedWindow = currentChildMessages.length > 0 ? null : toSessionHistoryWindow(await fetchMessages(session.id));
    const childMessages = currentChildMessages.length > 0
      ? currentChildMessages
      : mergeFetchedMessages(currentChildMessages, fetchedWindow?.messages ?? []);
    if (getActiveSessionId() !== activeSessionId) {
      return mergedMessages;
    }
    if (currentChildMessages.length === 0) {
      setSessionHistoryMeta?.(session.id, fetchedWindow?.meta ?? null);
      setMessages(childMessages, session.id);
      setAgentTurns(buildTurnsFromHistory(childMessages, session.id), session.id);
    }
    const childSummary = findArchitectureRunInMessages(childMessages);
    if (childSummary) {
      derivedSummariesByRunId.set(childSummary.runId, childSummary);
    }
  }

  if (derivedSummariesByRunId.size === 0) {
    const candidateRunIds = [...new Set(
      candidateSessions
        .map((session) => architectureRunIdForSession(session))
        .filter((runId): runId is string => typeof runId === 'string' && runId.length > 0),
    )];
    for (const runId of candidateRunIds) {
      let projection: Awaited<ReturnType<FetchArchitectureRunProjection>>;
      try {
        projection = await fetchArchitectureRunProjectionAndSync(runId, fetchArchitectureRunProjection);
      } catch (error) {
        void error;
        // TODO: legacy fallback - projection fetch is best-effort during reconnect hydration.
        continue;
      }
      if (getActiveSessionId() !== activeSessionId) {
        return mergedMessages;
      }
      const derivedSummary = buildArchitectureRunSummaryFromProjection(runId, projection);
      if (derivedSummary) {
        derivedSummariesByRunId.set(derivedSummary.runId, derivedSummary);
      }
    }
  }

  if (derivedSummariesByRunId.size === 0) {
    return mergedMessages;
  }

  return mergeReloadedArchitectureSummaryMessages(
    activeSessionId,
    mergedMessages,
    [...derivedSummariesByRunId.values()],
  );
}

export async function reloadSessionHistoryWithArchitectureProjection({
  sessionId,
  getActiveSessionId,
  getSessions,
  getSessionMessages,
  setMessages,
  setSessionHistoryMeta,
  setAgentTurns,
  fetchMessages = defaultFetchMessages,
  fetchArchitectureRunProjection = defaultFetchArchitectureRunProjection,
}: {
  sessionId: string;
  getActiveSessionId?: () => string | null;
  getSessions?: GetSessions;
  getSessionMessages: (sessionId: string) => ChatMessage[];
  setMessages: SetMessages;
  setSessionHistoryMeta?: SetSessionHistoryMeta;
  setAgentTurns: SetAgentTurns;
  fetchMessages?: FetchMessages;
  fetchArchitectureRunProjection?: FetchArchitectureRunProjection;
}): Promise<ChatMessage[] | null> {
  const fetchedWindow = toSessionHistoryWindow(await fetchMessages(sessionId));
  if (getActiveSessionId && getActiveSessionId() !== sessionId) {
    return null;
  }

  setSessionHistoryMeta?.(sessionId, fetchedWindow.meta);
  let mergedMessages = mergeFetchedMessages(getSessionMessages(sessionId), fetchedWindow.messages);
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
    setSessionHistoryMeta,
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
