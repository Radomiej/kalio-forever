import { useState } from 'react';
import { CheckCircle2, ExternalLink, PauseCircle, Send, XCircle } from 'lucide-react';
import type { ToolConfirmationRequest } from '@kalio/types';
import { eventBus } from '../../../services/eventBus';
import type { ExecutionGraphNode } from './executionGraphModel';

interface GraphInspectorActionsProps {
  node: ExecutionGraphNode;
  activeSessionId: string;
  selectedConfirmation: ToolConfirmationRequest | null;
  setActiveSession: (sessionId: string | null) => void;
  setPendingMessage: (message: string | null) => void;
  setPendingConfirmation: (sessionId: string, confirmation: ToolConfirmationRequest | null) => void;
}

const CLI_FOLLOW_UP_MESSAGE = 'Continue from the current task. Share a concise status update and your next concrete step.';

export function GraphInspectorActions({
  node,
  activeSessionId,
  selectedConfirmation,
  setActiveSession,
  setPendingMessage,
  setPendingConfirmation,
}: GraphInspectorActionsProps) {
  const [cliActionNotice, setCliActionNotice] = useState<string | null>(null);
  const isChildSessionNode = (node.payload.kind === 'subagent' || node.payload.kind === 'cli-agent')
    && node.sessionId
    && node.sessionId !== activeSessionId;
  const isCliChildNode = node.payload.kind === 'cli-agent' && isChildSessionNode;
  const shouldRender = isChildSessionNode || selectedConfirmation != null;

  if (!shouldRender) {
    return null;
  }

  return (
    <section className="rounded-[22px] border border-base-300 bg-base-200/35 px-5 py-4 space-y-3">
      <h4 className="text-xl font-black tracking-tight">Actions</h4>
      {isChildSessionNode && (
        <button
          type="button"
          className="w-full rounded-xl bg-sky-500/85 hover:bg-sky-500 text-white px-4 py-3 text-sm font-medium transition-colors"
          onClick={() => setActiveSession(node.sessionId ?? null)}
        >
          <span className="flex items-center justify-center gap-2">
            <ExternalLink size={14} />
            Open child chat
          </span>
        </button>
      )}
      {isCliChildNode && (
        <>
          <button
            type="button"
            aria-label="Send follow-up"
            className="w-full rounded-xl bg-cyan-500/85 hover:bg-cyan-500 text-white px-4 py-3 text-sm font-medium transition-colors"
            onClick={() => {
              setCliActionNotice(null);
              setPendingMessage(CLI_FOLLOW_UP_MESSAGE);
              setActiveSession(node.sessionId ?? null);
            }}
          >
            <span className="flex items-center justify-center gap-2">
              <Send size={14} />
              Send follow-up
            </span>
          </button>
          <button
            type="button"
            aria-label="Stop run"
            className="w-full rounded-xl border border-base-300 bg-base-100 px-4 py-3 text-sm font-medium transition-colors hover:bg-base-200"
            onClick={() => {
              setCliActionNotice(null);
              if (!node.sessionId || eventBus.stopTurn(node.sessionId)) {
                return;
              }
              setCliActionNotice('Stop request could not be delivered. Reconnect and retry.');
            }}
          >
            <span className="flex items-center justify-center gap-2">
              <PauseCircle size={14} />
              Stop run
            </span>
          </button>
          {cliActionNotice && (
            <p className="text-sm text-warning">{cliActionNotice}</p>
          )}
        </>
      )}
      {selectedConfirmation && (
        <>
          <button
            type="button"
            aria-label="Accept tool request"
            className="w-full rounded-xl bg-emerald-500/85 hover:bg-emerald-500 text-white px-4 py-3 text-sm font-medium transition-colors"
            onClick={() => {
              eventBus.confirmTool({ requestId: selectedConfirmation.requestId, sessionId: selectedConfirmation.sessionId });
              setPendingConfirmation(selectedConfirmation.sessionId, null);
            }}
          >
            <span className="flex items-center justify-center gap-2">
              <CheckCircle2 size={14} />
              Accept tool request
            </span>
          </button>
          <button
            type="button"
            aria-label="Cancel tool request"
            className="w-full rounded-xl border border-base-300 bg-base-100 px-4 py-3 text-sm font-medium transition-colors hover:bg-base-200"
            onClick={() => {
              eventBus.cancelTool({ requestId: selectedConfirmation.requestId, sessionId: selectedConfirmation.sessionId });
              setPendingConfirmation(selectedConfirmation.sessionId, null);
            }}
          >
            <span className="flex items-center justify-center gap-2">
              <XCircle size={14} />
              Cancel tool request
            </span>
          </button>
        </>
      )}
    </section>
  );
}
