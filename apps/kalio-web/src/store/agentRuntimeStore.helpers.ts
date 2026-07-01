import type {
  AgentBudgetApprovalRequest,
  AgentRunContext,
  RuntimeChildExecution,
  RuntimeToolActivity,
  SocketEvents,
  ToolConfirmationRequest,
} from '@kalio/types';
import type { CLIChildProjection } from '../features/chat/cliChildProjection.model';

export interface SessionToolActivityState<TActivity extends { sessionId?: string }> {
  toolActivities: TActivity[];
  sessionToolActivities: Record<string, TActivity[]>;
}

export function mergeSessionToolActivities<TActivity extends { callId: string; sessionId?: string; startedAt: number }>(
  liveActivities: TActivity[],
  snapshot: SocketEvents['session:runtime_snapshot'] | undefined,
  mapRuntimeActivity: (activity: RuntimeToolActivity) => TActivity,
): TActivity[] {
  if (!snapshot) {
    return liveActivities;
  }

  const merged = new Map<string, TActivity>();
  snapshot.toolActivities.forEach((activity) => {
    merged.set(activity.callId, mapRuntimeActivity(activity));
  });
  liveActivities.forEach((activity) => {
    merged.set(activity.callId, activity);
  });

  return [...merged.values()].sort((left, right) => {
    if (left.startedAt === right.startedAt) {
      return left.callId.localeCompare(right.callId);
    }
    return left.startedAt - right.startedAt;
  });
}

function cliProjectionStatusToRuntimeChildStatus(
  status: CLIChildProjection['status'],
): RuntimeChildExecution['status'] {
  if (status === 'running') {
    return 'running';
  }
  if (status === 'completed') {
    return 'completed';
  }
  if (status === 'failed') {
    return 'failed';
  }
  if (status === 'stopped') {
    return 'stopped';
  }
  return 'waiting';
}

function childExecutionsMatch(
  left: RuntimeChildExecution,
  right: RuntimeChildExecution,
): boolean {
  return left.kind === right.kind && (
    left.id === right.id
    || left.childSessionId === right.childSessionId
    || (
      Boolean(left.parentToolCallId)
      && left.parentToolCallId === right.parentToolCallId
    )
    || (
      Boolean(left.cliRunId)
      && left.cliRunId === right.cliRunId
    )
    || (
      Boolean(left.flowRunId)
      && left.flowRunId === right.flowRunId
    )
  );
}

export function upsertPendingByRequestId<T extends { requestId: string }>(
  current: T[] | undefined,
  nextEntry: T,
): T[] {
  const existing = current ?? [];
  const existingIndex = existing.findIndex((entry) => entry.requestId === nextEntry.requestId);
  if (existingIndex === -1) {
    return [...existing, nextEntry];
  }

  const next = [...existing];
  next[existingIndex] = nextEntry;
  return next;
}

export function removePendingByRequestId<T extends { requestId: string }>(
  current: T[] | undefined,
  requestId: string,
): T[] {
  return (current ?? []).filter((entry) => entry.requestId !== requestId);
}

export function syncPendingCollectionsFromRuntimeSnapshot(params: {
  pendingConfirmations: Record<string, ToolConfirmationRequest[]>;
  pendingBudgetApprovals: Record<string, AgentBudgetApprovalRequest[]>;
  snapshot: SocketEvents['session:runtime_snapshot'];
}): Pick<{
  pendingConfirmations: Record<string, ToolConfirmationRequest[]>;
  pendingBudgetApprovals: Record<string, AgentBudgetApprovalRequest[]>;
}, 'pendingConfirmations' | 'pendingBudgetApprovals'> {
  const syncedPendingConfirmations = { ...params.pendingConfirmations };
  const syncedPendingBudgetApprovals = { ...params.pendingBudgetApprovals };

  if (params.snapshot.pendingConfirmations.length > 0) {
    syncedPendingConfirmations[params.snapshot.sessionId] = [...params.snapshot.pendingConfirmations];
  } else {
    delete syncedPendingConfirmations[params.snapshot.sessionId];
  }

  if (params.snapshot.pendingBudgetApprovals.length > 0) {
    syncedPendingBudgetApprovals[params.snapshot.sessionId] = [...params.snapshot.pendingBudgetApprovals];
  } else {
    delete syncedPendingBudgetApprovals[params.snapshot.sessionId];
  }

  return {
    pendingConfirmations: syncedPendingConfirmations,
    pendingBudgetApprovals: syncedPendingBudgetApprovals,
  };
}

export function runtimeChildExecutionFromCliProjection(
  projection: CLIChildProjection,
  now = Date.now(),
): RuntimeChildExecution {
  return {
    id: projection.parentCallId || projection.childSessionId,
    kind: 'cli_agent',
    parentSessionId: projection.parentSessionId,
    childSessionId: projection.childSessionId,
    parentToolCallId: projection.parentCallId,
    cliRunId: projection.parentCallId,
    label: projection.agentId,
    status: cliProjectionStatusToRuntimeChildStatus(projection.status),
    errorCode: projection.errorCode,
    failure: projection.failure,
    lastOutput: projection.lastOutput,
    updatedAt: now,
  };
}

