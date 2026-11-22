import { useEffect, useId, useRef, useState } from 'react';
import { Bot, Check, MessageSquare, X } from 'lucide-react';
import type { ChatSession, ToolConfirmationRequest } from '@kalio/types';

interface HomeHitlToolCardProps {
  confirmation: ToolConfirmationRequest;
  session?: ChatSession;
  args: Record<string, unknown>;
  note: string;
  onNoteChange: (note: string) => void;
  onOpenSession: () => void;
  onApprove: (confirmation: ToolConfirmationRequest) => void;
  onReject: (confirmation: ToolConfirmationRequest) => void;
}

function formatValue(value: unknown): string {
  return typeof value === 'string' ? value : JSON.stringify(value, null, 2) ?? String(value);
}

export function HomeHitlToolCard({ confirmation, session, args, note, onNoteChange,
  onOpenSession, onApprove, onReject }: HomeHitlToolCardProps) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const dialogId = useId();
  const titleId = useId();
  const sessionLabel = session?.title?.trim() || `Session ${confirmation.sessionId.slice(0, 8)}`;
  const agentLabel = confirmation.agentRun?.label?.trim();
  const waitingLabel = session?.title?.trim() || agentLabel || sessionLabel;
  const policyReason = 'policyReason' in confirmation && typeof confirmation.policyReason === 'string'
    ? confirmation.policyReason : undefined;
  const entries = Object.entries(args);
  const summary = entries.map(([key, value]) => `${key}: ${formatValue(value)}`).join('\n');
  const timeout = confirmation.timeoutMs === 0 ? 'no timeout'
    : `${Math.max(1, Math.round(confirmation.timeoutMs / 60_000))}m timeout`;

  useEffect(() => {
    if (!open) return;
    const element = dialog.current;
    const triggerElement = trigger.current;
    element?.showModal();
    closeButton.current?.focus();
    return () => {
      element?.close();
      if (triggerElement?.isConnected) triggerElement.focus();
    };
  }, [open]);

  return (
    <article className="min-w-0 rounded-xl border border-warning/55 border-l-4 border-l-warning bg-warning/10 p-3 shadow-sm">
      <p className="flex items-start gap-2 text-xs font-semibold text-warning">
        <Bot size={18} className="shrink-0" aria-hidden="true" />
        <span className="min-w-0 break-words">Waiting for approval · <strong>{waitingLabel}</strong></span>
      </p>
      {agentLabel && <p className="mt-1 break-words text-xs text-base-content/80">{agentLabel}</p>}
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <span className="min-w-0 break-all font-mono text-xs font-bold text-base-content">{confirmation.toolName}</span>
        <span className="rounded bg-warning/10 px-1.5 py-0.5 text-[10px] text-warning/80">{timeout}</span>
      </div>
      {summary && <pre className="mt-2 max-h-24 overflow-auto whitespace-pre-wrap break-words rounded bg-base-200/70 px-2 py-1 font-mono text-xs text-base-content/80"
        data-testid={`home-hitl-summary-${confirmation.requestId}`}>{summary}</pre>}
      <div className="mt-2 flex flex-wrap gap-2">
        <button ref={trigger} type="button" className="btn btn-ghost btn-xs min-h-8" aria-haspopup="dialog"
          aria-expanded={open} aria-controls={open ? dialogId : undefined} onClick={() => setOpen(true)}>Details</button>
        <button type="button" className="btn btn-ghost btn-xs min-h-8 gap-1" onClick={onOpenSession}
          data-testid={`home-hitl-open-${confirmation.requestId}`}><MessageSquare size={12} aria-hidden="true" />Open</button>
      </div>
      <textarea className="textarea textarea-bordered mt-2 min-h-16 w-full resize-none bg-base-200/60 text-xs"
        aria-label={`Optional note for ${confirmation.toolName} approval`}
        placeholder="Optional note. Reject notes are sent to the agent; approve notes are logged."
        value={note} onChange={(event) => onNoteChange(event.target.value)}
        data-testid={`home-hitl-note-${confirmation.requestId}`} />
      <div className="mt-2 flex flex-wrap gap-2">
        <button type="button" className="btn btn-success btn-xs min-h-8 flex-1 gap-1" onClick={() => onApprove(confirmation)}
          data-testid={`home-hitl-approve-${confirmation.requestId}`}><Check size={12} aria-hidden="true" />Approve</button>
        <button type="button" className="btn btn-ghost btn-xs min-h-8 flex-1 gap-1 text-error hover:bg-error/10" onClick={() => onReject(confirmation)}
          data-testid={`home-hitl-reject-${confirmation.requestId}`}><X size={12} aria-hidden="true" />Reject</button>
      </div>
      {open && (
        <dialog ref={dialog} id={dialogId} aria-labelledby={titleId} className="modal"
          onCancel={(event) => { event.preventDefault(); setOpen(false); }}>
          <div className="modal-box max-h-[85vh] w-[calc(100vw-2rem)] max-w-4xl overflow-y-auto">
            <div className="mb-3 flex items-center justify-between gap-3">
              <h2 id={titleId} className="text-lg font-semibold">Approval details</h2>
              <button ref={closeButton} type="button" className="btn btn-ghost btn-square shrink-0"
                aria-label="Close approval details" onClick={() => setOpen(false)}><X size={18} aria-hidden="true" /></button>
            </div>
            <p className="break-words text-sm">{waitingLabel} · {confirmation.toolName}</p>
            {policyReason && <div className="mt-3">
              <h3 className="text-xs font-semibold">Policy reason</h3>
              <p className="whitespace-pre-wrap break-words text-sm">{policyReason}</p>
            </div>}
            <dl className="mt-3 space-y-3">
              {entries.map(([key, value]) => <div key={key} className="min-w-0">
                <dt className="break-all text-xs font-semibold">{key}</dt>
                <dd><pre className="overflow-auto whitespace-pre-wrap break-words rounded bg-base-200 p-3 font-mono text-sm"
                  data-testid={`home-hitl-detail-${key}`}>{formatValue(value)}</pre></dd>
              </div>)}
            </dl>
            {entries.length === 0 && <p className="mt-3 text-sm">No arguments.</p>}
          </div>
        </dialog>
      )}
    </article>
  );
}
