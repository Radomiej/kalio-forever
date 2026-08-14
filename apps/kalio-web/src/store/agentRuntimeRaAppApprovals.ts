import type { ChatMessage, RaAppPendingApproval, RaAppPendingApprovalSnapshot } from '@kalio/types';

export interface PendingRaAppApprovalItem extends RaAppPendingApproval {
  requestId: string;
  sessionId: string;
  toolCallId?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function parseToolResultContent(content: unknown): Record<string, unknown> | null {
  if (typeof content !== 'string') {
    return null;
  }

  try {
    const parsed: unknown = JSON.parse(content);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function parsePendingApproval(value: unknown): RaAppPendingApproval | null {
  if (!isRecord(value)) {
    return null;
  }

  const { id, system, displayLabel, args } = value;
  if (
    typeof id !== 'string'
    || typeof system !== 'string'
    || typeof displayLabel !== 'string'
    || !isRecord(args)
  ) {
    return null;
  }

  return {
    id,
    system,
    displayLabel,
    args,
  };
}

export function selectPendingRaAppApprovals(params: {
  durableApprovals?: PendingRaAppApprovalItem[] | RaAppPendingApprovalSnapshot[] | null;
  sessionMessages?: Record<string, ChatMessage[]> | null;
}): PendingRaAppApprovalItem[] {
  const approvalsByKey = new Map<string, PendingRaAppApprovalItem>();

  (params.durableApprovals ?? []).forEach((approval) => {
    approvalsByKey.set(`${approval.sessionId}:${approval.id}`, {
      id: approval.id,
      requestId: approval.id,
      sessionId: approval.sessionId,
      toolCallId: approval.toolCallId,
      system: approval.system,
      displayLabel: approval.displayLabel,
      args: approval.args,
    });
  });

  Object.entries(params.sessionMessages ?? {}).forEach(([sessionId, messages]) => {
    messages.forEach((message) => {
      if (message.role !== 'tool_result') {
        return;
      }

      const payload = parseToolResultContent(message.content);
      const pendingApprovals = payload?.['pendingApprovals'];
      if (!Array.isArray(pendingApprovals)) {
        return;
      }

      pendingApprovals.forEach((candidate) => {
        const approval = parsePendingApproval(candidate);
        if (!approval) {
          return;
        }

        approvalsByKey.set(`${sessionId}:${approval.id}`, {
          ...approval,
          requestId: approval.id,
          sessionId,
          toolCallId: message.toolCallId,
        });
      });
    });
  });

  return [...approvalsByKey.values()].sort((left, right) => {
    if (left.sessionId === right.sessionId) {
      return left.requestId.localeCompare(right.requestId);
    }
    return left.sessionId.localeCompare(right.sessionId);
  });
}
