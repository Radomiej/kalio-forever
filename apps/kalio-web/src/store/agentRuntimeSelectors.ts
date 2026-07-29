import type {
  AgentBudgetApprovalRequest,
  AgentRunContext,
  ChatMessage,
  ChatSession,
  RuntimeActivitySnapshot,
  SocketEvents,
  ToolConfirmationRequest,
} from '@kalio/types';
import {
  buildArchitectureSessionRuntimeStates,
  sessionStatusSnapshotToRuntimeState,
  type RuntimeSessionStatusSnapshot,
} from '../features/sessions/sessionTreeDisplay';
import {
  classifyRuntimeEvidence,
  extractLatestVisibleRuntimeEvidence,
} from './agentRuntimeEvidence';
import {
  canProjectPersistedRuntimeEvidence,
  sessionAttentionLabel,
  waitingDetail,
} from './agentRuntimeAttentionSupport';
import { selectPendingRaAppApprovals } from './agentRuntimeRaAppApprovals';

export { selectPendingApprovalCount } from './agentRuntimeApprovalSelectors';

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

export type RuntimeAttentionKind =
  | 'hitl'
  | 'budget'
  | 'runtime_waiting'
  | 'runtime_timeout'
  | 'runtime_error';

export interface RuntimeAttentionItem {
  id: string;
  sessionId: string;
  navigationSessionId: string;
  sourceSessionIds: string[];
  groupId?: string;
  kind: RuntimeAttentionKind;
  label: string;
  detail: string;
  actionable: boolean;
  priority: number;
  occurredAt: number;
}

export interface RuntimeContinuationAction {
  id: string;
  sessionId: string;
  parentSessionId: string;
  flowRunId: string;
  label: string;
  detail: string;
  input: string;
  actionable: boolean;
  priority: number;
}

function runtimeSnapshotToSessionStatus(
  snapshot: RuntimeActivitySnapshot,
): RuntimeSessionStatusSnapshot {
  return {
    sessionId: snapshot.sessionId,
    active: snapshot.active,
    turnId: snapshot.turnId,
    queueLength: snapshot.queueLength,
    run: snapshot.run,
    toolActivities: snapshot.toolActivities,
  };
}

function isLiveSessionState(state: ReturnType<typeof sessionStatusSnapshotToRuntimeState>): boolean {
  return state === 'pending' || state === 'running' || state === 'waiting';
}

function setRuntimeAttentionItem(
  itemsBySessionId: Map<string, RuntimeAttentionItem>,
  nextItem: RuntimeAttentionItem,
): void {
  const current = itemsBySessionId.get(nextItem.sessionId);
  if (!current || nextItem.priority < current.priority) {
    itemsBySessionId.set(nextItem.sessionId, nextItem);
  }
}

function attentionOccurrence(params: {
  evidenceUpdatedAt?: number;
  snapshot?: RuntimeActivitySnapshot;
}): number {
  return params.evidenceUpdatedAt
    ?? params.snapshot?.run?.completedAt
    ?? params.snapshot?.run?.updatedAt
    ?? 0;
}

