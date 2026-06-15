import type { ChatMessage, ChatSession, SocketEvents } from '@kalio/types';
import { architectureSessionSurfaceForSession } from './architectureSessionContext';
import {
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

function isArchitectureBranchConversationSession(session: ChatSession): boolean {
  const sessionSurface = architectureSessionSurfaceForSession(session);
  return sessionSurface === 'conversation-branch';
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
  signals: RenderableSessionFilterSignals = {},
): boolean {
  if (isTechnicalArchitectureSession(session)) {
    return false;
  }

  if (isArchitectureBranchConversationSession(session)) {
    return true;
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

  return {
    architectureSessionRuntimeStates,
    // Sidebar should reflect real child conversations only. Planned graph nodes belong to the
    // workflow timeline, but persisted non-technical child sessions remain visible immediately.
    renderableSessions: orderedSessions.filter((session) => (
      isRenderableConversationSession(
        session,
        sessionMessages,
        architectureSessionRuntimeStates,
        signals,
      )
    )),
  };
}
