import type {
  AgentBudgetApprovalRequest,
  RuntimeToolActivity,
  SocketEvents,
  ToolBudgetProgress,
  ToolConfirmationRequest,
} from '@kalio/types';
import type { CLIChildProjection } from '../features/chat/cliChildProjection.model';
import { areSessionStatusSnapshotsEquivalent } from './sessionStatusSnapshot';
import {
  runtimeChildExecutionFromCliProjection,
  syncPendingCollectionsFromRuntimeSnapshot,
  syncSessionToolActivitiesFromRuntimeSnapshot,
  updateRuntimeSnapshot,
  upsertPendingByRequestId,
  upsertRuntimeChildExecution,
  removePendingByRequestId,
} from './agentRuntimeStore.helpers';

interface RuntimePendingState {
  pendingConfirmations: Record<string, ToolConfirmationRequest[]>;
  pendingBudgetApprovals: Record<string, AgentBudgetApprovalRequest[]>;
  settledConfirmationRequestIds: Record<string, true>;
  runtimeActivitySnapshots: Record<string, SocketEvents['session:runtime_snapshot']>;
}

interface SessionToolActivityState<TActivity extends { sessionId?: string }> {
  toolActivities: TActivity[];
  sessionToolActivities: Record<string, TActivity[]>;
}

interface RuntimeSnapshotSyncState<TActivity extends { sessionId?: string }>
  extends RuntimePendingState, SessionToolActivityState<TActivity> {
  queuedDepthBySession: Record<string, number>;
}

interface BufferedStatusState {
  bufferedSessionStatusSnapshots: Record<string, SocketEvents['session:status'][]>;
  runtimeActivitySnapshots: Record<string, SocketEvents['session:runtime_snapshot']>;
}

interface CliProjectionState {
  cliChildProjections: Record<string, CLIChildProjection>;
  runtimeActivitySnapshots: Record<string, SocketEvents['session:runtime_snapshot']>;
}

function isStaleRuntimeSnapshot(
  current: SocketEvents['session:runtime_snapshot'] | undefined,
  incoming: SocketEvents['session:runtime_snapshot'],
): boolean {
  if (!current?.run || !incoming.run || current.run.id !== incoming.run.id) {
    return false;
  }
  if (typeof current.run.revision !== 'number' || typeof incoming.run.revision !== 'number') {
    // TODO: legacy fallback. Snapshots written before the revision migration lack a durable order.
    return false;
  }
  return incoming.run.revision <= current.run.revision;
}

function applyPendingConfirmationEntries(
  state: RuntimePendingState,
  sessionId: string,
  nextEntries: ToolConfirmationRequest[],
  createIfMissing: boolean,
): RuntimePendingState {
  const visibleNextEntries = nextEntries.filter((entry) => !state.settledConfirmationRequestIds[entry.requestId]);
  return {
    ...state,
    pendingConfirmations: visibleNextEntries.length > 0
      ? { ...state.pendingConfirmations, [sessionId]: visibleNextEntries }
      : Object.fromEntries(
          Object.entries(state.pendingConfirmations).filter(([key]) => key !== sessionId),
        ),
    runtimeActivitySnapshots: updateRuntimeSnapshot(
      state.runtimeActivitySnapshots,
      sessionId,
      (snapshot) => ({
        ...snapshot,
        pendingConfirmations: visibleNextEntries,
        updatedAt: Date.now(),
      }),
      { createIfMissing },
    ),
  };
}

function applyPendingBudgetApprovalEntries(
  state: RuntimePendingState,
  sessionId: string,
  nextEntries: AgentBudgetApprovalRequest[],
  createIfMissing: boolean,
): RuntimePendingState {
  return {
    ...state,
    pendingBudgetApprovals: nextEntries.length > 0
      ? { ...state.pendingBudgetApprovals, [sessionId]: nextEntries }
      : Object.fromEntries(
          Object.entries(state.pendingBudgetApprovals).filter(([key]) => key !== sessionId),
        ),
    runtimeActivitySnapshots: updateRuntimeSnapshot(
      state.runtimeActivitySnapshots,
      sessionId,
      (snapshot) => {
        const next = {
          ...snapshot,
          pendingBudgetApprovals: nextEntries,
          updatedAt: Date.now(),
        };
        const progress = budgetProgressFromPendingApproval(nextEntries[0]);
        if (progress) {
          next.toolBudgetProgress = progress;
        } else {
          delete next.toolBudgetProgress;
        }
        return next;
      },
      { createIfMissing },
    ),
  };
}

