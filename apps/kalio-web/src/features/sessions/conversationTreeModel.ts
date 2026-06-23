import type { ChatMessage, ChatSession, RuntimeActivitySnapshot, SocketEvents } from '@kalio/types';
import type { AgentTurn } from '../../store/sessionStore';
import {
  buildSessionListEntries,
  isVisibleSidebarSession,
  sortSessionsForSidebar,
  type SessionOriginFilter,
} from './sessionListModel';
import {
  buildChildSessionsByParent,
  countVisibleConversationTreeDescendants,
  normalizeConversationSessionId,
  visibleConversationParentId,
} from './sessionTreeDisplay';
import { filterRenderableSessions } from './sessionRenderableFilter';
import { workflowEnvelopeRuntimeStateForSession } from './sessionWorkflowRuntimeState';
import {
  mergeRuntimeQueuedDepthBySession,
  mergeRuntimeSessionStatusSnapshots,
  selectLiveSessionIds,
} from '../../store/agentRuntimeSelectors';

export interface ConversationTreeModel {
  activeHostSessionId: string | null;
  activeLoopSessionIds: Set<string>;
  activeRenderableDescendantCount: number;
  activeWorkflowRuntimeState: ReturnType<typeof workflowEnvelopeRuntimeStateForSession>;
  allSessionById: Map<string, ChatSession>;
  architectureSessionRuntimeStates: ReturnType<typeof filterRenderableSessions>['architectureSessionRuntimeStates'];
  childSessionsByParent: Map<string, ChatSession[]>;
  descendantCountByParent: Map<string, number>;
  orderedSessions: ChatSession[];
  renderableSessions: ChatSession[];
  sessionById: Map<string, ChatSession>;
  sessionListEntries: ReturnType<typeof buildSessionListEntries>;
  visibleSessionById: Map<string, ChatSession>;
  visibleSessions: ChatSession[];
}

interface BuildConversationTreeModelArgs {
  activeSessionId: string | null;
  originFilter: SessionOriginFilter;
  pendingBudgetApprovals: Record<string, unknown>;
  pendingConfirmations: Record<string, unknown>;
  queuedDepthBySession: Record<string, number>;
  sessionAgentTurns: Record<string, AgentTurn[]>;
  sessionMessages: Record<string, ChatMessage[]>;
  sessionStatusSnapshots: Record<string, SocketEvents['session:status']>;
  runtimeActivitySnapshots?: Record<string, RuntimeActivitySnapshot>;
  sidebarSessions: ChatSession[];
  activeAgentLoops?: Record<string, { sessionId: string }>;
}

function resolveVisibleConversationRootId(
  sessionId: string | null,
  sessionById: Map<string, ChatSession>,
): string | null {
  let currentId = normalizeConversationSessionId(sessionId, sessionById);
  const visited = new Set<string>();

  while (currentId) {
    if (visited.has(currentId)) {
      return currentId;
    }
    visited.add(currentId);
    const currentSession = sessionById.get(currentId);
    if (!currentSession) {
      return currentId;
    }
    const parentId = visibleConversationParentId(currentSession, sessionById);
    if (!parentId) {
      return currentId;
    }
    currentId = parentId;
  }

  return null;
}

export function buildConversationTreeModel({
  activeSessionId,
  originFilter,
  pendingBudgetApprovals,
  pendingConfirmations,
  queuedDepthBySession,
  sessionAgentTurns,
  sessionMessages,
  sessionStatusSnapshots,
  runtimeActivitySnapshots,
  sidebarSessions,
  activeAgentLoops,
}: BuildConversationTreeModelArgs): ConversationTreeModel {
  const orderedSessions = sortSessionsForSidebar(sidebarSessions);
  const allSessionById = new Map(orderedSessions.map((session) => [session.id, session] as const));
  const effectiveQueuedDepthBySession = mergeRuntimeQueuedDepthBySession(
    queuedDepthBySession,
    runtimeActivitySnapshots,
  );
  const effectiveSessionStatusSnapshots = mergeRuntimeSessionStatusSnapshots(
    sessionStatusSnapshots,
    runtimeActivitySnapshots,
  );
  const activeLoopSessionIds = selectLiveSessionIds({
    activeAgentLoops,
    sessionStatusSnapshots,
    runtimeActivitySnapshots,
  });
  const { renderableSessions, architectureSessionRuntimeStates } = filterRenderableSessions(
    orderedSessions,
    sessionMessages ?? {},
    {
      pendingConfirmations,
      pendingBudgetApprovals,
      activeLoopSessionIds,
      queuedDepthBySession: effectiveQueuedDepthBySession,
      sessionStatusSnapshots: effectiveSessionStatusSnapshots,
    },
  );
  const sessionById = new Map(renderableSessions.map((session) => [session.id, session] as const));
  const visibleSessions = renderableSessions
    .filter((session) => isVisibleSidebarSession(session, activeSessionId, originFilter, allSessionById));
  const visibleSessionById = new Map(renderableSessions.map((session) => [session.id, session] as const));
  const sessionListEntries = buildSessionListEntries(renderableSessions, activeSessionId, originFilter, allSessionById);
  const childSessionsByParent = buildChildSessionsByParent(orderedSessions);
  const descendantCountByParent = new Map<string, number>();
  const activeHostSessionId = resolveVisibleConversationRootId(activeSessionId, allSessionById);
  const activeRenderableDescendantCount = activeHostSessionId
    ? countVisibleConversationTreeDescendants(activeHostSessionId, childSessionsByParent, descendantCountByParent)
    : 0;
  const activeWorkflowRuntimeState = activeHostSessionId
    ? workflowEnvelopeRuntimeStateForSession(
      sessionMessages[activeHostSessionId] ?? [],
      sessionAgentTurns[activeHostSessionId] ?? [],
    )
    : null;
  return {
    activeHostSessionId,
    activeLoopSessionIds,
    activeRenderableDescendantCount,
    activeWorkflowRuntimeState,
    allSessionById,
    architectureSessionRuntimeStates,
    childSessionsByParent,
    descendantCountByParent,
    orderedSessions,
    renderableSessions,
    sessionById,
    sessionListEntries,
    visibleSessionById,
    visibleSessions,
  };
}