export function runtimeChildExecutionFromSubagentLoop(
  sessionId: string,
  agentRun: AgentRunContext | undefined,
  now = Date.now(),
): RuntimeChildExecution | null {
  if (
    agentRun?.agentType !== 'subagent'
    || !agentRun.parentSessionId
    || !agentRun.parentToolCallId
  ) {
    return null;
  }

  return {
    id: agentRun.agentRunId || sessionId,
    kind: 'subagent',
    parentSessionId: agentRun.parentSessionId,
    childSessionId: sessionId,
    parentToolCallId: agentRun.parentToolCallId,
    label: agentRun.label,
    status: 'running',
    updatedAt: now,
  };
}

export function upsertRuntimeChildExecution(
  list: RuntimeChildExecution[],
  execution: RuntimeChildExecution,
): RuntimeChildExecution[] {
  const existingIndex = list.findIndex((item) => childExecutionsMatch(item, execution));
  if (existingIndex === -1) {
    return [...list, execution];
  }

  return list.map((item, index) => (
    index === existingIndex ? { ...item, ...execution } : item
  ));
}

export function patchRuntimeChildExecution(
  list: RuntimeChildExecution[],
  matcher: (execution: RuntimeChildExecution) => boolean,
  patch: Partial<RuntimeChildExecution>,
): RuntimeChildExecution[] {
  let changed = false;
  const next = list.map((execution) => {
    if (!matcher(execution)) {
      return execution;
    }
    changed = true;
    return { ...execution, ...patch };
  });

  return changed ? next : list;
}

export function createEmptyRuntimeActivitySnapshot(
  sessionId: string,
  now = Date.now(),
): SocketEvents['session:runtime_snapshot'] {
  return {
    sessionId,
    active: false,
    queueLength: 0,
    pendingConfirmations: [],
    pendingBudgetApprovals: [],
    toolActivities: [],
    childExecutions: [],
    updatedAt: now,
  };
}

export function updateRuntimeSnapshot(
  snapshots: Record<string, SocketEvents['session:runtime_snapshot']>,
  sessionId: string,
  updater: (snapshot: SocketEvents['session:runtime_snapshot']) => SocketEvents['session:runtime_snapshot'],
  options: { createIfMissing?: boolean } = {},
): Record<string, SocketEvents['session:runtime_snapshot']> {
  if (!sessionId.trim()) {
    return snapshots;
  }

  const current = snapshots[sessionId];
  if (!current && options.createIfMissing === false) {
    return snapshots;
  }

  return {
    ...snapshots,
    [sessionId]: updater(current ?? createEmptyRuntimeActivitySnapshot(sessionId)),
  };
}

export function patchRuntimeToolActivitiesByCallId(
  snapshots: Record<string, SocketEvents['session:runtime_snapshot']>,
  callId: string,
  patch: Partial<RuntimeToolActivity>,
): Record<string, SocketEvents['session:runtime_snapshot']> {
  let changed = false;
  const now = Date.now();

  const nextEntries = Object.entries(snapshots).map(([sessionId, snapshot]) => {
    const hasTarget = snapshot.toolActivities.some((activity) => activity.callId === callId);
    if (!hasTarget) {
      return [sessionId, snapshot] as const;
    }

    changed = true;
    return [sessionId, {
      ...snapshot,
      toolActivities: snapshot.toolActivities.map((activity) => (
        activity.callId === callId ? { ...activity, ...patch } : activity
      )),
      updatedAt: now,
    }] as const;
  });

  return changed ? Object.fromEntries(nextEntries) : snapshots;
}

export function syncSessionToolActivitiesFromRuntimeSnapshot<TActivity extends { sessionId?: string }>(
  state: SessionToolActivityState<TActivity>,
  snapshot: SocketEvents['session:runtime_snapshot'],
  mapRuntimeActivity: (activity: RuntimeToolActivity) => TActivity,
): SessionToolActivityState<TActivity> {
  const runtimeActivities = snapshot.toolActivities.map(mapRuntimeActivity);
  const nextSessionToolActivities = { ...state.sessionToolActivities };

  if (runtimeActivities.length > 0) {
    nextSessionToolActivities[snapshot.sessionId] = runtimeActivities;
  } else {
    delete nextSessionToolActivities[snapshot.sessionId];
  }

  return {
    toolActivities: [
      ...state.toolActivities.filter((activity) => activity.sessionId !== snapshot.sessionId),
      ...runtimeActivities,
    ],
    sessionToolActivities: nextSessionToolActivities,
  };
}

export function runtimeSnapshotHasActiveSessionRuntime(
  snapshot: SocketEvents['session:runtime_snapshot'] | undefined,
): boolean {
  if (!snapshot) {
    return false;
  }

  const runStatus = snapshot.run?.status as string | undefined;
  if (runStatus === 'active' || runStatus === 'waiting_on_orchestrator') {
    return true;
  }

  return snapshot.childExecutions.some((execution) => (
    execution.status === 'running' || execution.status === 'waiting'
  ));
}
