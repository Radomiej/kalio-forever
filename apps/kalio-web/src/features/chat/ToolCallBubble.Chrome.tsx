import { useState, type ReactNode } from 'react';
import { AlertTriangle, ChevronDown } from 'lucide-react';
import type { ToolActivity } from '../../store/agentStore';
import { useAgentStore } from '../../store/agentStore';
import { eventBus } from '../../services/eventBus';
import { getToolTargetLabel } from './toolTargetLabel';

function formatMs(ms: number): string {
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
}

export function formatArgValue(value: unknown): string {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'string') return value.length > 100 ? value.slice(0, 100) + '…' : value;
  const str = JSON.stringify(value);
  return str.length > 100 ? str.slice(0, 100) + '…' : str;
}

export function Chip({
  icon,
  toolName,
  targetLabel,
  badge,
  elapsed,
  expandable,
  open,
  onToggle,
  children,
}: {
  icon: ReactNode;
  toolName: string;
  targetLabel?: string | null;
  badge?: ReactNode;
  elapsed?: number | null;
  expandable: boolean;
  open: boolean;
  onToggle: () => void;
  children?: ReactNode;
}) {
  return (
    <div
      data-testid="tool-call-bubble"
      data-tool-name={toolName}
      className="border-l-[3px] border-l-emerald-500/40 pl-3 py-1 my-1"
    >
      <div data-testid="tool-call-chip" className="flex items-center gap-1.5 flex-wrap">
        {icon}
        <span className="font-mono text-xs text-sky-400">{toolName}</span>
        {targetLabel && (
          <span
            data-testid="tool-call-target"
            className="min-w-0 max-w-[16rem] truncate font-mono text-[10px] text-base-content/45"
            title={targetLabel}
          >
            {targetLabel}
          </span>
        )}
        {badge}
        {elapsed != null && (
          <span className="text-[10px] font-mono text-base-content/30">{formatMs(elapsed)}</span>
        )}
        {expandable && (
          <button
            className="ml-auto text-base-content/30 hover:text-base-content/60 transition-colors"
            onClick={onToggle}
            aria-label="Toggle details"
          >
            <ChevronDown
              size={11}
              className={`transition-transform duration-150 ${open ? 'rotate-180' : ''}`}
            />
          </button>
        )}
      </div>
      {open && children && (
        <div className="mt-2 space-y-1">{children}</div>
      )}
    </div>
  );
}

export function ConfirmationInlineBubble({ activity }: { activity: ToolActivity }) {
  const [argsOpen, setArgsOpen] = useState(false);
  const pendingConfirmations = useAgentStore((s) => s.pendingConfirmations);
  const toolArgProgress = useAgentStore((s) => s.toolArgProgress);
  const setPendingConfirmation = useAgentStore((s) => s.setPendingConfirmation);
  const updateToolActivity = useAgentStore((s) => s.updateToolActivity);
  const confirmation = Object.values(pendingConfirmations).find((pending) => pending.toolCallId === activity.callId);
  const matchingToolProgress = toolArgProgress?.toolName === activity.toolName ? toolArgProgress : null;

  const isMatch = confirmation != null;

  const argEntries = Object.entries(activity.args);
  const argPreview = argEntries.length === 0
    ? null
    : `${argEntries[0][0]}: ${formatArgValue(argEntries[0][1])}${argEntries.length > 1 ? ' …' : ''}`;
  const targetLabel = getToolTargetLabel(activity.toolName, activity.args);

  const handleConfirm = () => {
    if (!confirmation) return;
    updateToolActivity(activity.callId, { status: 'running', startedAt: Date.now() });
    eventBus.confirmTool({ requestId: confirmation.requestId, sessionId: confirmation.sessionId });
    setPendingConfirmation(confirmation.sessionId, null);
  };

  const handleCancel = () => {
    if (!confirmation) return;
    updateToolActivity(activity.callId, { status: 'cancelled', finishedAt: Date.now() });
    eventBus.cancelTool({ requestId: confirmation.requestId, sessionId: confirmation.sessionId });
    setPendingConfirmation(confirmation.sessionId, null);
  };

  return (
    <div
      data-testid="tool-call-bubble"
      className="border-l-[3px] border-l-amber-400/70 pl-3 py-1.5 my-1"
    >
      <div data-testid="tool-call-chip" className="flex items-center gap-1.5 flex-wrap">
        <AlertTriangle size={12} className="text-warning animate-pulse shrink-0" data-testid="awaiting-confirmation-icon" />
        <span className="font-mono text-xs text-amber-400">{activity.toolName}</span>
        {targetLabel && (
          <span
            data-testid="tool-call-target"
            className="min-w-0 max-w-[16rem] truncate font-mono text-[10px] text-base-content/45"
            title={targetLabel}
          >
            {targetLabel}
          </span>
        )}
        <span className="text-[10px] font-mono text-warning/70 bg-warning/10 rounded px-1">awaiting confirmation</span>
        {argPreview && (
          <button
            className="ml-auto text-base-content/30 hover:text-base-content/60 transition-colors"
            onClick={() => setArgsOpen((v) => !v)}
            aria-label="Toggle args"
            data-testid="confirmation-args-toggle"
          >
            <ChevronDown size={11} className={`transition-transform duration-150 ${argsOpen ? 'rotate-180' : ''}`} />
          </button>
        )}
      </div>

      {argPreview && !argsOpen && (
        <div className="mt-1 font-mono text-[10px] text-base-content/30 truncate" data-testid="args-preview">
          {argPreview}
        </div>
      )}

      {matchingToolProgress && (
        <div data-testid="tool-arg-progress-indicator" className="mt-1 font-mono text-[10px] text-base-content/45">
          {matchingToolProgress.totalChars > 0 ? (
            <>
              Writing <span className="text-base-content/65">{activity.toolName}</span>…{' '}
              {matchingToolProgress.totalChars.toLocaleString()} chars · {matchingToolProgress.charsPerSec.toLocaleString()}/s
            </>
          ) : (
            <>
              Preparing <span className="text-base-content/65">{activity.toolName}</span>…
            </>
          )}
        </div>
      )}

      {argsOpen && argEntries.length > 0 && (
        <div className="mt-1.5 font-mono bg-base-200/60 rounded px-2 py-1 max-h-40 overflow-y-auto text-xs text-base-content/50" data-testid="args-expanded">
          {argEntries.map(([k, v]) => (
            <div key={k}>
              <span className="text-base-content/40">{k}:</span> {formatArgValue(v)}
            </div>
          ))}
        </div>
      )}

      {isMatch && (
        <div className="flex gap-2 mt-2" data-testid="confirmation-actions">
          <button
            data-testid="confirmation-confirm-btn"
            className="btn btn-success btn-xs"
            onClick={handleConfirm}
          >
            Confirm
          </button>
          <button
            data-testid="confirmation-cancel-btn"
            className="btn btn-ghost btn-xs"
            onClick={handleCancel}
          >
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}
