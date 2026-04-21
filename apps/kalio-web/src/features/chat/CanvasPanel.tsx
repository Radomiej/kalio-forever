import { useState } from 'react';
import {
  Wrench, CheckCircle2, XCircle, Clock, ChevronDown, ChevronRight,
  Loader2, BrainCircuit, ArrowLeftFromLine, ArrowRightToLine, Info,
} from 'lucide-react';
import { useAgentStore, type ToolActivity } from '../../store/agentStore';
import { useSessionStore } from '../../store/sessionStore';

interface CanvasPanelProps {
  open: boolean;
  onToggle: () => void;
}

function StatusIcon({ status }: { status: ToolActivity['status'] }) {
  switch (status) {
    case 'running':
      return <Loader2 size={13} className="text-info animate-spin" />;
    case 'success':
      return <CheckCircle2 size={13} className="text-success" />;
    case 'error':
      return <XCircle size={13} className="text-error" />;
    case 'cancelled':
      return <XCircle size={13} className="text-base-content/40" />;
    case 'awaiting_confirmation':
      return <Clock size={13} className="text-warning animate-pulse" />;
  }
}

function ToolCard({ activity }: { activity: ToolActivity }) {
  const [open, setOpen] = useState(false);
  const duration =
    activity.finishedAt && activity.startedAt
      ? `${((activity.finishedAt - activity.startedAt) / 1000).toFixed(2)}s`
      : null;

  return (
    <div className="border border-base-300 rounded-xl overflow-hidden text-xs">
      <button
        className="w-full flex items-center gap-2 px-3 py-2 bg-base-200 hover:bg-base-300/60 transition-colors"
        onClick={() => setOpen((v) => !v)}
      >
        <Wrench size={12} className="shrink-0 text-base-content/50" />
        <span className="flex-1 text-left font-mono font-medium truncate">{activity.toolName}</span>
        {duration && <span className="text-base-content/40 shrink-0">{duration}</span>}
        <StatusIcon status={activity.status} />
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
      </button>

      {open && (
        <div className="px-3 py-2 space-y-2 bg-base-100">
          {/* Args */}
          <div>
            <p className="text-base-content/40 uppercase tracking-wide text-[10px] mb-1">Args</p>
            <pre className="text-[11px] text-base-content/70 overflow-x-auto whitespace-pre-wrap break-all">
              {JSON.stringify(activity.args, null, 2)}
            </pre>
          </div>
          {/* Result */}
          {activity.result && (
            <div>
              <p className="text-base-content/40 uppercase tracking-wide text-[10px] mb-1">Result</p>
              <pre className="text-[11px] text-base-content/70 overflow-x-auto whitespace-pre-wrap break-all">
                {activity.result.status === 'success'
                  ? JSON.stringify(activity.result.data, null, 2)
                  : activity.result.errorMessage ?? activity.result.errorCode}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ThinkingPreview() {
  const { thinkingChunks, messages, streamingChunks } = useSessionStore();
  // Find the latest streaming message with thinking
  const streamingMsg = messages.find((m) => m.streaming);
  if (!streamingMsg) return null;
  const thinking = thinkingChunks[streamingMsg.id];
  const answer = streamingChunks[streamingMsg.id];
  if (!thinking && !answer) return null;

  return (
    <div className="space-y-2">
      {thinking && (
        <div>
          <div className="flex items-center gap-1 mb-1 text-[10px] text-base-content/40 uppercase tracking-wide">
            <BrainCircuit size={10} />
            <span>Thinking</span>
          </div>
          <div className="text-[11px] text-base-content/50 whitespace-pre-wrap break-words line-clamp-6">
            {thinking}
          </div>
        </div>
      )}
    </div>
  );
}

function SessionStats() {
  const { messages, activeSessionId } = useSessionStore();
  const msgCount = messages.length;
  const userCount = messages.filter((m) => m.role === 'user').length;
  const assistantCount = messages.filter((m) => m.role === 'assistant').length;
  const totalChars = messages.reduce((a, m) => a + m.content.length, 0);
  const estimatedTokens = Math.ceil(totalChars / 4);

  if (!activeSessionId) return null;

  return (
    <div className="space-y-1 text-xs text-base-content/60">
      <div className="flex justify-between">
        <span>Messages</span>
        <span className="font-mono">{msgCount}</span>
      </div>
      <div className="flex justify-between">
        <span>User / Assistant</span>
        <span className="font-mono">{userCount} / {assistantCount}</span>
      </div>
      <div className="flex justify-between">
        <span>~Tokens</span>
        <span className={`font-mono ${estimatedTokens > 25000 ? 'text-warning' : estimatedTokens > 50000 ? 'text-error' : ''}`}>
          {estimatedTokens.toLocaleString()}
        </span>
      </div>
    </div>
  );
}

export function CanvasPanel({ open, onToggle }: CanvasPanelProps) {
  const { toolActivities, isStreaming } = useAgentStore();

  return (
    <>
      {/* Toggle tab — always visible */}
      <button
        className="absolute right-0 top-1/2 -translate-y-1/2 z-20 flex items-center justify-center w-5 h-12 bg-base-200 border border-base-300 rounded-l-lg hover:bg-base-300 transition-colors"
        onClick={onToggle}
        aria-label={open ? 'Close canvas' : 'Open canvas'}
        data-testid="canvas-toggle"
      >
        {open ? <ArrowRightToLine size={12} /> : <ArrowLeftFromLine size={12} />}
      </button>

      {/* Panel */}
      <aside
        data-testid="canvas-panel"
        className={`shrink-0 border-l border-base-300 flex flex-col bg-base-100 overflow-hidden transition-all duration-200 ease-in-out ${open ? 'w-72' : 'w-0'}`}
      >
        <div className="w-72 flex flex-col h-full overflow-hidden">
          {/* Header */}
          <div className="px-4 py-2 border-b border-base-300 bg-base-200 flex items-center gap-2 shrink-0">
            <Info size={14} className="text-base-content/50" />
            <span className="text-sm font-semibold flex-1">Canvas</span>
            {isStreaming && <Loader2 size={12} className="animate-spin text-info" />}
          </div>

          <div className="flex-1 overflow-y-auto p-3 space-y-4">
            {/* Live thinking */}
            {isStreaming && (
              <section>
                <p className="text-[10px] uppercase tracking-wide text-base-content/40 mb-2">Live</p>
                <ThinkingPreview />
              </section>
            )}

            {/* Tool activities */}
            {toolActivities.length > 0 && (
              <section>
                <p className="text-[10px] uppercase tracking-wide text-base-content/40 mb-2">
                  Tools ({toolActivities.length})
                </p>
                <div className="space-y-1.5">
                  {toolActivities.map((a) => (
                    <ToolCard key={a.callId} activity={a} />
                  ))}
                </div>
              </section>
            )}

            {/* Session stats */}
            <section>
              <p className="text-[10px] uppercase tracking-wide text-base-content/40 mb-2">Session</p>
              <SessionStats />
            </section>
          </div>
        </div>
      </aside>
    </>
  );
}