function budgetProgressFromPendingApproval(
  approval: AgentBudgetApprovalRequest | undefined,
): ToolBudgetProgress | undefined {
  if (!approval) {
    return undefined;
  }
  return {
    sessionId: approval.sessionId,
    usedIterations: approval.usedIterations,
    currentLimit: approval.currentLimit,
    status: 'waiting',
    runtimeKind: approval.scope,
    personaId: approval.personaId,
    agentRun: approval.agentRun,
    nodeId: approval.nodeId,
    roleSlotId: approval.roleSlotId,
    updatedAt: Date.now(),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function structurallyEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) {
    return true;
  }
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) {
      return false;
    }
    return left.every((value, index) => structurallyEqual(value, right[index]));
  }
  if (!isRecord(left) || !isRecord(right)) {
    return false;
  }
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  if (leftKeys.length !== rightKeys.length) {
    return false;
  }
  return leftKeys.every((key) => Object.prototype.hasOwnProperty.call(right, key)
    && structurallyEqual(left[key], right[key]));
}

export function applyPendingConfirmationUpsert(
  state: RuntimePendingState,
  sessionId: string,
  request: ToolConfirmationRequest | null,
): RuntimePendingState {
  if (!sessionId.trim()) {
    return state;
  }

  if (request === null) {
    return applyPendingConfirmationEntries(state, sessionId, [], false);
  }
  if (state.settledConfirmationRequestIds[request.requestId]) {
    return state;
  }

  return applyPendingConfirmationEntries(
    state,
    sessionId,
    upsertPendingByRequestId(state.pendingConfirmations[sessionId], request),
    true,
  );
}

export function applyPendingBudgetApprovalUpsert(
  state: RuntimePendingState,
  sessionId: string,
  request: AgentBudgetApprovalRequest | null,
): RuntimePendingState {
  if (!sessionId.trim()) {
    return state;
  }

  if (request === null) {
    return applyPendingBudgetApprovalEntries(state, sessionId, [], false);
  }

  return applyPendingBudgetApprovalEntries(
    state,
    sessionId,
    upsertPendingByRequestId(state.pendingBudgetApprovals[sessionId], request),
    true,
  );
}

export function applyPendingConfirmationRemoval(
  state: RuntimePendingState,
  sessionId: string,
  requestId: string,
): RuntimePendingState {
  if (!sessionId.trim() || !requestId.trim()) {
    return state;
  }

  const nextState = applyPendingConfirmationEntries(
    state,
    sessionId,
    removePendingByRequestId(state.pendingConfirmations[sessionId], requestId),
    false,
  );
  return {
    ...nextState,
    settledConfirmationRequestIds: {
      ...nextState.settledConfirmationRequestIds,
      [requestId]: true,
    },
  };
}

export function applyPendingBudgetApprovalRemoval(
  state: RuntimePendingState,
  sessionId: string,
  requestId: string,
): RuntimePendingState {
  if (!sessionId.trim() || !requestId.trim()) {
    return state;
  }

  return applyPendingBudgetApprovalEntries(
    state,
    sessionId,
    removePendingByRequestId(state.pendingBudgetApprovals[sessionId], requestId),
    false,
  );
}

