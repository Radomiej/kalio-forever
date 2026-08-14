import { useState } from 'react';
import { eventBus } from '../../services/eventBus';
import { useAgentStore } from '../../store/agentStore';

interface SessionBudgetApprovalBannerProps {
  sessionId: string | null;
}

export function SessionBudgetApprovalBanner({ sessionId }: SessionBudgetApprovalBannerProps) {
  const [submittedBudgetRequestId, setSubmittedBudgetRequestId] = useState<string | null>(null);
  const { pendingBudgetApprovals, removePendingBudgetApproval } = useAgentStore();
  const pendingBudgetApprovalsForSession = sessionId ? (pendingBudgetApprovals ?? {})[sessionId] ?? [] : [];

  if (pendingBudgetApprovalsForSession.length === 0) {
    return null;
  }

  return (
    <div className="space-y-2">
      {pendingBudgetApprovalsForSession.map((pendingBudgetApproval) => (
        <div
          key={pendingBudgetApproval.requestId}
          className="max-w-xl rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning/85"
          data-testid="turn-budget-approval"
        >
          <div className="font-medium">
            Agent reached tool loop limit {pendingBudgetApproval.usedIterations}/{pendingBudgetApproval.currentLimit}
          </div>
          <div className="mt-1 text-warning/70">
            Continue with more tool requests for this run.
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            {[
              ['block', 'Block'],
              ['allow_one', '+1'],
              ['allow_ten', '+10'],
              ['allow_unlimited', 'Unlimited'],
            ].map(([decision, label]) => (
              <button
                key={decision}
                className={`btn btn-xs ${decision === 'block' ? 'btn-ghost' : 'btn-warning'}`}
                onClick={() => {
                  if (submittedBudgetRequestId === pendingBudgetApproval.requestId) {
                    return;
                  }
                  setSubmittedBudgetRequestId(pendingBudgetApproval.requestId);
                  eventBus.approveAgentBudget({
                    requestId: pendingBudgetApproval.requestId,
                    sessionId: pendingBudgetApproval.sessionId,
                    decision: decision as 'block' | 'allow_one' | 'allow_ten' | 'allow_unlimited',
                  });
                  removePendingBudgetApproval(pendingBudgetApproval.sessionId, pendingBudgetApproval.requestId);
                }}
                disabled={submittedBudgetRequestId === pendingBudgetApproval.requestId}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
