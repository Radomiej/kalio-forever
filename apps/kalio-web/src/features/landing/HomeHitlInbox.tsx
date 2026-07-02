import { useState } from 'react';
import { AlertTriangle, Check, MessageSquare, X } from 'lucide-react';
import type { ChatSession, ToolConfirmationRequest } from '@kalio/types';
import { useAgentStore } from '../../store/agentStore';
import { useSessionStore } from '../../store/sessionStore';
import type { PendingRaAppApprovalItem } from '../../store/agentRuntimeRaAppApprovals';
import { eventBus } from '../../services/eventBus';
import { getToolTargetLabel } from '../chat/toolTargetLabel';

interface HomeHitlInboxProps {
  onOpenSession: (sessionId: string) => void;
  raAppApprovals?: PendingRaAppApprovalItem[];
  onRaAppApprovalSettled?: (sessionId: string, requestId: string) => void;
}

function formatArgValue(value: unknown): string {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'string') return value.length > 80 ? `${value.slice(0, 80)}...` : value;
  const serialized = JSON.stringify(value);
  return serialized.length > 80 ? `${serialized.slice(0, 80)}...` : serialized;
}

function buildArgPreview(args: Record<string, unknown>): string | null {
  const firstEntry = Object.entries(args)[0];
  if (!firstEntry) {
    return null;
  }
  return `${firstEntry[0]}: ${formatArgValue(firstEntry[1])}`;
}

function sessionTitle(session: ChatSession | undefined, sessionId: string): string {
  return session?.title?.trim() || `Session ${sessionId.slice(0, 8)}`;
}

function timeoutLabel(timeoutMs: number): string {
  if (timeoutMs === 0) {
    return 'no timeout';
  }
  const minutes = Math.max(1, Math.round(timeoutMs / 60_000));
  return `${minutes}m timeout`;
}

export function HomeHitlInbox({
  onOpenSession,
  raAppApprovals = [],
  onRaAppApprovalSettled,
}: HomeHitlInboxProps) {
  const pendingConfirmations = useAgentStore((s) => s.pendingConfirmations);
  const sessionToolActivities = useAgentStore((s) => s.sessionToolActivities);
  const removePendingConfirmation = useAgentStore((s) => s.removePendingConfirmation);
  const updateToolActivity = useAgentStore((s) => s.updateToolActivity);
  const sessions = useSessionStore((s) => s.sessions);
  const [notes, setNotes] = useState<Record<string, string>>({});

  const sessionsById = new Map(sessions.map((session) => [session.id, session]));
  const confirmations = Object.values(pendingConfirmations)
    .flat()
    .filter((confirmation): confirmation is ToolConfirmationRequest => confirmation != null)
    .sort((left, right) => left.sessionId.localeCompare(right.sessionId));
  const pendingActionCount = confirmations.length + raAppApprovals.length;

  const notePayload = (requestId: string): { message?: string } => {
    const message = notes[requestId]?.trim();
    return message ? { message } : {};
  };

  const approve = (confirmation: ToolConfirmationRequest) => {
    updateToolActivity(confirmation.toolCallId, {
      status: 'running',
      startedAt: Date.now(),
    });
    eventBus.confirmTool({
      requestId: confirmation.requestId,
      sessionId: confirmation.sessionId,
      ...notePayload(confirmation.requestId),
    });
    removePendingConfirmation(confirmation.sessionId, confirmation.requestId);
  };

  const reject = (confirmation: ToolConfirmationRequest) => {
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

  return (
    <section className="mb-4 rounded-2xl border border-base-300/70 bg-base-100/70 p-3" data-testid="home-hitl-inbox">
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
        <div className="rounded-xl border border-dashed border-base-300/70 bg-base-200/35 px-3 py-4 text-sm text-base-content/45">
          Nothing to do. Waiting for agents that need your approval.
        </div>
      ) : (
      <div className="grid gap-2 lg:grid-cols-2">
        {raAppApprovals.map((approval) => {
          const session = sessionsById.get(approval.sessionId);

          return (
            <article
              key={`raapp:${approval.sessionId}:${approval.requestId}`}
              className="rounded-xl border border-base-300/70 bg-base-100/80 p-3"
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
          const targetLabel = getToolTargetLabel(confirmation.toolName, args);
          const argPreview = buildArgPreview(args);
          const agentLabel = confirmation.agentRun?.label;

          return (
            <article
              key={confirmation.requestId}
              className="rounded-xl border border-base-300/70 bg-base-100/80 p-3"
            >
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="font-mono text-xs font-bold text-amber-300">{confirmation.toolName}</span>
                    {targetLabel && (
                      <span className="max-w-[14rem] truncate font-mono text-[10px] text-base-content/45" title={targetLabel}>
                        {targetLabel}
                      </span>
                    )}
                    <span className="rounded bg-warning/10 px-1.5 py-0.5 font-mono text-[10px] text-warning/80">
                      {timeoutLabel(confirmation.timeoutMs)}
                    </span>
                  </div>
                  <p className="mt-1 text-xs font-semibold text-base-content/80">
                    {sessionTitle(session, confirmation.sessionId)}
                  </p>
                  {agentLabel && (
                    <p className="text-[11px] text-base-content/45">{agentLabel}</p>
                  )}
                </div>
                <button
                  type="button"
                  className="btn btn-ghost btn-xs h-7 min-h-0 gap-1 px-2"
                  onClick={() => onOpenSession(confirmation.sessionId)}
                  data-testid={`home-hitl-open-${confirmation.requestId}`}
                >
                  <MessageSquare size={12} />
                  Open
                </button>
              </div>

              {argPreview && (
                <div className="mt-2 truncate rounded bg-base-200/70 px-2 py-1 font-mono text-[10px] text-base-content/45">
                  {argPreview}
                </div>
              )}

              <textarea
                className="textarea textarea-bordered mt-2 min-h-16 w-full resize-none bg-base-200/60 text-xs"
                placeholder="Optional note. Reject notes are sent to the agent; approve notes are logged."
                value={notes[confirmation.requestId] ?? ''}
                onChange={(event) => setNotes((current) => ({
                  ...current,
                  [confirmation.requestId]: event.target.value,
                }))}
                data-testid={`home-hitl-note-${confirmation.requestId}`}
              />

              <div className="mt-2 flex gap-2">
                <button
                  type="button"
                  className="btn btn-success btn-xs min-h-0 flex-1 gap-1"
                  onClick={() => approve(confirmation)}
                  data-testid={`home-hitl-approve-${confirmation.requestId}`}
                >
                  <Check size={12} />
                  Approve
                </button>
                <button
                  type="button"
                  className="btn btn-ghost btn-xs min-h-0 flex-1 gap-1 text-error hover:bg-error/10"
                  onClick={() => reject(confirmation)}
                  data-testid={`home-hitl-reject-${confirmation.requestId}`}
                >
                  <X size={12} />
                  Reject
                </button>
              </div>
            </article>
          );
        })}
      </div>
      )}
    </section>
  );
}
