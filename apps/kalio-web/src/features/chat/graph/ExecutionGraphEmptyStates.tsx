import { useEffect, useState } from 'react';
import { ArrowRight, HelpCircle, Send } from 'lucide-react';
import type { ChatSession } from '@kalio/types';
import type { ReactNode } from 'react';

export function ExecutionGraphNoSessionState({
  graphSurfaceClassName,
  liveActivitySidebar,
  disabled = false,
  error,
  onSendPrompt,
  selectableSessions,
  onSelectSession,
}: {
  disabled?: boolean;
  error?: string | null;
  graphSurfaceClassName: string;
  liveActivitySidebar: ReactNode;
  onSendPrompt: (content: string) => void;
  selectableSessions: ChatSession[];
  onSelectSession: (sessionId: string) => void;
}) {
  return (
    <div className={graphSurfaceClassName}>
      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,820px)_auto]">
        <section className="w-full max-w-[820px] rounded-lg border border-sky-500/15 bg-[#101b2d]/92 p-4 text-sky-50 shadow-[0_18px_38px_rgba(2,12,27,0.28)]">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[10px] uppercase tracking-[0.22em] text-sky-200/65">Execution overview</p>
              <h3 className="mt-1 truncate text-xl font-black tracking-tight">Pick a session</h3>
            </div>
            <button
              type="button"
              className="tooltip tooltip-left inline-flex h-8 min-h-8 w-8 shrink-0 items-center justify-center rounded-md border border-sky-400/15 bg-sky-500/8 p-0 text-sky-100/60 hover:text-sky-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-300"
              data-tip="Graph mode can inspect recent root sessions, live agents and running tools before a session is focused."
              aria-label="Graph overview help"
            >
              <HelpCircle size={14} />
            </button>
          </div>
          <GraphPromptComposer
            disabled={disabled}
            error={error}
            onSendPrompt={onSendPrompt}
            placeholder="Start a new graph chat..."
          />

          <div className="mt-4 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
            {selectableSessions.map((session) => (
              <button
                key={session.id}
                type="button"
                aria-label={`Open session ${session.title} from graph overview`}
                className="rounded-md border border-sky-400/20 bg-sky-500/8 px-3 py-2 text-left transition-all hover:border-sky-300/40 hover:bg-sky-500/14"
                onClick={() => onSelectSession(session.id)}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-sky-50">{session.title}</p>
                    <p className="mt-1 text-[10px] uppercase tracking-[0.18em] text-sky-200/60">session</p>
                  </div>
                  <ArrowRight size={16} className="mt-1 text-sky-200/70 shrink-0" />
                </div>
                <p className="mt-2 text-[11px] text-sky-100/60">updated {new Date(session.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</p>
              </button>
            ))}
          </div>

          {selectableSessions.length === 0 && (
            <div className="mt-4 rounded-md border border-dashed border-sky-400/20 px-4 py-5 text-sm text-sky-100/60">
              No root chat sessions yet.
            </div>
          )}
        </section>

        {liveActivitySidebar}
      </div>
    </div>
  );
}

export function ExecutionGraphNoNodesState({
  activeSession,
  graphSurfaceClassName,
  liveActivitySidebar,
  disabled = false,
  error,
  onSendPrompt,
}: {
  activeSession: ChatSession | null;
  graphSurfaceClassName: string;
  liveActivitySidebar: ReactNode;
  disabled?: boolean;
  error?: string | null;
  onSendPrompt: (content: string) => void;
}) {
  return (
    <div className={graphSurfaceClassName}>
      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,760px)_auto]">
        <section className="w-full max-w-[760px] rounded-lg border border-sky-500/15 bg-[#101b2d]/92 p-4 text-sky-50 shadow-[0_18px_38px_rgba(2,12,27,0.28)]">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[10px] uppercase tracking-[0.22em] text-sky-200/65">Selected session</p>
              <h3 className="mt-1 truncate text-xl font-black tracking-tight">{activeSession?.title ?? 'New graph chat'}</h3>
            </div>
            <button
              type="button"
              className="tooltip tooltip-left inline-flex h-8 min-h-8 w-8 shrink-0 items-center justify-center rounded-md border border-sky-400/15 bg-sky-500/8 p-0 text-sky-100/60 hover:text-sky-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-300"
              data-tip="Send the first prompt here. Prompt, tool, subagent and final-answer nodes will appear once the session starts producing execution data."
              aria-label="Empty graph help"
            >
              <HelpCircle size={14} />
            </button>
          </div>
          <GraphPromptComposer
            key={activeSession?.id ?? 'empty-session'}
            disabled={disabled}
            error={error}
            onSendPrompt={onSendPrompt}
            placeholder="Ask Kalio from Graph view..."
          />
        </section>

        {liveActivitySidebar}
      </div>
    </div>
  );
}

function GraphPromptComposer({
  disabled,
  error,
  onSendPrompt,
  placeholder,
}: {
  disabled: boolean;
  error?: string | null;
  onSendPrompt: (content: string) => void;
  placeholder: string;
}) {
  const [prompt, setPrompt] = useState('');
  useEffect(() => {
    setPrompt('');
  }, [placeholder]);

  const submitPrompt = () => {
    const trimmed = prompt.trim();
    if (!trimmed || disabled) {
      return;
    }
    onSendPrompt(trimmed);
    setPrompt('');
  };

  return (
    <div className="mt-4 rounded-lg border border-sky-400/20 bg-[#0d1929]/90 p-2.5 shadow-inner" data-testid="graph-empty-composer">
      <textarea
        className="min-h-20 w-full resize-none rounded-md border border-sky-400/15 bg-[#081422] px-3.5 py-3 text-sm leading-6 text-sky-50 outline-none placeholder:text-sky-100/40 focus:border-sky-300/45"
        value={prompt}
        onChange={(event) => setPrompt(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            submitPrompt();
          }
        }}
        placeholder={placeholder}
        disabled={disabled}
        data-testid="graph-empty-prompt-input"
      />
      <div className="mt-2.5 flex items-center justify-end gap-3">
        <button
          type="button"
          className="btn btn-primary min-h-10 shrink-0 gap-2 px-4"
          onClick={submitPrompt}
          disabled={disabled || prompt.trim().length === 0}
          data-testid="graph-empty-send-prompt"
        >
          <Send size={14} />
          Send
        </button>
      </div>
      {error && (
        <p className="mt-2 rounded-md border border-error/30 bg-error/10 px-3 py-2 text-xs text-error-content" data-testid="graph-empty-send-error">
          {error}
        </p>
      )}
    </div>
  );
}