function groupArchitectureRuntimeItems(
  items: RuntimeAttentionItem[],
  sessionsById: Map<string, ChatSession>,
): RuntimeAttentionItem[] {
  const architectureRootsByRunId = new Map<string, string>();
  sessionsById.forEach((session) => {
    const runId = session.runtimeContext?.architectureContext?.architectureRunId;
    if (runId && session.runtimeContext?.runtimeKind === 'agent-flow-root') {
      architectureRootsByRunId.set(runId, session.id);
    }
  });

  const grouped = new Map<string, RuntimeAttentionItem>();
  items.forEach((item) => {
    const session = sessionsById.get(item.sessionId);
    const runId = session?.runtimeContext?.architectureContext?.architectureRunId;
    if (!runId) {
      grouped.set(`session:${item.sessionId}`, item);
      return;
    }

    const groupId = `architecture:${runId}`;
    const rootSessionId = architectureRootsByRunId.get(runId) ?? item.sessionId;
    const current = grouped.get(groupId);
    const primary = !current || item.priority < current.priority ? item : current;
    const sourceSessionIds = [...new Set([
      ...(current?.sourceSessionIds ?? []),
      ...item.sourceSessionIds,
    ])].sort();

    grouped.set(groupId, {
      ...primary,
      id: `${primary.kind}:${groupId}`,
      sessionId: rootSessionId,
      navigationSessionId: rootSessionId,
      sourceSessionIds,
      groupId,
      label: sessionAttentionLabel(rootSessionId, sessionsById),
      occurredAt: Math.max(current?.occurredAt ?? 0, item.occurredAt),
    });
  });

  return [...grouped.values()];
}

function recoveredRunDetail(snapshot: RuntimeActivitySnapshot): string | null {
  if (snapshot.run?.status !== 'interrupted_needs_retry') {
    return null;
  }
  return snapshot.run.safeResume
    ? 'Backend restarted during LLM work. Retry is safe from the current transcript.'
    : 'Backend restarted during tool execution. Manual retry avoids duplicate tool execution.';
}

