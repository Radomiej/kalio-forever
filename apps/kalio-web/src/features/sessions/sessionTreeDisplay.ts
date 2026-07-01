import {
  architectureSessionPrefixForRun,
  type ArchitectureGraphProjection,
  type ChatMessage,
  type ChatSession,
  type RuntimeActivitySnapshot,
  type SocketEvents,
} from '@kalio/types';
import {
  architectureConversationVisibilityForSession,
  architectureContextStringField,
  architectureSessionSurfaceForSession,
} from './architectureSessionContext';

export type SessionRuntimeState = 'pending' | 'waiting' | 'running' | 'error' | 'done' | 'stopped';
export type RuntimeSessionStatusSnapshot = SocketEvents['session:status'] & {
  toolActivities?: RuntimeActivitySnapshot['toolActivities'];
};
type ArchitectureRunWithGraph = NonNullable<ChatMessage['architectureRun']> & {
  graphNodes?: ArchitectureGraphProjection['nodes'];
};
const TECHNICAL_ARCHITECTURE_SLOT_IDS = new Set(['router', 'finalizer', 'orchestrator']);
const TECHNICAL_ARCHITECTURE_SLOT_TYPES = new Set(['router', 'finalizer']);

function isVisibleTechnicalConversationSession(session: ChatSession): boolean {
  return architectureSessionSurfaceForSession(session) === 'technical-node'
    && architectureConversationVisibilityForSession(session) === 'visible';
}

export function buildChildSessionsByParent(sessions: ChatSession[]): Map<string, ChatSession[]> {
  return sessions.reduce((acc, session) => {
    if (!session.parentSessionId) return acc;
    acc.set(session.parentSessionId, [...(acc.get(session.parentSessionId) ?? []), session]);
    return acc;
  }, new Map<string, ChatSession[]>());
}

export function countSessionDescendants(
  sessionId: string,
  childSessionsByParent: Map<string, ChatSession[]>,
  cache = new Map<string, number>(),
): number {
  const cached = cache.get(sessionId);
  if (cached !== undefined) return cached;
  const count = (childSessionsByParent.get(sessionId) ?? [])
    .reduce((sum, child) => sum + 1 + countSessionDescendants(child.id, childSessionsByParent, cache), 0);
  cache.set(sessionId, count);
  return count;
}

export function visibleConversationTreeChildren(
  sessionId: string,
  childSessionsByParent: Map<string, ChatSession[]>,
): ChatSession[] {
  return (childSessionsByParent.get(sessionId) ?? []).flatMap((child) => (
    isArchitectureWorkflowContainerSession(child)
      || (isTechnicalArchitectureSession(child) && !isVisibleTechnicalConversationSession(child))
      ? visibleConversationTreeChildren(child.id, childSessionsByParent)
      : [child]
  ));
}

export function hasVisibleWorkflowConversationDescendant(
  sessionId: string,
  childSessionsByParent: Map<string, ChatSession[]>,
): boolean {
  return visibleConversationTreeChildren(sessionId, childSessionsByParent)
    .some((child) => isWorkflowConversationSession(child));
}

export function countVisibleConversationTreeDescendants(
  sessionId: string,
  childSessionsByParent: Map<string, ChatSession[]>,
  cache = new Map<string, number>(),
): number {
  const cached = cache.get(sessionId);
  if (cached !== undefined) return cached;
  const count = visibleConversationTreeChildren(sessionId, childSessionsByParent)
    .reduce((sum, child) => sum + 1 + countVisibleConversationTreeDescendants(child.id, childSessionsByParent, cache), 0);
  cache.set(sessionId, count);
  return count;
}

export function displayTitleForSession(
  session: ChatSession,
  childSessionsByParent: Map<string, ChatSession[]>,
): string {
  void childSessionsByParent;
  const architectureLabel = architectureSessionDisplayLabel(session);
  if (isArchitectureEnvelopeSession(session) && architectureLabel) {
    return architectureLabel;
  }
  const trimmedTitle = session.title.trim();
  return trimmedTitle || `Session ${session.id.slice(0, 6)}`;
}

