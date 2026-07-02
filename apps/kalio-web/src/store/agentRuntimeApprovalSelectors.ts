import type {
  AgentBudgetApprovalRequest,
  ChatMessage,
  ToolConfirmationRequest,
} from '@kalio/types';
import {
  selectPendingRaAppApprovals,
  type PendingRaAppApprovalItem,
} from './agentRuntimeRaAppApprovals';

function normalizePendingEntries<T>(
  entries: T[] | T | null | undefined,
): T[] {
  if (Array.isArray(entries)) {
    return entries;
  }
  return entries ? [entries] : [];
}

export function selectPendingApprovalCount(params: {
  pendingConfirmations?: Record<string, ToolConfirmationRequest[] | ToolConfirmationRequest> | null;
  pendingBudgetApprovals?: Record<string, AgentBudgetApprovalRequest[] | AgentBudgetApprovalRequest> | null;
  pendingRaAppApprovals?: PendingRaAppApprovalItem[] | null;
  sessionMessages?: Record<string, ChatMessage[]> | null;
}): number {
  const confirmationCount = Object.values(params.pendingConfirmations ?? {})
    .reduce((total, entries) => total + normalizePendingEntries(entries).length, 0);
  const budgetApprovalCount = Object.values(params.pendingBudgetApprovals ?? {})
    .reduce((total, entries) => total + normalizePendingEntries(entries).length, 0);
  const raAppApprovalCount = selectPendingRaAppApprovals({
    durableApprovals: params.pendingRaAppApprovals,
    sessionMessages: params.sessionMessages,
  }).length;

  return confirmationCount + budgetApprovalCount + raAppApprovalCount;
}