export function mergeRuntimeSessionStatusSnapshots(
  sessionStatusSnapshots: Record<string, SocketEvents['session:status']> | null | undefined,
  runtimeActivitySnapshots: Record<string, RuntimeActivitySnapshot> | null | undefined,
): Record<string, RuntimeSessionStatusSnapshot> {
  const merged: Record<string, RuntimeSessionStatusSnapshot> = {
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

export function selectRuntimeAttentionItems(params: {
  pendingConfirmations?: Record<string, ToolConfirmationRequest[] | ToolConfirmationRequest> | null;
  pendingBudgetApprovals?: Record<string, AgentBudgetApprovalRequest[] | AgentBudgetApprovalRequest> | null;
  pendingRaAppApprovals?: ReturnType<typeof selectPendingRaAppApprovals> | null;
  runtimeActivitySnapshots?: Record<string, RuntimeActivitySnapshot> | null;
  sessions?: ChatSession[] | null;
  sessionMessages?: Record<string, ChatMessage[]> | null;
}): RuntimeAttentionItem[] {
  const approvalItems: RuntimeAttentionItem[] = [];
  const actionableSessionIds = new Set<string>();
  const pendingConfirmations = params.pendingConfirmations ?? {};
  const pendingBudgetApprovals = params.pendingBudgetApprovals ?? {};

  Object.values(pendingConfirmations).forEach((entries) => {
    normalizePendingEntries(entries).forEach((confirmation) => {
      approvalItems.push({
        id: `hitl:${confirmation.requestId}`,
        sessionId: confirmation.sessionId,
        kind: 'hitl',
        label: confirmation.toolName,
        detail: 'Awaiting confirmation',
        actionable: true,
        priority: 0,
        occurredAt: 0,
        navigationSessionId: confirmation.sessionId,
        sourceSessionIds: [confirmation.sessionId],
      });
      actionableSessionIds.add(confirmation.sessionId);
    });
  });

  Object.values(pendingBudgetApprovals).forEach((entries) => {
    normalizePendingEntries(entries).forEach((approval) => {
      approvalItems.push({
        id: `budget:${approval.requestId}`,
        sessionId: approval.sessionId,
        kind: 'budget',
        label: approval.scope === 'chat' ? 'Budget approval' : 'Agent budget approval',
        detail: 'Budget approval required',
        actionable: true,
        priority: 0,
        occurredAt: 0,
        navigationSessionId: approval.sessionId,
        sourceSessionIds: [approval.sessionId],
      });
      actionableSessionIds.add(approval.sessionId);
    });
  });

  selectPendingRaAppApprovals({
    durableApprovals: params.pendingRaAppApprovals,
    sessionMessages: params.sessionMessages,
  }).forEach((approval) => {
    approvalItems.push({
      id: `raapp:${approval.sessionId}:${approval.requestId}`,
      sessionId: approval.sessionId,
      kind: 'hitl',
      label: 'RA-App approval',
      detail: approval.displayLabel,
      actionable: true,
      priority: 0,
      occurredAt: 0,
      navigationSessionId: approval.sessionId,
      sourceSessionIds: [approval.sessionId],
    });
    actionableSessionIds.add(approval.sessionId);
  });

  const sessions = params.sessions ?? [];
  const sessionMessages = params.sessionMessages ?? {};
  const runtimeActivitySnapshots = params.runtimeActivitySnapshots ?? {};
  const sessionsById = new Map(sessions.map((session) => [session.id, session]));
  const architectureSessionRuntimeStates = buildArchitectureSessionRuntimeStates(sessions, sessionMessages);
  const runtimeItemsBySessionId = new Map<string, RuntimeAttentionItem>();

  sessions.forEach((session) => {
    if (actionableSessionIds.has(session.id)) {
      return;
    }

    const snapshot = runtimeActivitySnapshots[session.id];
    const runtimeState = snapshot
      ? sessionStatusSnapshotToRuntimeState(runtimeSnapshotToSessionStatus(snapshot))
      : null;
    const architectureState = architectureSessionRuntimeStates.get(session.id) ?? null;
    const evidence = extractLatestVisibleRuntimeEvidence(sessionMessages[session.id]);
    const classifiedEvidence = classifyRuntimeEvidence(evidence);
    const label = sessionAttentionLabel(session.id, sessionsById);
    const persistedRuntimeEvidence = canProjectPersistedRuntimeEvidence(session);
    const recoveredDetail = snapshot ? recoveredRunDetail(snapshot) : null;

    if (
      classifiedEvidence
      && (
        runtimeState === 'waiting'
        || runtimeState === 'running'
        || runtimeState === 'error'
        || architectureState === 'waiting'
        || architectureState === 'error'
        || Boolean(snapshot)
        || persistedRuntimeEvidence
      )
    ) {
      setRuntimeAttentionItem(runtimeItemsBySessionId, {
        id: `${classifiedEvidence.kind}:${session.id}`,
        sessionId: session.id,
        kind: classifiedEvidence.kind,
        label,
        detail: classifiedEvidence.detail,
        actionable: false,
        priority: classifiedEvidence.priority,
        occurredAt: attentionOccurrence({
          evidenceUpdatedAt: evidence?.updatedAt,
          snapshot,
        }),
        navigationSessionId: session.id,
        sourceSessionIds: [session.id],
      });
      return;
    }

    if (recoveredDetail) {
      setRuntimeAttentionItem(runtimeItemsBySessionId, {
        id: `runtime_error:${session.id}`,
        sessionId: session.id,
        kind: 'runtime_error',
        label,
        detail: recoveredDetail,
        actionable: false,
        priority: 18,
        occurredAt: attentionOccurrence({ snapshot }),
        navigationSessionId: session.id,
        sourceSessionIds: [session.id],
      });
      return;
    }

    if (runtimeState === 'error' || architectureState === 'error') {
      setRuntimeAttentionItem(runtimeItemsBySessionId, {
        id: `runtime_error:${session.id}`,
        sessionId: session.id,
        kind: 'runtime_error',
        label,
        detail: 'Runtime error',
        actionable: false,
        priority: 20,
        occurredAt: attentionOccurrence({ snapshot }),
        navigationSessionId: session.id,
        sourceSessionIds: [session.id],
      });
      return;
    }

    if (runtimeState === 'waiting' || architectureState === 'waiting') {
      setRuntimeAttentionItem(runtimeItemsBySessionId, {
        id: `runtime_waiting:${session.id}`,
        sessionId: session.id,
        kind: 'runtime_waiting',
        label,
        detail: waitingDetail(snapshot),
        actionable: false,
        priority: 30,
        occurredAt: attentionOccurrence({ snapshot }),
        navigationSessionId: session.id,
        sourceSessionIds: [session.id],
      });
    }
  });

  Object.values(runtimeActivitySnapshots).forEach((snapshot) => {
    snapshot.childExecutions.forEach((execution) => {
      const targetSessionId = execution.childSessionId ?? snapshot.sessionId;
      if (
        actionableSessionIds.has(targetSessionId)
        || runtimeItemsBySessionId.has(targetSessionId)
      ) {
        return;
      }

      const label = sessionAttentionLabel(targetSessionId, sessionsById);
      if (execution.status === 'failed' || execution.status === 'blocked') {
        setRuntimeAttentionItem(runtimeItemsBySessionId, {
          id: `runtime_error:${targetSessionId}`,
          sessionId: targetSessionId,
          kind: 'runtime_error',
          label,
          detail: execution.status === 'blocked' ? 'Child execution blocked' : 'Child execution failed',
          actionable: false,
          priority: 15,
          occurredAt: execution.updatedAt,
          navigationSessionId: targetSessionId,
          sourceSessionIds: [targetSessionId],
        });
        return;
      }

      if (execution.status === 'waiting') {
        setRuntimeAttentionItem(runtimeItemsBySessionId, {
          id: `runtime_waiting:${targetSessionId}`,
          sessionId: targetSessionId,
          kind: 'runtime_waiting',
          label,
          detail: execution.kind === 'agent_flow'
            ? 'Waiting on orchestrator'
            : waitingDetail(undefined, execution.label),
          actionable: false,
          priority: 30,
          occurredAt: execution.updatedAt,
          navigationSessionId: targetSessionId,
          sourceSessionIds: [targetSessionId],
        });
      }
    });
  });

  return [
    ...approvalItems.sort((left, right) => left.id.localeCompare(right.id)),
    ...groupArchitectureRuntimeItems(
      [...runtimeItemsBySessionId.values()],
      sessionsById,
    ).sort((left, right) => {
      if (left.priority === right.priority) {
        return left.label.localeCompare(right.label);
      }
      return left.priority - right.priority;
    }),
  ];
}

export function selectRuntimeContinuationActions(params: {
  runtimeActivitySnapshots?: Record<string, RuntimeActivitySnapshot> | null;
  sessions?: ChatSession[] | null;
  sessionMessages?: Record<string, ChatMessage[]> | null;
}): RuntimeContinuationAction[] {
  const sessionsById = new Map((params.sessions ?? []).map((session) => [session.id, session]));
  const actionsByFlowRunId = new Map<string, RuntimeContinuationAction>();

  Object.values(params.runtimeActivitySnapshots ?? {}).forEach((snapshot) => {
    snapshot.childExecutions.forEach((execution) => {
      if (
        execution.kind !== 'agent_flow'
        || execution.status !== 'waiting'
        || !execution.flowRunId
      ) {
        return;
      }

      const childSession = sessionsById.get(execution.childSessionId);
      const label = childSession?.title?.trim()
        || execution.label?.trim()
        || sessionAttentionLabel(execution.childSessionId, sessionsById);
      actionsByFlowRunId.set(execution.flowRunId, {
        id: `agent_flow_resume:${execution.flowRunId}`,
        sessionId: execution.childSessionId,
        parentSessionId: execution.parentSessionId,
        flowRunId: execution.flowRunId,
        label,
        detail: 'Waiting on orchestrator',
        input: 'Continue.',
        actionable: true,
        priority: 25,
      });
    });
  });

  return [...actionsByFlowRunId.values()].sort((left, right) => {
    if (left.priority === right.priority) {
      return left.label.localeCompare(right.label);
    }
    return left.priority - right.priority;
  });
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
