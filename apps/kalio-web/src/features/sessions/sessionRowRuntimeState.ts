import type { ChatMessage, ChatSession, SocketEvents } from '@kalio/types';
import type { AgentTurn } from '../../store/sessionStore';
import {
  architectureRunIdForSession,
  architectureSlotIdForSession,
  isTechnicalArchitectureSession,
  visibleConversationTreeChildren,
  sessionStatusSnapshotToRuntimeState,
  type SessionRuntimeState,
} from './sessionTreeDisplay';
import { workflowEnvelopeRuntimeStateForSession } from './sessionWorkflowRuntimeState';

export function sessionRuntimeState(
  session: ChatSession | null,
  sessionId: string,
  pendingConfirmations: Record<string, unknown>,
  pendingBudgetApprovals: Record<string, unknown>,
  activeLoopSessionIds: Set<string>,
  queuedDepthBySession: Record<string, number>,
  sessionStatusSnapshots: Record<string, SocketEvents['session:status']>,
  sessionAgentTurns: Record<string, AgentTurn[]>,
  sessionMessages: Record<string, ChatMessage[]>,
  architectureSessionRuntimeStates: Map<string, SessionRuntimeState>,
): SessionRuntimeState | null {
  const safePendingConfirmations = pendingConfirmations ?? {};
  const safePendingBudgetApprovals = pendingBudgetApprovals ?? {};
  const safeActiveLoopSessionIds = activeLoopSessionIds ?? new Set<string>();
  const safeQueuedDepthBySession = queuedDepthBySession ?? {};
  const safeSessionAgentTurns = sessionAgentTurns ?? {};
  const safeSessionMessages = sessionMessages ?? {};
  if (safePendingConfirmations[sessionId] || safePendingBudgetApprovals[sessionId]) {
    return 'waiting';
  }
  if (safeActiveLoopSessionIds.has(sessionId) || (safeQueuedDepthBySession[sessionId] ?? 0) > 0) {
    return 'running';
  }
  const snapshotState = sessionStatusSnapshotToRuntimeState(sessionStatusSnapshots[sessionId]);
  if (snapshotState) {
    return snapshotState;
  }
  const architectureState = architectureSessionRuntimeStates.get(sessionId);
  if (architectureState) {
    return architectureState;
  }
  const workflowEnvelopeState = workflowEnvelopeRuntimeStateForSession(
    safeSessionMessages[sessionId] ?? [],
    safeSessionAgentTurns[sessionId] ?? [],
  );
  if (workflowEnvelopeState) {
    return workflowEnvelopeState;
  }
  const lastTurn = safeSessionAgentTurns[sessionId]?.at(-1);
  if (lastTurn?.error) {
    return 'error';
  }
  if (lastTurn?.done) {
    return 'done';
  }
  if (
    session
    && architectureRunIdForSession(session)
    && architectureSlotIdForSession(session)
    && !isTechnicalArchitectureSession(session)
  ) {
    return 'pending';
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
  sessionStatusSnapshots: Record<string, SocketEvents['session:status']>,
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
