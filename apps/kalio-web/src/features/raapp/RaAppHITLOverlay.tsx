import { useEffect, useMemo, useState } from 'react';
import type { RaAppPendingApproval } from '@kalio/types';
import { useSessionStore } from '../../store/sessionStore';
import { eventBus } from '../../services/eventBus';

interface RaAppHITLOverlayProps {
  pendingApprovals: RaAppPendingApproval[];
  sessionId?: string;
  onSettled?: () => void;
}

/**
 * Renders a list of pending `call_native` approval requests.
 * The user can approve all or cancel all.
 * Buttons show a loading spinner while waiting for `raapp:native_result`.
 * The parent component drives hide by clearing pendingApprovals.
 */
export function RaAppHITLOverlay({ pendingApprovals, sessionId, onSettled }: RaAppHITLOverlayProps) {
  const activeSessionId = useSessionStore((s) => s.activeSessionId);
  const [submitting, setSubmitting] = useState<'approve' | 'cancel' | null>(null);
  const [settledApprovalIds, setSettledApprovalIds] = useState<Set<string>>(() => new Set());
  const targetSessionId = sessionId ?? activeSessionId;
  const pendingApprovalIds = useMemo(
    () => new Set(pendingApprovals.map((approval) => approval.id)),
    [pendingApprovals],
  );
  const visibleApprovals = pendingApprovals.filter((approval) => !settledApprovalIds.has(approval.id));

  useEffect(() => eventBus.onRaAppNativeResult((payload) => {
    if (!targetSessionId || payload.sessionId !== targetSessionId) {
      return;
    }

    const completedIds = payload.results
      .map((result) => result.id)
      .filter((id) => pendingApprovalIds.has(id));

    if (completedIds.length === 0) {
      return;
    }

    setSettledApprovalIds((current) => {
      const next = new Set(current);
      completedIds.forEach((id) => next.add(id));
      return next;
    });
    setSubmitting(null);
    onSettled?.();
  }), [onSettled, pendingApprovalIds, targetSessionId]);

  if (visibleApprovals.length === 0) return null;

  function handleApprove() {
    if (!targetSessionId || submitting) return;
    setSubmitting('approve');
    eventBus.approveRaApp({
      requestIds: visibleApprovals.map((a) => a.id),
      sessionId: targetSessionId,
    });
    // Do NOT call onSettled here — wait for raapp:native_result to arrive
    // and for the parent to update pendingApprovals to [] which hides this component.
  }

  function handleCancel() {
    if (!targetSessionId || submitting) return;
    setSubmitting('cancel');
    eventBus.cancelRaApp({
      requestIds: visibleApprovals.map((a) => a.id),
      sessionId: targetSessionId,
    });
  }

  return (
    <div
      data-testid="raapp-hitl-overlay"
      className="mt-2 rounded border border-warning bg-warning/10 p-3 text-xs space-y-2"
    >
      <p className="font-semibold text-warning">
        Pending approval ({visibleApprovals.length} operation{visibleApprovals.length > 1 ? 's' : ''})
      </p>
      <ul className="space-y-1">
        {visibleApprovals.map((approval) => (
          <li key={approval.id} className="rounded bg-base-200 px-2 py-1">
            <span className="font-mono font-semibold">{approval.system}</span>
            {' — '}
            <span className="text-base-content/70">{approval.displayLabel}</span>
            {Object.keys(approval.args).length > 0 && (
              <details className="mt-1">
                <summary className="cursor-pointer text-base-content/50">args</summary>
                <pre className="mt-1 overflow-auto text-[10px]">
                  {JSON.stringify(approval.args, null, 2)}
                </pre>
              </details>
            )}
          </li>
        ))}
      </ul>
      <div className="flex gap-2 pt-1">
        <button
          data-testid="raapp-hitl-approve"
          className="btn btn-warning btn-xs"
          onClick={handleApprove}
          disabled={!!submitting}
        >
          {submitting === 'approve' ? (
            <span className="loading loading-spinner loading-xs" />
          ) : (
            'Approve all'
          )}
        </button>
        <button
          data-testid="raapp-hitl-cancel"
          className="btn btn-ghost btn-xs"
          onClick={handleCancel}
          disabled={!!submitting}
        >
          {submitting === 'cancel' ? (
            <span className="loading loading-spinner loading-xs" />
          ) : (
            'Cancel'
          )}
        </button>
      </div>
    </div>
  );
}
