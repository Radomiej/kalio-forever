import { useEffect, useState } from 'react';
import type { ChatMessage, RaAppPendingApprovalSnapshot } from '@kalio/types';
import { getPendingRAAppApprovals } from '../../services/apiClient';
import {
  selectPendingRaAppApprovals,
  type PendingRaAppApprovalItem,
} from '../../store/agentRuntimeRaAppApprovals';

function approvalKey(sessionId: string, requestId: string): string {
  return `${sessionId}:${requestId}`;
}

export function usePendingRaAppApprovals(
  sessionMessages: Record<string, ChatMessage[]> | null | undefined,
): {
  approvals: PendingRaAppApprovalItem[];
  markSettled: (sessionId: string, requestId: string) => void;
} {
  const [durableApprovals, setDurableApprovals] = useState<RaAppPendingApprovalSnapshot[]>([]);
  const [settledKeys, setSettledKeys] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    let cancelled = false;

    void getPendingRAAppApprovals()
      .then((approvals) => {
        if (!cancelled) {
          setDurableApprovals(approvals);
        }
      })
      .catch((error: unknown) => {
        console.warn('[RA-App HITL] failed to hydrate pending approvals', error);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const approvals = selectPendingRaAppApprovals({
    durableApprovals,
    sessionMessages,
  }).filter((approval) => !settledKeys.has(approvalKey(approval.sessionId, approval.requestId)));

  const markSettled = (sessionId: string, requestId: string): void => {
    const key = approvalKey(sessionId, requestId);
    setSettledKeys((current) => new Set(current).add(key));
    setDurableApprovals((current) => current.filter((approval) => (
      approvalKey(approval.sessionId, approval.id) !== key
    )));
  };

  return { approvals, markSettled };
}