export function hasExpandedAncestor(
  session: ChatSession,
  sessionById: Map<string, ChatSession>,
  expandedRoots: Set<string>,
): boolean {
  let parentId = session.parentSessionId;
  const visited = new Set<string>();
  while (parentId) {
    if (visited.has(parentId)) return false;
    visited.add(parentId);
    if (expandedRoots.has(parentId)) return true;
    parentId = sessionById.get(parentId)?.parentSessionId;
  }
  return false;
}

export function visibleConversationParentId(
  session: ChatSession,
  sessionById: Map<string, ChatSession>,
): string | null {
  let parentId = session.parentSessionId;
  const visited = new Set<string>();

  while (parentId) {
    if (visited.has(parentId)) {
      return null;
    }
    visited.add(parentId);
    const parent = sessionById.get(parentId);
    if (!parent) {
      return null;
    }
    if (
      !isArchitectureWorkflowContainerSession(parent)
      && (!isTechnicalArchitectureSession(parent) || isVisibleTechnicalConversationSession(parent))
    ) {
      return parent.id;
    }
    parentId = parent.parentSessionId;
  }

  return null;
}

export function buildArchitectureSessionRuntimeStates(
  sessions: ChatSession[],
  sessionMessages: Record<string, ChatMessage[]>,
): Map<string, SessionRuntimeState> {
  const statusBySession = new Map<string, SessionRuntimeState>();
  const architectureSessions = sessions.filter((session) => architectureRunIdForSession(session));
  const runs = Object.values(sessionMessages)
    .flat()
    .map((message) => message.architectureRun as ArchitectureRunWithGraph | undefined)
    .filter((run): run is ArchitectureRunWithGraph => Boolean(run));

  for (const run of runs) {
    const graphNodeById = new Map<string, ArchitectureGraphProjection['nodes'][number]>();
    for (const node of run.graphNodes ?? []) {
      graphNodeById.set(normalizeArchitectureNodeKey(node.id), node);
      if (node.roleSlotId) {
        graphNodeById.set(normalizeArchitectureNodeKey(node.roleSlotId), node);
      }
    }

    for (const session of architectureSessions) {
      if (!sameArchitectureRunId(architectureRunIdForSession(session), run.runId)) {
        continue;
      }
      const slotId = architectureSlotIdForSession(session);
      if (!slotId) {
        statusBySession.set(session.id, statusFromArchitectureRun(run.status));
        continue;
      }
      const node = graphNodeById.get(normalizeArchitectureNodeKey(slotId));
      if (node) {
        statusBySession.set(session.id, statusFromArchitectureGraphNode(node.status, run.status));
        continue;
      }
      const fallbackState = fallbackArchitectureBranchState(run.status);
      if (fallbackState) {
        statusBySession.set(session.id, fallbackState);
      }
    }

    for (const step of run.trace) {
      const branchSessionId = step.stream?.branchSessionId;
      if (!branchSessionId) {
        continue;
      }
      if (statusBySession.has(branchSessionId)) {
        continue;
      }
      statusBySession.set(branchSessionId, statusFromArchitectureTraceStep(step));
    }
  }

  return statusBySession;
}

export function isTechnicalArchitectureSession(session: ChatSession): boolean {
  const sessionSurface = architectureSessionSurfaceForSession(session);
  if (sessionSurface === 'technical-node') {
    return true;
  }
  if (sessionSurface === 'conversation-branch') {
    return false;
  }
  const slotType = architectureSlotTypeForSession(session);
  if (typeof slotType === 'string' && TECHNICAL_ARCHITECTURE_SLOT_TYPES.has(slotType)) {
    return true;
  }
  const slotId = architectureSlotIdForSession(session);
  if (typeof slotId === 'string' && TECHNICAL_ARCHITECTURE_SLOT_IDS.has(normalizeArchitectureNodeKey(slotId))) {
    return true;
  }
  return false;
}

