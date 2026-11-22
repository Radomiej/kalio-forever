import { useState } from 'react';
import { AlertTriangle, Check, MessageSquare, X } from 'lucide-react';
import type { AgentBudgetApprovalRequest, ChatSession, ToolConfirmationRequest } from '@kalio/types';
import { useAgentStore } from '../../store/agentStore';
import { useSessionStore } from '../../store/sessionStore';
import type { PendingRaAppApprovalItem } from '../../store/agentRuntimeRaAppApprovals';
import { eventBus } from '../../services/eventBus';
import { HomeHitlToolCard } from './HomeHitlToolCard';

interface HomeHitlInboxProps {
  onOpenSession: (sessionId: string) => void;
  raAppApprovals?: PendingRaAppApprovalItem[];
  onRaAppApprovalSettled?: (sessionId: string, requestId: string) => void;
}

function sessionTitle(session: ChatSession | undefined, sessionId: string): string {
  return session?.title?.trim() || `Session ${sessionId.slice(0, 8)}`;
}

export function HomeHitlInbox({
  onOpenSession,
  raAppApprovals = [],
  onRaAppApprovalSettled,
}: HomeHitlInboxProps) {
  const pendingConfirmations = useAgentStore((s) => s.pendingConfirmations);
  const pendingBudgetApprovals = useAgentStore((s) => s.pendingBudgetApprovals);
  const sessionToolActivities = useAgentStore((s) => s.sessionToolActivities);
  const removePendingConfirmation = useAgentStore((s) => s.removePendingConfirmation);
  const updateToolActivity = useAgentStore((s) => s.updateToolActivity);
  const sessions = useSessionStore((s) => s.sessions);
  const [notes, setNotes] = useState<Record<string, string>>({});

  const sessionsById = new Map(sessions.map((session) => [session.id, session]));
  const confirmations = Object.values(pendingConfirmations ?? {})
    .flat()
    .filter((confirmation): confirmation is ToolConfirmationRequest => confirmation != null)
    .sort((left, right) => left.sessionId.localeCompare(right.sessionId));
  const budgetApprovals = Object.values(pendingBudgetApprovals ?? {})
    .flat()
    .filter((approval): approval is AgentBudgetApprovalRequest => approval != null)
    .sort((left, right) => left.sessionId.localeCompare(right.sessionId));
  const pendingActionCount = confirmations.length + budgetApprovals.length + raAppApprovals.length;

  const notePayload = (requestId: string): { message?: string } => {
    const message = notes[requestId]?.trim();
    return message ? { message } : {};
  };

  const approve = (confirmation: ToolConfirmationRequest) => {
    eventBus.identifySession(confirmation.sessionId);
    eventBus.confirmTool({
      requestId: confirmation.requestId,
      sessionId: confirmation.sessionId,
      ...notePayload(confirmation.requestId),
    });
  };

  const reject = (confirmation: ToolConfirmationRequest) => {
    eventBus.identifySession(confirmation.sessionId);
    updateToolActivity(confirmation.toolCallId, {
      status: 'cancelled',
      finishedAt: Date.now(),
    });
    eventBus.cancelTool({
      requestId: confirmation.requestId,
      sessionId: confirmation.sessionId,
      ...notePayload(confirmation.requestId),
    });
    removePendingConfirmation(confirmation.sessionId, confirmation.requestId);
  };

  const approveRaApp = (sessionId: string, requestId: string) => {
    eventBus.identifySession(sessionId);
    eventBus.approveRaApp({
      sessionId,
      requestIds: [requestId],
    });
    onRaAppApprovalSettled?.(sessionId, requestId);
  };

  const rejectRaApp = (sessionId: string, requestId: string) => {
    eventBus.identifySession(sessionId);
    eventBus.cancelRaApp({
      sessionId,
      requestIds: [requestId],
    });
    onRaAppApprovalSettled?.(sessionId, requestId);
  };

  const decideBudget = (
    approval: AgentBudgetApprovalRequest,
    decision: 'allow_ten' | 'block',
  ) => {
    eventBus.identifySession(approval.sessionId);
    eventBus.approveAgentBudget({
      requestId: approval.requestId,
      sessionId: approval.sessionId,
      decision,
    });
  };

  return (
    <section className="mb-5" data-testid="home-hitl-inbox">
      <div className="mb-3 flex items-center gap-2">
        <AlertTriangle size={16} className={pendingActionCount > 0 ? 'text-warning animate-pulse' : 'text-base-content/35'} />
        <div>
          <h2 className="text-sm font-bold text-base-content/80">Ongoing actions</h2>
          <p className="text-xs text-base-content/45">
            {pendingActionCount > 0
              ? `${pendingActionCount} pending action${pendingActionCount === 1 ? '' : 's'} from active agents.`
              : 'Nothing to do.'}
          </p>
        </div>
      </div>

      {pendingActionCount === 0 ? (
        <div className="px-1 py-2 text-sm text-base-content/50" data-testid="home-hitl-empty">
          Nothing to do. Waiting for agents that need your approval.
        </div>
      ) : (
      <div className="grid min-w-0 grid-cols-1 gap-2">
        {budgetApprovals.map((approval) => {
          const session = sessionsById.get(approval.sessionId);
          const nextLimit = approval.suggestedNextLimit ?? Math.min(1000, approval.currentLimit + 10);

          return (
            <article
              key={`budget:${approval.requestId}`}
              className="rounded-xl border border-warning/55 border-l-4 border-l-warning bg-warning/10 p-3 shadow-sm"
            >
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="font-mono text-xs font-bold text-amber-300">Agent budget approval</span>
                    <span className="rounded bg-warning/10 px-1.5 py-0.5 font-mono text-[10px] text-warning/80">
                      no timeout
                    </span>
                  </div>
                  <p className="mt-1 text-xs font-semibold text-base-content/80">
                    {sessionTitle(session, approval.sessionId)}
                  </p>
                  <p className="text-[11px] text-base-content/45">
                    Tool loop reached {approval.usedIterations}/{approval.currentLimit}. Add +10 to continue.
                  </p>
                  <p className="mt-1 font-mono text-[10px] text-base-content/45">
                    +10 to {nextLimit}
                  </p>
                </div>
                <button
                  type="button"
                  className="btn btn-ghost btn-xs h-7 min-h-0 gap-1 px-2"
                  onClick={() => onOpenSession(approval.sessionId)}
                  data-testid={`home-hitl-open-budget-${approval.requestId}`}
                >
                  <MessageSquare size={12} />
                  Open
                </button>
              </div>

              <div className="mt-2 flex gap-2">
                <button
                  type="button"
                  className="btn btn-warning btn-xs min-h-0 flex-1 gap-1"
                  onClick={() => decideBudget(approval, 'allow_ten')}
                  data-testid={`home-hitl-approve-budget-${approval.requestId}`}
                >
                  <Check size={12} />
                  +10
                </button>
                <button
                  type="button"
                  className="btn btn-ghost btn-xs min-h-0 flex-1 gap-1 text-error hover:bg-error/10"
                  onClick={() => decideBudget(approval, 'block')}
                  data-testid={`home-hitl-reject-budget-${approval.requestId}`}
                >
                  <X size={12} />
                  Block
                </button>
              </div>
            </article>
          );
        })}
        {raAppApprovals.map((approval) => {
          const session = sessionsById.get(approval.sessionId);

          return (
            <article
              key={`raapp:${approval.sessionId}:${approval.requestId}`}
              className="rounded-xl border border-warning/55 border-l-4 border-l-warning bg-warning/10 p-3 shadow-sm"
            >
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="font-mono text-xs font-bold text-amber-300">RA-App approval</span>
                    <span className="max-w-[14rem] truncate font-mono text-[10px] text-base-content/45" title={approval.system}>
                      {approval.system}
                    </span>
                    <span className="rounded bg-warning/10 px-1.5 py-0.5 font-mono text-[10px] text-warning/80">
                      no timeout
                    </span>
                  </div>
                  <p className="mt-1 text-xs font-semibold text-base-content/80">
                    {sessionTitle(session, approval.sessionId)}
                  </p>
                  <p className="text-[11px] text-base-content/45">{approval.displayLabel}</p>
                </div>
                <button
                  type="button"
                  className="btn btn-ghost btn-xs h-7 min-h-0 gap-1 px-2"
                  onClick={() => onOpenSession(approval.sessionId)}
                  data-testid={`home-hitl-open-raapp-${approval.requestId}`}
                >
                  <MessageSquare size={12} />
                  Open
                </button>
              </div>

              <div className="mt-2 flex gap-2">
                <button
                  type="button"
                  className="btn btn-success btn-xs min-h-0 flex-1 gap-1"
                  onClick={() => approveRaApp(approval.sessionId, approval.requestId)}
                  data-testid={`home-hitl-approve-raapp-${approval.requestId}`}
                >
                  <Check size={12} />
                  Approve
                </button>
                <button
                  type="button"
                  className="btn btn-ghost btn-xs min-h-0 flex-1 gap-1 text-error hover:bg-error/10"
                  onClick={() => rejectRaApp(approval.sessionId, approval.requestId)}
                  data-testid={`home-hitl-reject-raapp-${approval.requestId}`}
                >
                  <X size={12} />
                  Reject
                </button>
              </div>
            </article>
          );
        })}
        {confirmations.map((confirmation) => {
          const session = sessionsById.get(confirmation.sessionId);
          const activity = sessionToolActivities[confirmation.sessionId]?.find(
            (candidate) => candidate.callId === confirmation.toolCallId,
          );
          const args = activity?.args ?? confirmation.args;
          return (
            <HomeHitlToolCard
              key={confirmation.requestId}
              confirmation={confirmation}
              session={session}
              args={args}
              note={notes[confirmation.requestId] ?? ''}
              onNoteChange={(note) => setNotes((current) => ({ ...current, [confirmation.requestId]: note }))}
              onOpenSession={() => onOpenSession(confirmation.sessionId)}
              onApprove={approve}
              onReject={reject}
            />
          );
        })}
      </div>
      )}
    </section>
  );
}
