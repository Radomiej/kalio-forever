import { ExternalLink, Loader2, MessageSquareText, Square, TerminalSquare } from 'lucide-react';
import { eventBus } from '../../services/eventBus';
import { useSessionStore } from '../../store/sessionStore';
import { useAgentStore } from '../../store/agentStore';
import type { CLIChildProjectionStatus } from './cliChildProjection.model';
import { useCLIChildCardState } from './CLIChildConversationCard.hooks';
import type { ToolActivity } from '../../store/agentStore';
import { activateConversationSession } from './activeConversationSession';

const CLI_FOLLOW_UP_MESSAGE = 'Continue from the current task. Share a concise status update and your next concrete step.';

function statusTone(status: CLIChildProjectionStatus): string {
  if (status === 'failed') return 'border-error/30 bg-error/10 text-error';
  if (status === 'stopped') return 'border-warning/30 bg-warning/10 text-warning';
  if (status === 'completed') return 'border-success/25 bg-success/10 text-success';
  if (status === 'running') return 'border-info/30 bg-info/10 text-info';
  return 'border-base-300/60 bg-base-200/40 text-base-content/60';
}

export function CLIChildConversationCard({
  toolName,
  parentSessionId,
  parentCallId,
  activity,
  resultData,
  childSessionId,
  onInspect,
  defaultExpanded = true,
}: {
  toolName: string;
  parentSessionId: string;
  parentCallId: string;
  activity?: ToolActivity;
  resultData?: unknown;
  childSessionId?: string;
  onInspect?: () => void;
  defaultExpanded?: boolean;
}) {
  const setActiveSession = useSessionStore((state) => state.setActiveSession);
  const setPendingMessage = useSessionStore((state) => state.setPendingMessage);
  const sessions = useSessionStore((state) => state.sessions);
  const setCanvasOpen = useAgentStore((state) => state.setCanvasOpen);
  const { projection, liveOutput, childTitle, status } = useCLIChildCardState({
    activity,
    toolName,
    parentSessionId,
    parentCallId,
    resultData,
    childSessionId,
  });
  const childSessionExists = useSessionStore((state) => (
    projection?.childSessionId != null && state.sessions.some((session) => session.id === projection.childSessionId)
  ));

  if (!projection || projection.isPending === true) {
    if (!projection) return null;
    return (
      <div
        className="border border-cyan-500/25 bg-cyan-500/5 rounded-xl px-3 py-2.5 text-xs"
        data-testid="cli-child-card-pending"
        data-parent-call-id={parentCallId}
      >
        <div className="flex items-center gap-2 text-cyan-300">
          <Loader2 size={12} className="animate-spin" />
          <span>Starting {projection.agentId} CLI child…</span>
        </div>
        {liveOutput.length > 0 && (
          <pre className="mt-2 text-[11px] text-base-content/70 bg-neutral/60 rounded px-2 py-1.5 max-h-48 overflow-y-auto whitespace-pre-wrap">
            {liveOutput.slice(-4000)}
          </pre>
        )}
      </div>
    );
  }

  const isRunning = status === 'running' || activity?.status === 'running';
  const outputTail = liveOutput.trim().length > 0
    ? liveOutput.slice(-4000)
    : projection.lastOutput.slice(-4000);

  const openChildChat = () => {
    void activateConversationSession({
      sessionId: projection.childSessionId,
      sessions,
      setActiveSession,
      reason: 'cli-child',
    });
  };

  const steerChild = () => {
    setPendingMessage(CLI_FOLLOW_UP_MESSAGE);
    void activateConversationSession({
      sessionId: projection.childSessionId,
      sessions,
      setActiveSession,
      reason: 'cli-child',
    });
  };

  const stopChild = () => {
    if (!eventBus.stopTurn(projection.childSessionId)) {
      console.error('[CLIChildConversationCard] stop could not be delivered', projection.childSessionId);
    }
  };

  const inspect = () => {
    if (onInspect) {
      onInspect();
      return;
    }
    setCanvasOpen(true);
  };

  return (
    <div
      className="border border-cyan-500/25 bg-cyan-500/5 rounded-xl px-3 py-2.5 text-xs space-y-2"
      data-testid={`cli-child-card-${projection.childSessionId}`}
      data-child-session-id={projection.childSessionId}
      data-parent-call-id={parentCallId}
    >
      <div className="flex items-start gap-2">
        <TerminalSquare size={12} className="text-cyan-400 mt-0.5 shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="text-cyan-300 truncate">{projection.agentId}</p>
          <p className="text-base-content/50 truncate">{childTitle}</p>
        </div>
        <span
          data-testid={`cli-child-status-${projection.childSessionId}`}
          className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 font-mono text-[10px] ${statusTone(status)}`}
        >
          {isRunning && <Loader2 size={10} className="animate-spin" />}
          {status}
        </span>
      </div>

      {defaultExpanded && outputTail.length > 0 && (
        <pre
          data-testid={`cli-child-output-${projection.childSessionId}`}
          className="text-[11px] text-base-content/70 bg-neutral/60 rounded px-2 py-1.5 max-h-48 overflow-y-auto whitespace-pre-wrap break-words leading-relaxed"
        >
          {outputTail}
        </pre>
      )}

      <div className="flex flex-wrap gap-2">
        {childSessionExists && (
          <button
            type="button"
            className="btn btn-xs btn-ghost gap-1"
            onClick={openChildChat}
            data-testid={`cli-child-open-${projection.childSessionId}`}
          >
            <ExternalLink size={12} />
            Open child chat
          </button>
        )}
        {isRunning && (
          <button
            type="button"
            className="btn btn-xs btn-ghost gap-1 text-error"
            onClick={stopChild}
            data-testid={`cli-child-stop-${projection.childSessionId}`}
          >
            <Square size={12} />
            Stop
          </button>
        )}
        {childSessionExists && (
          <button
            type="button"
            className="btn btn-xs btn-ghost gap-1"
            onClick={steerChild}
            data-testid={`cli-child-followup-${projection.childSessionId}`}
          >
            <MessageSquareText size={12} />
            Steer CLI child
          </button>
        )}
        <button
          type="button"
          className="btn btn-xs btn-ghost gap-1"
          onClick={inspect}
          data-testid={`cli-child-inspect-${projection.childSessionId}`}
        >
          Inspect
        </button>
      </div>
    </div>
  );
}