export function isPendingArchitecturePlaceholderSession(
  session: ChatSession,
  architectureSessionRuntimeStates: Map<string, SessionRuntimeState>,
  sessionMessages: Record<string, ChatMessage[]>,
): boolean {
  if (!architectureRunIdForSession(session) || !architectureSlotIdForSession(session) || isTechnicalArchitectureSession(session)) {
    return false;
  }
  if ((sessionMessages[session.id] ?? []).length > 0) {
    return false;
  }
  const runtimeState = architectureSessionRuntimeStates.get(session.id);
  if (runtimeState && runtimeState !== 'pending') {
    return false;
  }
  // subagent_execution eagerly persists branch sessions for every slot. Keep the sidebar scoped
  // to real conversations by hiding untouched pending placeholders until they show activity.
  return session.updatedAt <= session.createdAt;
}

export function isArchitectureEnvelopeSession(session: ChatSession): boolean {
  if (architectureSessionSurfaceForSession(session) === 'technical-node') {
    return !architectureSlotIdForSession(session);
  }
  return Boolean(architectureRunIdForSession(session))
    && architectureSlotIdForSession(session) === undefined;
}

export function isArchitectureWorkflowContainerSession(session: ChatSession): boolean {
  if (architectureSessionSurfaceForSession(session) === 'technical-node' && !architectureSlotIdForSession(session)) {
    return true;
  }
  if (!architectureRunIdForSession(session) || architectureSlotIdForSession(session) !== undefined) {
    return false;
  }
  if (isArchitectureEnvelopeSession(session)) {
    return true;
  }

  const runtimeKind = session.runtimeContext?.runtimeKind;
  if (runtimeKind === 'agent-flow-branch') {
    return true;
  }
  if (session.kind === 'agent-flow') {
    return true;
  }
  return false;
}

function isWorkflowConversationSession(session: ChatSession): boolean {
  const sessionSurface = architectureSessionSurfaceForSession(session);
  if (sessionSurface === 'conversation-branch') {
    return true;
  }
  if (sessionSurface === 'technical-node') {
    return isVisibleTechnicalConversationSession(session);
  }
  return Boolean(architectureRunIdForSession(session)) && !isTechnicalArchitectureSession(session);
}

export function normalizeConversationSessionId(
  sessionId: string | null | undefined,
  sessions: readonly ChatSession[] | Map<string, ChatSession>,
): string | null {
  if (!sessionId) {
    return null;
  }

  const sessionById = sessions instanceof Map ? sessions : new Map(sessions.map((session) => [session.id, session]));
  let currentId = sessionId;
  let currentSession = sessionById.get(currentId);
  const visited = new Set<string>();

  while (
    currentSession
    && isArchitectureWorkflowContainerSession(currentSession)
    && currentSession.parentSessionId
    && !visited.has(currentSession.id)
  ) {
    const parentSession = sessionById.get(currentSession.parentSessionId);
    if (!parentSession) {
      break;
    }
    visited.add(currentSession.id);
    currentId = parentSession.id;
    currentSession = parentSession;
  }

  return currentId;
}

export function sessionStatusSnapshotToRuntimeState(
  snapshot: RuntimeSessionStatusSnapshot | undefined,
): SessionRuntimeState | null {
  if (!snapshot) {
    return null;
  }
  const runStatus = snapshot.run?.status as string | undefined;
  if (snapshot.toolActivities?.some((activity) => activity.status === 'pending_confirmation')) {
    return 'waiting';
  }
  if (snapshot.run?.status === 'completed' || snapshot.run?.phase === 'completed') {
    return 'done';
  }
  if (snapshot.run?.status === 'failed' || snapshot.run?.phase === 'failed') {
    return 'error';
  }
  if (runStatus === 'interrupted') {
    return 'stopped';
  }
  if (runStatus === 'interrupted_needs_retry') {
    return 'stopped';
  }
  if (runStatus === 'waiting_on_orchestrator') {
    return 'waiting';
  }
  if ((snapshot.queueLength ?? 0) > 0) {
    return 'pending';
  }
  if (snapshot.active) {
    if (snapshot.run?.phase === 'queued') {
      return 'pending';
    }
    if (snapshot.run?.phase === 'tool_pending') {
      return 'waiting';
    }
    return 'running';
  }
  return null;
}