export function applyRuntimeActivitySnapshotSync<TActivity extends { sessionId?: string }>(
  state: RuntimeSnapshotSyncState<TActivity>,
  snapshot: SocketEvents['session:runtime_snapshot'],
  mapRuntimeActivity: (activity: RuntimeToolActivity) => TActivity,
): RuntimeSnapshotSyncState<TActivity> {
  if (isStaleRuntimeSnapshot(state.runtimeActivitySnapshots[snapshot.sessionId], snapshot)) {
    return state;
  }
  const filteredSnapshot: SocketEvents['session:runtime_snapshot'] = {
    ...snapshot,
    pendingConfirmations: snapshot.pendingConfirmations.filter((entry) =>
      !state.settledConfirmationRequestIds[entry.requestId],
    ),
    toolActivities: snapshot.toolActivities.filter((activity) =>
      activity.status !== 'pending_confirmation'
      || !activity.requestId
      || !state.settledConfirmationRequestIds[activity.requestId],
    ),
  };
  const syncedPendingCollections = syncPendingCollectionsFromRuntimeSnapshot({
    pendingConfirmations: state.pendingConfirmations,
    pendingBudgetApprovals: state.pendingBudgetApprovals,
    snapshot: filteredSnapshot,
  });
  const syncedToolActivities = syncSessionToolActivitiesFromRuntimeSnapshot(
    state,
    filteredSnapshot,
    mapRuntimeActivity,
  );

  if (
    structurallyEqual(state.runtimeActivitySnapshots[filteredSnapshot.sessionId], filteredSnapshot)
    && structurallyEqual(state.pendingConfirmations, syncedPendingCollections.pendingConfirmations)
    && structurallyEqual(state.pendingBudgetApprovals, syncedPendingCollections.pendingBudgetApprovals)
    && state.queuedDepthBySession[filteredSnapshot.sessionId] === filteredSnapshot.queueLength
    && structurallyEqual(state.toolActivities, syncedToolActivities.toolActivities)
    && structurallyEqual(state.sessionToolActivities, syncedToolActivities.sessionToolActivities)
  ) {
    return state;
  }

  return {
    ...state,
    runtimeActivitySnapshots: {
      ...state.runtimeActivitySnapshots,
      [filteredSnapshot.sessionId]: filteredSnapshot,
    },
    pendingConfirmations: syncedPendingCollections.pendingConfirmations,
    pendingBudgetApprovals: syncedPendingCollections.pendingBudgetApprovals,
    queuedDepthBySession: {
      ...state.queuedDepthBySession,
      [filteredSnapshot.sessionId]: filteredSnapshot.queueLength,
    },
    toolActivities: syncedToolActivities.toolActivities,
    sessionToolActivities: syncedToolActivities.sessionToolActivities,
  };
}

export function applyRecordedSessionStatusSnapshot(
  state: BufferedStatusState,
  snapshot: SocketEvents['session:status'],
): BufferedStatusState {
  const currentBuffer = state.bufferedSessionStatusSnapshots[snapshot.sessionId] ?? [];
  const previousBufferedSnapshot = currentBuffer[currentBuffer.length - 1];
  const nextRuntimeActivitySnapshots = updateRuntimeSnapshot(
    state.runtimeActivitySnapshots,
    snapshot.sessionId,
    (runtimeSnapshot) => ({
      ...runtimeSnapshot,
      active: snapshot.active,
      turnId: snapshot.turnId,
      queueLength: snapshot.queueLength,
      run: snapshot.run,
      updatedAt: snapshot.run?.updatedAt ?? Date.now(),
    }),
  );

  if (areSessionStatusSnapshotsEquivalent(previousBufferedSnapshot, snapshot)) {
    return {
      ...state,
      runtimeActivitySnapshots: nextRuntimeActivitySnapshots,
    };
  }

  return {
    ...state,
    bufferedSessionStatusSnapshots: {
      ...state.bufferedSessionStatusSnapshots,
      [snapshot.sessionId]: [...currentBuffer, snapshot],
    },
    runtimeActivitySnapshots: nextRuntimeActivitySnapshots,
  };
}

export function applyCliProjectionUpsert(
  state: CliProjectionState,
  projection: CLIChildProjection,
): CliProjectionState {
  const now = Date.now();
  const mergedProjection = {
    ...state.cliChildProjections[projection.childSessionId],
    ...projection,
  };

  return {
    cliChildProjections: {
      ...state.cliChildProjections,
      [projection.childSessionId]: mergedProjection,
    },
    runtimeActivitySnapshots: updateRuntimeSnapshot(
      state.runtimeActivitySnapshots,
      mergedProjection.parentSessionId,
      (snapshot) => ({
        ...snapshot,
        childExecutions: upsertRuntimeChildExecution(
          snapshot.childExecutions,
          runtimeChildExecutionFromCliProjection(mergedProjection, now),
        ),
        updatedAt: now,
      }),
    ),
  };
}
