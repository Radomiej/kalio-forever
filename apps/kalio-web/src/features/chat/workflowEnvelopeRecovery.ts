import type { ChatMessage, ChatSession } from '@kalio/types';
import { findArchitectureRunInMessages } from './architectureChatSummary';

const STALE_WORKFLOW_HISTORY_TOLERANCE_MS = 250;

export function hasWorkflowEnvelopeHistory(messages: ChatMessage[]): boolean {
  return findArchitectureRunInMessages(messages)?.hostProjectionKind === 'workflow-envelope';
}

export function needsWorkflowEnvelopeRecovery({
  session,
  messages,
  visibleDescendantCount = 0,
}: {
  session: ChatSession | null | undefined;
  messages: ChatMessage[];
  visibleDescendantCount?: number;
}): boolean {
  if (!hasArchitectureRuntimeContext(session)) {
    return false;
  }

  const run = findArchitectureRunInMessages(messages);
  if (!run) {
    return visibleDescendantCount > 0 || messages.some((message) => message.role === 'user');
  }

  if (latestMessageTimestamp(messages) + STALE_WORKFLOW_HISTORY_TOLERANCE_MS < session.updatedAt) {
    return true;
  }

  if (run.hostProjectionKind !== 'workflow-envelope') {
    return false;
  }

  if (run.status === 'queued' || run.status === 'running') {
    return true;
  }

  return workflowConversationEvidenceCount(run) > visibleDescendantCount;
}

function hasArchitectureRuntimeContext(session: ChatSession | null | undefined): session is ChatSession {
  return Boolean(
    session?.runtimeContext?.architectureContext
    && typeof session.runtimeContext.architectureContext === 'object',
  );
}

function latestMessageTimestamp(messages: ChatMessage[]): number {
  return messages.reduce((latest, message) => Math.max(latest, message.createdAt), 0);
}

function workflowConversationEvidenceCount(
  run: NonNullable<ReturnType<typeof findArchitectureRunInMessages>>,
): number {
  return new Set(
    run.trace
      .map((step) => step.stream?.branchSessionId)
      .filter((branchSessionId): branchSessionId is string => (
        typeof branchSessionId === 'string' && branchSessionId.trim().length > 0
      )),
  ).size;
}
