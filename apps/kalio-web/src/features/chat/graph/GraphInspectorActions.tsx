import { CheckCircle2, ExternalLink, XCircle } from 'lucide-react';
import type { ToolConfirmationRequest } from '@kalio/types';
import { eventBus } from '../../../services/eventBus';
import type { ExecutionGraphNode } from './executionGraphModel';

interface GraphInspectorActionsProps {
  node: ExecutionGraphNode;
  activeSessionId: string;
  selectedConfirmation: ToolConfirmationRequest | null;
  setActiveSession: (sessionId: string | null) => void;
  setPendingConfirmation: (sessionId: string, confirmation: ToolConfirmationRequest | null) => void;
}

export function GraphInspectorActions({
  node,
  activeSessionId,
  selectedConfirmation,
  setActiveSession,
  setPendingConfirmation,
}: GraphInspectorActionsProps) {
  const isChildSessionNode = (node.payload.kind === 'subagent' || node.payload.kind === 'cli-agent')
    && node.sessionId
    && node.sessionId !== activeSessionId;
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
