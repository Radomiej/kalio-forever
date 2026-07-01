import type { ChatMessage, ChatSession } from '@kalio/types';
import type { AgentTurn } from '../../store/sessionStore';
import {
  visibleConversationTreeChildren,
  sessionStatusSnapshotToRuntimeState,
  type RuntimeSessionStatusSnapshot,
  type SessionRuntimeState,
} from './sessionTreeDisplay';
import { workflowEnvelopeRuntimeStateForSession } from './sessionWorkflowRuntimeState';

function isTerminalRuntimeState(state: SessionRuntimeState | null | undefined): state is 'done' | 'error' | 'stopped' {
  return state === 'done' || state === 'error' || state === 'stopped';
}

function isLiveMetadataRuntimeState(
  state: SessionRuntimeState | null | undefined,
): state is 'pending' | 'running' | 'waiting' {
  return state === 'pending' || state === 'running' || state === 'waiting';
}

export function sessionRuntimeState(
  _session: ChatSession | null,
  sessionId: string,
  pendingConfirmations: Record<string, unknown>,
  pendingBudgetApprovals: Record<string, unknown>,
  activeLoopSessionIds: Set<string>,
  queuedDepthBySession: Record<string, number>,
  sessionStatusSnapshots: Record<string, RuntimeSessionStatusSnapshot>,
  sessionAgentTurns: Record<string, AgentTurn[]>,
  sessionMessages: Record<string, ChatMessage[]>,
  architectureSessionRuntimeStates: Map<string, SessionRuntimeState>,
): SessionRuntimeState | null {
  const safePendingConfirmations = pendingConfirmations ?? {};
  const safePendingBudgetApprovals = pendingBudgetApprovals ?? {};
  const safeActiveLoopSessionIds = activeLoopSessionIds ?? new Set<string>();
  const safeQueuedDepthBySession = queuedDepthBySession ?? {};
  const safeSessionStatusSnapshots = sessionStatusSnapshots ?? {};
  const safeSessionAgentTurns = sessionAgentTurns ?? {};
  const safeSessionMessages = sessionMessages ?? {};
  if (safePendingConfirmations[sessionId] || safePendingBudgetApprovals[sessionId]) {
    return 'waiting';
  }
  const architectureState = architectureSessionRuntimeStates.get(sessionId);
  const workflowEnvelopeState = workflowEnvelopeRuntimeStateForSession(
    safeSessionMessages[sessionId] ?? [],
    safeSessionAgentTurns[sessionId] ?? [],
  );
  const liveMetadataState = [architectureState, workflowEnvelopeState]
    .find(isLiveMetadataRuntimeState) ?? null;
  const lastTurn = safeSessionAgentTurns[sessionId]?.at(-1);
  const turnTerminalState: SessionRuntimeState | null = lastTurn?.error
    ? 'error'
    : lastTurn?.done
      ? 'done'
      : null;
  const terminalState = [architectureState, workflowEnvelopeState, turnTerminalState]
    .find(isTerminalRuntimeState) ?? null;
  const snapshotState = sessionStatusSnapshotToRuntimeState(safeSessionStatusSnapshots[sessionId]);
  if (snapshotState) {
    if (!isTerminalRuntimeState(snapshotState) && terminalState) {
      return terminalState;
    }
    return snapshotState;
  }
  if (liveMetadataState) {
    return liveMetadataState;
  }
  if (terminalState) {
    return terminalState;
  }
  if (safeActiveLoopSessionIds.has(sessionId) || (safeQueuedDepthBySession[sessionId] ?? 0) > 0) {
    return 'running';
  }
  if (architectureState) {
    return architectureState;
  }
  if (workflowEnvelopeState) {
    return workflowEnvelopeState;
  }
  return null;
}

export function countDescendantRuntimeStates(
  sessionId: string,
  childSessionsByParent: Map<string, ChatSession[]>,
  pendingConfirmations: Record<string, unknown>,
  pendingBudgetApprovals: Record<string, unknown>,
  activeLoopSessionIds: Set<string>,
  queuedDepthBySession: Record<string, number>,
  sessionStatusSnapshots: Record<string, RuntimeSessionStatusSnapshot>,
  sessionAgentTurns: Record<string, AgentTurn[]>,
  sessionMessages: Record<string, ChatMessage[]>,
  architectureSessionRuntimeStates: Map<string, SessionRuntimeState>,
): { pending: number; running: number; waiting: number } {
  const safeChildSessionsByParent = childSessionsByParent ?? new Map<string, ChatSession[]>();
  const counts = { pending: 0, running: 0, waiting: 0 };
  const pending = [...visibleConversationTreeChildren(sessionId, safeChildSessionsByParent)];

  while (pending.length > 0) {
    const child = pending.shift();
    if (!child) break;
    const state = sessionRuntimeState(
      child,
      child.id,
      pendingConfirmations,
      pendingBudgetApprovals,
      activeLoopSessionIds,
      queuedDepthBySession,
      sessionStatusSnapshots,
      sessionAgentTurns,
      sessionMessages,
      architectureSessionRuntimeStates,
    );
    if (state === 'waiting') {
      counts.waiting += 1;
    } else if (state === 'running') {
      counts.running += 1;
    } else if (state === 'pending') {
      counts.pending += 1;
    }
    pending.push(...visibleConversationTreeChildren(child.id, safeChildSessionsByParent));
  }

  return counts;
}

export function descendantActivityState(
  counts: { pending: number; running: number; waiting: number },
): SessionRuntimeState | null {
  if (counts.waiting > 0) {
    return 'waiting';
  }
  if (counts.running > 0) {
    return 'running';
  }
  if (counts.pending > 0) {
    return 'pending';
  }
  return null;
}
