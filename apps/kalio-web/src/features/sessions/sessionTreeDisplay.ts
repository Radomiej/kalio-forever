import type { ArchitectureGraphProjection, ChatMessage, ChatSession, SocketEvents } from '@kalio/types';
import {
  architectureContextForSession,
  architectureContextStringField,
  architectureSessionSurfaceForSession,
} from './architectureSessionContext';

export type SessionRuntimeState = 'pending' | 'waiting' | 'running' | 'error' | 'done' | 'stopped';
type ArchitectureRunWithGraph = NonNullable<ChatMessage['architectureRun']> & {
  graphNodes?: ArchitectureGraphProjection['nodes'];
};
const TECHNICAL_ARCHITECTURE_SLOT_IDS = new Set(['router', 'finalizer', 'orchestrator']);
const TECHNICAL_ARCHITECTURE_SLOT_TYPES = new Set(['router', 'finalizer']);

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
      ? visibleConversationTreeChildren(child.id, childSessionsByParent)
      : [child]
  ));
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
    const graphNodeById = new Map(
      (run.graphNodes ?? []).map((node) => [normalizeArchitectureNodeKey(node.id), node]),
    );

    for (const session of architectureSessions) {
      if (architectureRunIdForSession(session) !== run.runId) {
        continue;
      }
      const slotId = architectureSlotIdForSession(session);
      if (!slotId) {
        statusBySession.set(session.id, statusFromArchitectureRun(run.status));
        continue;
      }
      const node = graphNodeById.get(normalizeArchitectureNodeKey(slotId));
      if (node) {
        statusBySession.set(session.id, statusFromArchitectureGraphNode(node.status));
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
  return isLegacyTechnicalArchitectureSession(session);
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
  return Boolean(session.parentSessionId)
    && Boolean(architectureRunIdForSession(session))
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
  if (session.id.startsWith('arch-')) {
    return true;
  }
  return session.title.trim().toLowerCase().startsWith('architecture:');
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
  snapshot: SocketEvents['session:status'] | undefined,
): SessionRuntimeState | null {
  if (!snapshot) {
    return null;
  }
  if ((snapshot.queueLength ?? 0) > 0) {
    return 'pending';
  }
  if (snapshot.run?.status === 'completed' || snapshot.run?.phase === 'completed') {
    return 'done';
  }
  if (snapshot.run?.status === 'failed' || snapshot.run?.phase === 'failed') {
    return 'error';
  }
  if (snapshot.run?.status === 'interrupted') {
    return 'stopped';
  }
  if (snapshot.run?.status === 'interrupted_needs_retry') {
    return 'stopped';
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
): SessionRuntimeState {
  if (status === 'pending') return 'pending';
  if (status === 'running') return 'running';
  if (status === 'completed') return 'done';
  if (status === 'cancelled') return 'stopped';
  return 'error';
}

function statusFromArchitectureTraceStep(step: NonNullable<ChatMessage['architectureRun']>['trace'][number]): SessionRuntimeState {
  if (step.stream?.status === 'failed') {
    return 'error';
  }
  if (step.incompleteReason) {
    return 'waiting';
  }
  if (step.stream?.status === 'completed') {
    return 'done';
  }
  if (step.stream?.status === 'started' || step.stream?.status === 'streaming') {
    return 'running';
  }
  return step.content.trim().length > 0 ? 'done' : 'pending';
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
  const runId = architectureContextStringField(session, 'architectureRunId');
  if (runId) return runId;
  return architectureRunIdFromParentToolCall(session.parentToolCallId)
    ?? architectureRunIdFromParentToolCall(session.runtimeContext?.parentToolCallId);
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

function isLegacyTechnicalArchitectureSession(session: ChatSession): boolean {
  if (!looksLikeArchitectureBranchSession(session)) {
    return false;
  }
  return technicalArchitectureSessionHints(session).some((hint) => TECHNICAL_ARCHITECTURE_SLOT_IDS.has(hint));
}

function looksLikeArchitectureBranchSession(session: ChatSession): boolean {
  return session.kind === 'subagent'
    && (
      session.runtimeContext?.runtimeKind === 'agent-flow-branch'
      || session.id.startsWith('arch-')
      || session.parentSessionId?.startsWith('arch-') === true
    );
}

function technicalArchitectureSessionHints(session: ChatSession): string[] {
  return [
    stringHint(session.runtimeContext?.architectureSlotId),
    stringHint(architectureContextForSession(session)?.displayLabel),
    stringHint(architectureContextForSession(session)?.roleLabel),
    titleSuffixHint(session.title),
    idSuffixHint(session.id),
  ].filter((hint): hint is string => hint !== null);
}

function stringHint(value: unknown): string | null {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return null;
  }
  return normalizeArchitectureNodeKey(value);
}

function titleSuffixHint(title: string): string | null {
  const suffix = title.split(':').at(-1)?.trim();
  return suffix ? normalizeArchitectureNodeKey(suffix) : null;
}

function idSuffixHint(id: string): string | null {
  const suffix = id.split('-').at(-1)?.trim();
  return suffix ? normalizeArchitectureNodeKey(suffix) : null;
}

function architectureRunIdFromParentToolCall(parentToolCallId: string | undefined): string | undefined {
  if (typeof parentToolCallId !== 'string' || parentToolCallId.trim().length === 0) {
    return undefined;
  }
  const match = /^architecture:([^:]+):/.exec(parentToolCallId.trim());
  return match?.[1];
}

function normalizeArchitectureNodeKey(value: string): string {
  return value.trim().toLowerCase().replace(/_/g, '-');
}
