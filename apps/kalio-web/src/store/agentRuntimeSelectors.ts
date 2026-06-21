import type {
  AgentBudgetApprovalRequest,
  AgentRunContext,
  RuntimeActivitySnapshot,
  SocketEvents,
  ToolConfirmationRequest,
} from '@kalio/types';
import { sessionStatusSnapshotToRuntimeState } from '../features/sessions/sessionTreeDisplay';

type LiveSessionLoopSeed = {
  sessionId: string;
  turnId?: string;
  startedAt?: number;
  agentRun?: AgentRunContext;
};

function normalizePendingEntries<T>(
  entries: T[] | T | null | undefined,
): T[] {
  if (Array.isArray(entries)) {
    return entries;
  }
  return entries ? [entries] : [];
}

export interface RunningLoopSummary {
  sessionId: string;
  turnId: string;
  startedAt: number;
  agentRun?: AgentRunContext;
}

function runtimeSnapshotToSessionStatus(
  snapshot: RuntimeActivitySnapshot,
): SocketEvents['session:status'] {
  return {
    sessionId: snapshot.sessionId,
    active: snapshot.active,
    turnId: snapshot.turnId,
    queueLength: snapshot.queueLength,
    run: snapshot.run,
  };
}

function isLiveSessionState(state: ReturnType<typeof sessionStatusSnapshotToRuntimeState>): boolean {
  return state === 'pending' || state === 'running' || state === 'waiting';
}

export function mergeRuntimeSessionStatusSnapshots(
  sessionStatusSnapshots: Record<string, SocketEvents['session:status']> | null | undefined,
  runtimeActivitySnapshots: Record<string, RuntimeActivitySnapshot> | null | undefined,
): Record<string, SocketEvents['session:status']> {
  const merged: Record<string, SocketEvents['session:status']> = {
    ...(sessionStatusSnapshots ?? {}),
  };

  Object.values(runtimeActivitySnapshots ?? {}).forEach((snapshot) => {
    merged[snapshot.sessionId] = runtimeSnapshotToSessionStatus(snapshot);
  });

  return merged;
}

export function mergeRuntimeQueuedDepthBySession(
  queuedDepthBySession: Record<string, number> | null | undefined,
  runtimeActivitySnapshots: Record<string, RuntimeActivitySnapshot> | null | undefined,
): Record<string, number> {
  const merged: Record<string, number> = {
    ...(queuedDepthBySession ?? {}),
  };

  Object.values(runtimeActivitySnapshots ?? {}).forEach((snapshot) => {
    merged[snapshot.sessionId] = snapshot.queueLength;
  });

  return merged;
}

export function selectQueuedDepth(params: {
  sessionId: string | null;
  queuedDepthBySession?: Record<string, number> | null;
  runtimeActivitySnapshots?: Record<string, RuntimeActivitySnapshot> | null;
}): number {
  if (!params.sessionId) {
    return 0;
  }

  return mergeRuntimeQueuedDepthBySession(
    params.queuedDepthBySession,
    params.runtimeActivitySnapshots,
  )[params.sessionId] ?? 0;
}

export function selectLiveSessionIds(params: {
  activeAgentLoops?: Record<string, LiveSessionLoopSeed>;
  sessionStatusSnapshots?: Record<string, SocketEvents['session:status']>;
  runtimeActivitySnapshots?: Record<string, RuntimeActivitySnapshot>;
}): Set<string> {
  const liveSessionIds = new Set(
    Object.values(params.activeAgentLoops ?? {}).map((loop) => loop.sessionId),
  );
  const mergedSnapshots = mergeRuntimeSessionStatusSnapshots(
    params.sessionStatusSnapshots,
    params.runtimeActivitySnapshots,
  );

  Object.entries(mergedSnapshots).forEach(([sessionId, snapshot]) => {
    if (isLiveSessionState(sessionStatusSnapshotToRuntimeState(snapshot))) {
      liveSessionIds.add(sessionId);
    }
  });

  return liveSessionIds;
}

export function selectRunningLoops(params: {
  activeAgentLoops?: Record<string, LiveSessionLoopSeed>;
  runtimeActivitySnapshots?: Record<string, RuntimeActivitySnapshot>;
}): RunningLoopSummary[] {
  const loopsBySessionId = new Map<string, RunningLoopSummary>();

  Object.values(params.activeAgentLoops ?? {}).forEach((loop) => {
    loopsBySessionId.set(loop.sessionId, {
      sessionId: loop.sessionId,
      turnId: loop.turnId ?? loop.sessionId,
      startedAt: loop.startedAt ?? 0,
      agentRun: loop.agentRun,
    });
  });

  Object.values(params.runtimeActivitySnapshots ?? {}).forEach((snapshot) => {
    const runtimeState = sessionStatusSnapshotToRuntimeState(
      runtimeSnapshotToSessionStatus(snapshot),
    );
    if ((runtimeState !== 'running' && runtimeState !== 'waiting') || loopsBySessionId.has(snapshot.sessionId)) {
      return;
    }

    loopsBySessionId.set(snapshot.sessionId, {
      sessionId: snapshot.sessionId,
      turnId: snapshot.turnId ?? snapshot.run?.turnId ?? snapshot.sessionId,
      startedAt: snapshot.run?.startedAt ?? snapshot.updatedAt,
    });
  });

  return [...loopsBySessionId.values()].sort((left, right) => left.startedAt - right.startedAt);
}

export function selectPendingApprovalCount(params: {
  pendingConfirmations?: Record<string, ToolConfirmationRequest[] | ToolConfirmationRequest> | null;
  pendingBudgetApprovals?: Record<string, AgentBudgetApprovalRequest[] | AgentBudgetApprovalRequest> | null;
}): number {
  const confirmationCount = Object.values(params.pendingConfirmations ?? {})
    .reduce((total, entries) => total + normalizePendingEntries(entries).length, 0);
  const budgetApprovalCount = Object.values(params.pendingBudgetApprovals ?? {})
    .reduce((total, entries) => total + normalizePendingEntries(entries).length, 0);

  return confirmationCount + budgetApprovalCount;
}

export function selectPendingConfirmationsForSession(params: {
  sessionId: string | null;
  pendingConfirmations?: Record<string, ToolConfirmationRequest[] | ToolConfirmationRequest> | null;
}): ToolConfirmationRequest[] {
  if (!params.sessionId) {
    return [];
  }

  return normalizePendingEntries(params.pendingConfirmations?.[params.sessionId]);
}

export function selectPendingBudgetApprovalsForSession(params: {
  sessionId: string | null;
  pendingBudgetApprovals?: Record<string, AgentBudgetApprovalRequest[] | AgentBudgetApprovalRequest> | null;
}): AgentBudgetApprovalRequest[] {
  if (!params.sessionId) {
    return [];
  }

  return normalizePendingEntries(params.pendingBudgetApprovals?.[params.sessionId]);
}

export function selectPendingConfirmationByToolCallId(params: {
  toolCallId: string | null;
  pendingConfirmations?: Record<string, ToolConfirmationRequest[] | ToolConfirmationRequest> | null;
}): ToolConfirmationRequest | null {
  if (!params.toolCallId) {
    return null;
  }

  for (const confirmations of Object.values(params.pendingConfirmations ?? {})) {
    const match = normalizePendingEntries(confirmations)
      .find((confirmation) => confirmation.toolCallId === params.toolCallId);
    if (match) {
      return match;
    }
  }

  return null;
}
