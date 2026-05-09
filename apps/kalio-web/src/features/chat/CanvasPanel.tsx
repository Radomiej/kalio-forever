import { useState, useEffect, useRef } from 'react';
import {
  Wrench, CheckCircle2, XCircle, Clock, ChevronDown, ChevronRight,
  Loader2, BrainCircuit, ArrowLeftFromLine, ArrowRightToLine, Info, Terminal, MessageSquareText, FolderTree,
} from 'lucide-react';
import { useAgentStore, type ToolActivity } from '../../store/agentStore';
import { useSessionStore } from '../../store/sessionStore';
import { AGENT_LABELS } from './cli-agent-labels';
import { apiClient } from '../../services/apiClient';
import { eventBus } from '../../services/eventBus';
import type { ChatMessage, SubagentCopiedFile, SubagentToolResult } from '@kalio/types';

interface SubagentCanvasPreview {
  sessionId: string;
  label: string;
  title: string;
  copiedFiles: SubagentCopiedFile[];
  summary: string | null;
}

function extractSubagentResultFromMessage(message: ChatMessage): SubagentToolResult | null {
  if (message.role !== 'tool_result') return null;
  try {
    return extractSubagentResult(JSON.parse(message.content));
  } catch {
    return null;
  }
}

function extractSubagentResult(data: unknown): SubagentToolResult | null {
  if (!data || typeof data !== 'object') return null;
  const candidate = data as Record<string, unknown>;
  if (typeof candidate['childSessionId'] !== 'string' || typeof candidate['result'] !== 'string') return null;
  return candidate as unknown as SubagentToolResult;
}

function buildSubagentPreviews(messages: ChatMessage[], toolActivities: ToolActivity[], activeAgentLoops: Record<string, { sessionId: string; turnId: string; startedAt: number; agentRun?: ToolActivity['agentRun'] }>, sessions: ReturnType<typeof useSessionStore.getState>['sessions']): SubagentCanvasPreview[] {
  const previews = new Map<string, SubagentCanvasPreview>();

  Object.values(activeAgentLoops)
    .filter((loop) => loop.agentRun?.agentType === 'subagent')
    .forEach((loop) => {
      const session = sessions.find((item) => item.id === loop.sessionId);
      previews.set(loop.sessionId, {
        sessionId: loop.sessionId,
        label: loop.agentRun?.label ?? 'Sub-agent',
        title: session?.title ?? loop.agentRun?.label ?? 'Sub-agent',
        copiedFiles: [],
        summary: null,
      });
    });

  toolActivities
    .filter((activity) => activity.toolName === 'run_subagent' && activity.result?.status === 'success')
    .forEach((activity) => {
      const result = extractSubagentResult(activity.result?.data);
      if (!result) return;
      const session = sessions.find((item) => item.id === result.childSessionId);
      const existing = previews.get(result.childSessionId);
      previews.set(result.childSessionId, {
        sessionId: result.childSessionId,
        label: existing?.label ?? 'Sub-agent',
        title: session?.title ?? existing?.title ?? `Sub-agent ${result.childSessionId.slice(0, 8)}`,
        copiedFiles: result.copiedFiles,
        summary: result.result,
      });
    });

  messages
    .map(extractSubagentResultFromMessage)
    .filter((result): result is SubagentToolResult => result !== null)
    .forEach((result) => {
      const session = sessions.find((item) => item.id === result.childSessionId);
      const existing = previews.get(result.childSessionId);
      previews.set(result.childSessionId, {
        sessionId: result.childSessionId,
        label: existing?.label ?? 'Sub-agent',
        title: session?.title ?? existing?.title ?? `Sub-agent ${result.childSessionId.slice(0, 8)}`,
        copiedFiles: existing?.copiedFiles.length ? existing.copiedFiles : result.copiedFiles,
        summary: existing?.summary ?? result.result,
      });
    });

  return [...previews.values()];
}

function mergeFetchedMessages(currentMessages: ChatMessage[], loadedMessages: ChatMessage[]): ChatMessage[] {
  const merged = new Map<string, ChatMessage>();

  loadedMessages.forEach((message) => {
    merged.set(message.id, message);
  });

  currentMessages.forEach((message) => {
    const existing = merged.get(message.id);
    if (!existing) {
      merged.set(message.id, message);
      return;
    }

    merged.set(message.id, {
      ...existing,
      ...message,
      content: message.content || existing.content,
      thinking: message.thinking ?? existing.thinking,
      streaming: message.streaming ?? existing.streaming,
      toolCallId: message.toolCallId ?? existing.toolCallId,
    });
  });

  return [...merged.values()].sort((left, right) => left.createdAt - right.createdAt);
}

