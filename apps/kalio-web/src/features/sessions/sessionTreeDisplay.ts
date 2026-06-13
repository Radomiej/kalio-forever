import type { ArchitectureGraphProjection, ChatMessage, ChatSession, SocketEvents } from '@kalio/types';

export type SessionRuntimeState = 'pending' | 'waiting' | 'running' | 'error' | 'done' | 'stopped';
type ArchitectureRunWithGraph = NonNullable<ChatMessage['architectureRun']> & {
  graphNodes?: ArchitectureGraphProjection['nodes'];
};

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

export function displayTitleForSession(
  session: ChatSession,
  childSessionsByParent: Map<string, ChatSession[]>,
): string {
  void childSessionsByParent;
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
  architectureSessions.forEach((session) => {
    statusBySession.set(session.id, 'pending');
  });
  const runs = Object.values(sessionMessages)
    .flat()
    .map((message) => message.architectureRun as ArchitectureRunWithGraph | undefined)
    .filter((run): run is ArchitectureRunWithGraph => Boolean(run));

  for (const run of runs) {
    for (const session of architectureSessions) {
      if (architectureRunIdForSession(session) !== run.runId) {
        continue;
      }
      const slotId = architectureSlotIdForSession(session);
      if (!slotId) {
        statusBySession.set(session.id, statusFromArchitectureRun(run.status));
        continue;
      }
      const graphNode = run.graphNodes?.find((node) => nodeMatchesArchitectureSlot(node, slotId));
      if (graphNode) {
        statusBySession.set(session.id, statusFromGraphNode(graphNode.status));
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
    return 'waiting';
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

function statusFromGraphNode(status: ArchitectureGraphProjection['nodes'][number]['status']): SessionRuntimeState {
  if (status === 'completed') return 'done';
  if (status === 'running') return 'running';
  return 'pending';
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

function architectureRunIdForSession(session: ChatSession): string | undefined {
  const runId = architectureContext(session)['architectureRunId'];
  if (typeof runId === 'string' && runId.trim().length > 0) {
    return runId.trim();
  }
  return architectureRunIdFromParentToolCall(session.parentToolCallId)
    ?? architectureRunIdFromParentToolCall(session.runtimeContext?.parentToolCallId);
}

function architectureSlotIdForSession(session: ChatSession): string | undefined {
  const slotId = session.runtimeContext?.architectureSlotId ?? architectureContext(session)['roleSlotId'];
  return typeof slotId === 'string' && slotId.trim().length > 0 ? slotId.trim() : undefined;
}

function architectureContext(session: ChatSession): Record<string, unknown> {
  const context = session.runtimeContext?.architectureContext;
  return context && typeof context === 'object' && !Array.isArray(context) ? context : {};
}

function nodeMatchesArchitectureSlot(node: ArchitectureGraphProjection['nodes'][number], slotId: string): boolean {
  const normalizedSlotId = normalizeArchitectureIdentifier(slotId);
  return normalizeArchitectureIdentifier(node.id) === normalizedSlotId
    || normalizeArchitectureIdentifier(node.label) === normalizedSlotId;
}

function normalizeArchitectureIdentifier(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function architectureRunIdFromParentToolCall(parentToolCallId: string | undefined): string | undefined {
  if (typeof parentToolCallId !== 'string' || parentToolCallId.trim().length === 0) {
    return undefined;
  }
  const match = /^architecture:([^:]+):/.exec(parentToolCallId.trim());
  return match?.[1];
}
