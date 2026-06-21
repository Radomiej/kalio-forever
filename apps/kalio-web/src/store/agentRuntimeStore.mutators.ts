import type {
  AgentBudgetApprovalRequest,
  RuntimeToolActivity,
  SocketEvents,
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

function applyPendingConfirmationEntries(
  state: RuntimePendingState,
  sessionId: string,
  nextEntries: ToolConfirmationRequest[],
  createIfMissing: boolean,
): RuntimePendingState {
  return {
    ...state,
    pendingConfirmations: nextEntries.length > 0
      ? { ...state.pendingConfirmations, [sessionId]: nextEntries }
      : Object.fromEntries(
          Object.entries(state.pendingConfirmations).filter(([key]) => key !== sessionId),
        ),
    runtimeActivitySnapshots: updateRuntimeSnapshot(
      state.runtimeActivitySnapshots,
      sessionId,
      (snapshot) => ({
        ...snapshot,
        pendingConfirmations: nextEntries,
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
      (snapshot) => ({
        ...snapshot,
        pendingBudgetApprovals: nextEntries,
        updatedAt: Date.now(),
      }),
      { createIfMissing },
    ),
  };
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

  return applyPendingConfirmationEntries(
    state,
    sessionId,
    removePendingByRequestId(state.pendingConfirmations[sessionId], requestId),
    false,
  );
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
  const syncedPendingCollections = syncPendingCollectionsFromRuntimeSnapshot({
    pendingConfirmations: state.pendingConfirmations,
    pendingBudgetApprovals: state.pendingBudgetApprovals,
    snapshot,
  });
  const syncedToolActivities = syncSessionToolActivitiesFromRuntimeSnapshot(
    state,
    snapshot,
    mapRuntimeActivity,
  );

  return {
    ...state,
    runtimeActivitySnapshots: {
      ...state.runtimeActivitySnapshots,
      [snapshot.sessionId]: snapshot,
    },
    pendingConfirmations: syncedPendingCollections.pendingConfirmations,
    pendingBudgetApprovals: syncedPendingCollections.pendingBudgetApprovals,
    queuedDepthBySession: {
      ...state.queuedDepthBySession,
      [snapshot.sessionId]: snapshot.queueLength,
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
