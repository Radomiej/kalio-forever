import type { ChatMessage, ChatSession, SocketEvents } from '@kalio/types';
import {
  architectureSlotIdForSession,
  buildArchitectureSessionRuntimeStates,
  isPendingArchitecturePlaceholderSession,
  isTechnicalArchitectureSession,
  sessionStatusSnapshotToRuntimeState,
  type SessionRuntimeState,
} from './sessionTreeDisplay';

type RenderableSessionFilterSignals = {
  pendingConfirmations?: Record<string, unknown>;
  pendingBudgetApprovals?: Record<string, unknown>;
  activeLoopSessionIds?: Set<string>;
  queuedDepthBySession?: Record<string, number>;
  sessionStatusSnapshots?: Record<string, SocketEvents['session:status']>;
};

function buildArchitectureBranchEvidenceSessionIds(
  sessionMessages: Record<string, ChatMessage[]>,
): Set<string> {
  const branchSessionIds = new Set<string>();

  Object.values(sessionMessages)
    .flat()
    .forEach((message) => {
      message.architectureRun?.trace.forEach((step) => {
        if (step.stream?.branchSessionId) {
          branchSessionIds.add(step.stream.branchSessionId);
        }
      });

      if (message.role !== 'tool_result') {
        return;
      }
      try {
        const parsed = JSON.parse(message.content) as Record<string, unknown>;
        if (typeof parsed['childSessionId'] === 'string' && typeof parsed['result'] === 'string') {
          branchSessionIds.add(parsed['childSessionId']);
        }
      } catch {
        // Ignore non-JSON tool payloads.
      }
    });

  return branchSessionIds;
}

function isArchitectureBranchConversationSession(session: ChatSession): boolean {
  return Boolean(architectureSlotIdForSession(session));
}

function hasArchitectureBranchConversationEvidence(
  session: ChatSession,
  sessionMessages: Record<string, ChatMessage[]>,
  branchEvidenceSessionIds: ReadonlySet<string>,
): boolean {
  return (sessionMessages[session.id] ?? []).length > 0 || branchEvidenceSessionIds.has(session.id);
}

function hasLiveSessionActivity(
  sessionId: string,
  signals: RenderableSessionFilterSignals,
): boolean {
  if (signals.pendingConfirmations?.[sessionId] || signals.pendingBudgetApprovals?.[sessionId]) {
    return true;
  }
  if (signals.activeLoopSessionIds?.has(sessionId) || (signals.queuedDepthBySession?.[sessionId] ?? 0) > 0) {
    return true;
  }
  return sessionStatusSnapshotToRuntimeState(signals.sessionStatusSnapshots?.[sessionId]) !== null;
}

export function isRenderableConversationSession(
  session: ChatSession,
  sessionMessages: Record<string, ChatMessage[]>,
  architectureSessionRuntimeStates: Map<string, SessionRuntimeState>,
  branchEvidenceSessionIds: ReadonlySet<string>,
  signals: RenderableSessionFilterSignals = {},
): boolean {
  if (isTechnicalArchitectureSession(session)) {
    return false;
  }

  if (isArchitectureBranchConversationSession(session)) {
    // Graph node status alone is not enough to promote a branch into the conversation tree.
    return hasArchitectureBranchConversationEvidence(session, sessionMessages, branchEvidenceSessionIds);
  }

  return !isPendingArchitecturePlaceholderSession(session, architectureSessionRuntimeStates, sessionMessages)
    || hasLiveSessionActivity(session.id, signals);
}

export function filterRenderableSessions(
  orderedSessions: ChatSession[],
  sessionMessages: Record<string, ChatMessage[]>,
  signals: RenderableSessionFilterSignals = {},
): {
  renderableSessions: ChatSession[];
  architectureSessionRuntimeStates: ReturnType<typeof buildArchitectureSessionRuntimeStates>;
} {
  const architectureSessionRuntimeStates = buildArchitectureSessionRuntimeStates(
    orderedSessions,
    sessionMessages,
  );
  const branchEvidenceSessionIds = buildArchitectureBranchEvidenceSessionIds(sessionMessages);

  return {
    architectureSessionRuntimeStates,
    // Sidebar should reflect real child conversations only. Planned graph nodes and untouched
    // branch placeholders belong to the workflow timeline, not the conversation tree.
    renderableSessions: orderedSessions.filter((session) => (
      isRenderableConversationSession(
        session,
        sessionMessages,
        architectureSessionRuntimeStates,
        branchEvidenceSessionIds,
        signals,
      )
    )),
  };
}