function statusFromArchitectureRun(status: NonNullable<ChatMessage['architectureRun']>['status']): SessionRuntimeState {
  if (status === 'queued') return 'pending';
  if (status === 'running') return 'running';
  if (status === 'completed') return 'done';
  if (status === 'cancelled') return 'stopped';
  return 'error';
}

function statusFromArchitectureGraphNode(
  status: ArchitectureGraphProjection['nodes'][number]['status'],
  runStatus?: NonNullable<ChatMessage['architectureRun']>['status'],
): SessionRuntimeState {
  if ((runStatus === 'failed' || runStatus === 'cancelled') && (status === 'pending' || status === 'running')) {
    return 'stopped';
  }
  if (status === 'pending') return 'pending';
  if (status === 'running') return 'running';
  if (status === 'completed') return 'done';
  if (status === 'cancelled') return 'stopped';
  return 'error';
}

function statusFromArchitectureTraceStep(step: NonNullable<ChatMessage['architectureRun']>['trace'][number]): SessionRuntimeState {
  const typedStatus = step.status ? statusFromTraceStatus(step.status) : null;
  if (typedStatus) {
    return typedStatus;
  }
  if (step.stream?.status === 'failed') {
    return 'error';
  }
  if (step.stream?.status === 'completed') {
    return 'done';
  }
  if (step.stream?.status === 'started' || step.stream?.status === 'streaming') {
    return 'running';
  }
  return step.content.trim().length > 0 ? 'done' : 'pending';
}

function statusFromTraceStatus(
  status: NonNullable<ChatMessage['architectureRun']>['trace'][number]['status'],
): SessionRuntimeState | null {
  if (status === 'queued') return 'pending';
  if (status === 'running') return 'running';
  if (status === 'waiting_on_orchestrator' || status === 'blocked') return 'waiting';
  if (status === 'done') return 'done';
  if (status === 'failed') return 'error';
  if (status === 'cancelled') return 'stopped';
  return null;
}

function fallbackArchitectureBranchState(
  status: NonNullable<ChatMessage['architectureRun']>['status'],
): SessionRuntimeState | null {
  if (status === 'queued' || status === 'running') {
    return 'pending';
  }
  return null;
}

export function architectureRunIdForSession(session: ChatSession): string | undefined {
  return architectureContextStringField(session, 'architectureRunId');
}

export function sameArchitectureRunId(left: string | null | undefined, right: string | null | undefined): boolean {
  if (!left || !right) {
    return false;
  }
  return architectureSessionPrefixForRun(left) === architectureSessionPrefixForRun(right);
}

export function architectureSlotIdForSession(session: ChatSession): string | undefined {
  const slotId = session.runtimeContext?.architectureSlotId ?? architectureContextStringField(session, 'roleSlotId');
  return typeof slotId === 'string' && slotId.trim().length > 0 ? slotId.trim() : undefined;
}

function architectureSlotTypeForSession(session: ChatSession): string | undefined {
  return architectureContextStringField(session, 'roleSlotType');
}

function architectureSessionDisplayLabel(session: ChatSession): string | null {
  return architectureContextStringField(session, 'displayLabel')
    ?? architectureContextStringField(session, 'schemaName')
    ?? null;
}

function normalizeArchitectureNodeKey(value: string): string {
  return value.trim().toLowerCase().replace(/_/g, '-');
}
