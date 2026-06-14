import { ArrowUpRight, MessageSquareText, X } from 'lucide-react';
import type { ChatMessage, ChatSession } from '@kalio/types';
import type { CanvasFocusTarget } from '../../store/agentStore';

type BranchCanvasFocus = Extract<CanvasFocusTarget, { kind: 'architecture-branch' }>;

function visibleTranscript(messages: ChatMessage[]): ChatMessage[] {
  return messages
    .filter((message) => message.role === 'user' || message.role === 'assistant')
    .slice()
    .sort((left, right) => left.createdAt - right.createdAt)
    .slice(-6);
}

function sessionTitle(sessions: ChatSession[], focus: BranchCanvasFocus): string {
  return focus.label
    ?? sessions.find((session) => session.id === focus.sessionId)?.title
    ?? focus.sessionId;
}

function hasRealBranchSession(sessions: ChatSession[], sessionId: string): boolean {
  return sessions.some((session) => session.id === sessionId);
}

export function CanvasFocusSection({
  focus,
  sessions,
  transcript,
  onClear,
  onOpenSession,
}: {
  focus: BranchCanvasFocus;
  sessions: ChatSession[];
  transcript: ChatMessage[];
  onClear: () => void;
  onOpenSession: (sessionId: string) => void;
}) {
  const visibleMessages = visibleTranscript(transcript);
  const hasSession = hasRealBranchSession(sessions, focus.sessionId);

  return (
    <section data-testid="canvas-focus-section">
      <div className="mb-2 flex items-center gap-2">
        <MessageSquareText size={12} className="text-sky-400" />
        <p className="text-[10px] uppercase tracking-wide text-base-content/40">Focused branch</p>
        <button
          type="button"
          className="ml-auto text-base-content/35 hover:text-base-content/70"
          aria-label="Clear canvas focus"
          onClick={onClear}
          data-testid="canvas-focus-clear"
        >
          <X size={12} />
        </button>
      </div>

      <div className="rounded-xl border border-sky-500/20 bg-sky-500/5 px-3 py-2.5 text-xs space-y-2">
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <p className="truncate font-medium text-sky-300">{sessionTitle(sessions, focus)}</p>
            <p className="font-mono text-[10px] text-base-content/40">{focus.sessionId}</p>
          </div>
          {hasSession && (
            <button
              type="button"
              className="btn btn-ghost btn-xs"
              onClick={() => onOpenSession(focus.sessionId)}
              data-testid={`canvas-focus-open-session-${focus.sessionId}`}
            >
              <ArrowUpRight size={10} />
              Open
            </button>
          )}
        </div>

        {visibleMessages.length > 0 ? (
          <div className="space-y-1" data-testid="canvas-focus-transcript">
            {visibleMessages.map((message) => (
              <div key={message.id} className="rounded bg-base-200/65 px-2 py-1">
                <span className="text-base-content/35 mr-1">{message.role === 'user' ? 'User:' : 'Agent:'}</span>
                <span className="text-base-content/70 whitespace-pre-wrap break-words">{message.content}</span>
              </div>
            ))}
          </div>
        ) : (
          <p className="rounded bg-base-200/65 px-2 py-1 text-base-content/45" data-testid="canvas-focus-empty">
            Waiting for branch transcript.
          </p>
        )}
      </div>
    </section>
  );
}