function SubagentConversationCard({
  preview,
  transcript,
  onOpen,
}: {
  preview: SubagentCanvasPreview;
  transcript: ChatMessage[];
  onOpen: () => void;
}) {
  const visibleMessages = transcript
    .filter((message) => message.role === 'user' || message.role === 'assistant')
    .slice(-2);

  return (
    <div className="border border-sky-500/20 bg-sky-500/5 rounded-xl px-3 py-2.5 text-xs space-y-2">
      <div className="flex items-start gap-2">
        <BrainCircuit size={12} className="text-sky-400 mt-0.5 shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="text-sky-300 truncate">{preview.label}</p>
          <p className="text-base-content/50 truncate">{preview.title}</p>
        </div>
        <button
          className="btn btn-ghost btn-xs"
          onClick={onOpen}
          aria-label="Open sub-agent chat"
        >
          Open
        </button>
      </div>

      {visibleMessages.length > 0 && (
        <div>
          <p className="text-[10px] uppercase tracking-wide text-base-content/40 mb-1 flex items-center gap-1">
            <MessageSquareText size={10} />
            Chat
          </p>
          <div className="space-y-1">
            {visibleMessages.map((message) => (
              <div key={message.id} className="rounded bg-base-200/60 px-2 py-1">
                <span className="text-base-content/35 mr-1">{message.role === 'user' ? 'User:' : 'Agent:'}</span>
                <span className="text-base-content/70 whitespace-pre-wrap break-words">{message.content}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {!visibleMessages.length && preview.summary && (
        <div className="rounded bg-base-200/60 px-2 py-1 text-base-content/70 whitespace-pre-wrap break-words">
          {preview.summary}
        </div>
      )}

      {preview.copiedFiles.length > 0 && (
        <div>
          <p className="text-[10px] uppercase tracking-wide text-base-content/40 mb-1 flex items-center gap-1">
            <FolderTree size={10} />
            VFS outputs
          </p>
          <div className="space-y-1">
            {preview.copiedFiles.map((file) => (
              <div key={file.toPath} className="rounded bg-base-200/60 px-2 py-1 font-mono text-[11px] text-base-content/55 break-all">
                {file.toPath}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/** Live terminal block rendered inside ToolCard while run_cli_agent is in progress. */
function CLIAgentLiveSection({ callId, agentId }: { callId: string; agentId: string }) {
  const output = useAgentStore((s) => s.cliAgentOutput[callId] ?? '');
  const scrollRef = useRef<HTMLPreElement>(null);

  // Auto-scroll to bottom as new chunks arrive — mirrors CanvasDrawer.streamingBuffer pattern
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [output]);

  return (
    <div>
      <p className="text-base-content/40 uppercase tracking-wide text-[10px] mb-1 flex items-center gap-1">
        <Terminal size={9} />
        {AGENT_LABELS[agentId] ?? agentId}
      </p>
      <pre
        ref={scrollRef}
        className="text-[11px] text-success/80 bg-neutral/80 rounded px-2 py-1.5 max-h-60 overflow-y-auto whitespace-pre-wrap break-words leading-relaxed"
      >
        {output || <span className="opacity-40 text-base-content">Waiting for output…</span>}
      </pre>
    </div>
  );
}

/** Terminal-styled result block for a completed run_cli_agent call. */
function CLIAgentResult({ data }: { data: unknown }) {
  const d = data as Record<string, unknown>;
  const output = typeof d?.['output'] === 'string' ? d['output'] : JSON.stringify(data, null, 2);
  const exitCode = typeof d?.['exitCode'] === 'number' ? d['exitCode'] : null;
  const success = exitCode === null || exitCode === 0;

  return (
    <div>
      {exitCode !== null && (
        <p className={`text-[10px] mb-1 font-mono ${success ? 'text-success' : 'text-error'}`}>
          exit {exitCode}
        </p>
      )}
      <pre className="text-[11px] text-base-content/70 bg-neutral/60 rounded px-2 py-1.5 max-h-60 overflow-y-auto whitespace-pre-wrap break-words leading-relaxed">
        {output}
      </pre>
    </div>
  );
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
  const isCliAgent = activity.toolName === 'run_cli_agent';
  // Auto-expand CLI agent cards so streaming output is immediately visible
  const [open, setOpen] = useState(isCliAgent);
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
          {/* CLI agent live output while running */}
          {isCliAgent && activity.status === 'running' && (
            <CLIAgentLiveSection
              callId={activity.callId}
              agentId={typeof activity.args['agentId'] === 'string' ? activity.args['agentId'] : 'copilot'}
            />
          )}
          {/* Result */}
          {activity.result && (
            <div>
              <p className="text-base-content/40 uppercase tracking-wide text-[10px] mb-1">Result</p>
              {isCliAgent && activity.result.status === 'success' ? (
                <CLIAgentResult data={activity.result.data} />
              ) : (
                <pre className="text-[11px] text-base-content/70 overflow-x-auto whitespace-pre-wrap break-all">
                  {activity.result.status === 'success'
                    ? JSON.stringify(activity.result.data, null, 2)
                    : activity.result.errorMessage ?? activity.result.errorCode}
                </pre>
              )}
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

export function CanvasPanel() {
  const { toolActivities, isStreaming, canvasOpen, toggleCanvas, activeAgentLoops } = useAgentStore();
  const { messages, activeSessionId, sessions, setActiveSession, getSessionMessages, setMessages } = useSessionStore();
  const [hydratedSubagentSessions, setHydratedSubagentSessions] = useState<Record<string, true>>({});
  const open = canvasOpen;
  const subagentLoops = Object.values(activeAgentLoops).filter((loop) => loop.agentRun?.agentType === 'subagent');
  const masterActivities = toolActivities.filter((activity) => activity.agentRun?.agentType !== 'subagent');
  const subagentActivities = toolActivities.filter((activity) => activity.agentRun?.agentType === 'subagent');
  const subagentPreviews = buildSubagentPreviews(messages, toolActivities, activeAgentLoops, sessions);
  // Show toggle only when agent has activity or canvas is already open
  const showToggle = isStreaming || toolActivities.length > 0 || subagentLoops.length > 0 || subagentPreviews.length > 0 || open;

  useEffect(() => {
    if (!eventBus.connected) return;
    subagentPreviews.forEach((preview) => {
      if (preview.sessionId !== activeSessionId) {
        eventBus.identifySession(preview.sessionId);
      }
    });
  }, [activeSessionId, subagentPreviews]);

  useEffect(() => {
    let cancelled = false;
    const missingSessionIds = subagentPreviews
      .map((preview) => preview.sessionId)
      .filter((sessionId) => !hydratedSubagentSessions[sessionId] && sessionId !== activeSessionId);

    if (missingSessionIds.length === 0) return;

    void Promise.all(
      missingSessionIds.map(async (sessionId) => {
        const response = await apiClient.get<ChatMessage[]>(`/api/sessions/${sessionId}/messages`);
        return [sessionId, response.data] as const;
      }),
    )
      .then((results) => {
        if (cancelled) return;
        results.forEach(([sessionId, loadedMessages]) => {
          const currentMessages = getSessionMessages(sessionId);
          setMessages(mergeFetchedMessages(currentMessages, loadedMessages), sessionId);
        });
        setHydratedSubagentSessions((current) => {
          const next = { ...current };
          results.forEach(([sessionId]) => {
            next[sessionId] = true;
          });
          return next;
        });
      })
      .catch((err: unknown) => {
        console.error('[CanvasPanel] failed to load subagent transcript', err instanceof Error ? err : new Error(String(err)));
      });

    return () => {
      cancelled = true;
    };
  }, [activeSessionId, getSessionMessages, hydratedSubagentSessions, setMessages, subagentPreviews]);

  return (
    <>
      {/* Toggle tab — only visible when agent is active or canvas is open */}
      {showToggle && (
        <button
          className="absolute right-0 top-1/2 -translate-y-1/2 z-20 flex items-center justify-center w-5 h-12 bg-base-200 border border-base-300 rounded-l-lg hover:bg-base-300 transition-colors"
          onClick={toggleCanvas}
          aria-label={open ? 'Close canvas' : 'Open canvas'}
          data-testid="canvas-toggle"
        >
          {open ? <ArrowRightToLine size={12} /> : <ArrowLeftFromLine size={12} />}
        </button>
      )}

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
            {subagentPreviews.length > 0 && (
              <section>
                <p className="text-[10px] uppercase tracking-wide text-base-content/40 mb-2">Sub-agents</p>
                <div className="space-y-1.5">
                  {subagentPreviews.map((preview) => (
                    <SubagentConversationCard
                      key={preview.sessionId}
                      preview={preview}
                      transcript={getSessionMessages(preview.sessionId)}
                      onOpen={() => setActiveSession(preview.sessionId)}
                    />
                  ))}
                </div>
              </section>
            )}

            {subagentActivities.length > 0 && (
              <section>
                <p className="text-[10px] uppercase tracking-wide text-base-content/40 mb-2">
                  Sub-agent tools ({subagentActivities.length})
                </p>
                <div className="space-y-1.5">
                  {subagentActivities.map((a) => (
                    <ToolCard key={a.callId} activity={a} />
                  ))}
                </div>
              </section>
            )}

            {masterActivities.length > 0 && (
              <section>
                <p className="text-[10px] uppercase tracking-wide text-base-content/40 mb-2">
                  Tools ({masterActivities.length})
                </p>
                <div className="space-y-1.5">
                  {masterActivities.map((a) => (
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
