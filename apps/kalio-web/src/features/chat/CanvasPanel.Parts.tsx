import { useEffect, useRef, useState } from 'react';
import {
  BrainCircuit, CheckCircle2, ChevronDown, ChevronRight, Clock, Loader2, Terminal, Wrench, XCircle,
} from 'lucide-react';
import type { ChatMessage } from '@kalio/types';
import { useAgentStore, type ToolActivity } from '../../store/agentStore';
import { useSessionStore } from '../../store/sessionStore';
import { AGENT_LABELS } from './cli-agent-labels';
import { ImageResultRenderer, type ImageResultData } from './ImageResultRenderer';
import { extractSubAgentFlowResult } from './ToolCallBubble.parsers';
import { getToolTargetLabel } from './toolTargetLabel';

function CLIAgentLiveSection({ callId, agentId }: { callId: string; agentId: string }) {
  const output = useAgentStore((s) => s.cliAgentOutput[callId] ?? '');
  const scrollRef = useRef<HTMLPreElement>(null);

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
        {output || <span className="opacity-40 text-base-content">Waiting for outputâ€¦</span>}
      </pre>
    </div>
  );
}

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

function extractImageResult(data: unknown): ImageResultData | null {
  if (!data || typeof data !== 'object') return null;
  const candidate = data as Record<string, unknown>;
  if (candidate['output_type'] !== 'image' || typeof candidate['image_url'] !== 'string') {
    return null;
  }

  return candidate as unknown as ImageResultData;
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

export function ToolCard({ activity }: { activity: ToolActivity }) {
  const isCliAgent = activity.toolName === 'run_cli_agent';
  const imageResult = activity.result?.status === 'success' ? extractImageResult(activity.result.data) : null;
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
        {getToolTargetLabel(activity.toolName, activity.args) && (
          <span
            data-testid="tool-call-target"
            className="max-w-28 shrink truncate text-left font-mono text-[10px] text-base-content/40"
            title={getToolTargetLabel(activity.toolName, activity.args) ?? undefined}
          >
            {getToolTargetLabel(activity.toolName, activity.args)}
          </span>
        )}
        {duration && <span className="text-base-content/40 shrink-0">{duration}</span>}
        <StatusIcon status={activity.status} />
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
      </button>

      {open && (
        <div className="px-3 py-2 space-y-2 bg-base-100">
          <div>
            <p className="text-base-content/40 uppercase tracking-wide text-[10px] mb-1">Args</p>
            <pre className="text-[11px] text-base-content/70 overflow-x-auto whitespace-pre-wrap break-all">
              {JSON.stringify(activity.args, null, 2)}
            </pre>
          </div>
          {isCliAgent && activity.status === 'running' && (
            <CLIAgentLiveSection
              callId={activity.callId}
              agentId={typeof activity.args['agentId'] === 'string' ? activity.args['agentId'] : 'copilot'}
            />
          )}
          {activity.result && (
            <div>
              <p className="text-base-content/40 uppercase tracking-wide text-[10px] mb-1">Result</p>
              {isCliAgent && activity.result.status === 'success' ? (
                <CLIAgentResult data={activity.result.data} />
              ) : imageResult ? (
                <ImageResultRenderer data={imageResult} />
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

export function ThinkingPreview() {
  const { thinkingChunks, messages, streamingChunks } = useSessionStore();
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

export function SessionStats() {
  const { messages, activeSessionId } = useSessionStore();
  const msgCount = messages.length;
  const userCount = messages.filter((m) => m.role === 'user').length;
  const assistantCount = messages.filter((m) => m.role === 'assistant').length;
  const totalChars = messages
    .filter((message) => message.role === 'user' || message.role === 'assistant')
    .reduce((sum, message) => sum + message.content.length, 0);
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
        <span className={`font-mono ${estimatedTokens > 50000 ? 'text-error' : estimatedTokens > 25000 ? 'text-warning' : ''}`}>
          {estimatedTokens.toLocaleString()}
        </span>
      </div>
    </div>
  );
}

export function findFocusedSubAgentFlowResult(messages: ChatMessage[], runId: string | undefined) {
  if (!runId) return null;
  for (const message of [...messages].reverse()) {
    if (message.role !== 'tool_result') continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(message.content);
    } catch {
      continue;
    }
    const result = extractSubAgentFlowResult(parsed);
    if (!result) continue;
    const graphRunId = result.openGraphRunId ?? result.flowRunId;
    if (graphRunId === runId) {
      return result;
    }
  }
  return null;
}
