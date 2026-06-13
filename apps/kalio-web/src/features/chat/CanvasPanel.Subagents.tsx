import { BrainCircuit, FolderTree, Loader2, MessageSquareText } from 'lucide-react';
import type { ChatMessage, ChatSession, SubagentCopiedFile, SubagentToolResult } from '@kalio/types';
import type { ToolActivity } from '../../store/agentStore';
import { compactArchitectureTraceContent } from './architectureChatSummary';

export interface SubagentCanvasPreview {
  sessionId: string;
  label: string;
  title: string;
  copiedFiles: SubagentCopiedFile[];
  summary: string | null;
  status: 'idle' | 'running' | 'success' | 'error';
  startedAt?: number;
}

type ActiveAgentLoop = {
  sessionId: string;
  turnId: string;
  startedAt?: number;
  agentRun?: ToolActivity['agentRun'];
};

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

function recordValue(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function failedSubagentSessionId(activity: ToolActivity): string | null {
  const data = recordValue(activity.result?.data);
  if (typeof data?.['childSessionId'] === 'string') {
    return data['childSessionId'];
  }
  if (typeof activity.result?.agentRun?.vfsSessionId === 'string') {
    return activity.result.agentRun.vfsSessionId;
  }
  if (typeof activity.agentRun?.vfsSessionId === 'string') {
    return activity.agentRun.vfsSessionId;
  }
  return null;
}

function failedSubagentSummary(activity: ToolActivity): string {
  const data = recordValue(activity.result?.data);
  const dataSummary = typeof data?.['result'] === 'string'
    ? data['result']
    : typeof data?.['message'] === 'string'
      ? data['message']
      : null;
  return compactPreviewText(
    activity.result?.errorMessage
      ?? dataSummary
      ?? 'Sub-agent branch failed before producing a final answer.',
  );
}

function titleFromSessionId(sessionId: string): string {
  const role = sessionId.split('-').at(-1);
  if (!role || role.length < 3) {
    return 'Sub-agent';
  }

  return role
    .split(/[_-]/)
    .filter(Boolean)
    .map((part) => `${part[0]?.toUpperCase() ?? ''}${part.slice(1)}`)
    .join(' ');
}

function compactPreviewText(content: string): string {
  return compactArchitectureTraceContent(content, 'participant');
}

export function buildSubagentPreviews(
  messages: ChatMessage[],
  toolActivities: ToolActivity[],
  activeAgentLoops: Record<string, ActiveAgentLoop>,
  sessions: ChatSession[],
): SubagentCanvasPreview[] {
  const previews = new Map<string, SubagentCanvasPreview>();
  const sessionsById = new Map(sessions.map((session) => [session.id, session]));
  const sessionUpdatedAt = new Map(sessions.map((session) => [session.id, session.updatedAt]));

  Object.values(activeAgentLoops)
    .filter((loop) => loop.agentRun?.agentType === 'subagent')
    .forEach((loop) => {
      const session = sessionsById.get(loop.sessionId);
      if (!session) return;
      previews.set(loop.sessionId, {
        sessionId: loop.sessionId,
        label: loop.agentRun?.label ?? 'Sub-agent',
        title: session.title,
        copiedFiles: [],
        summary: null,
        status: 'running',
        startedAt: loop.startedAt,
      });
    });

  toolActivities
    .filter((activity) => activity.toolName === 'run_subagent' && activity.result?.status === 'success')
    .forEach((activity) => {
      const result = extractSubagentResult(activity.result?.data);
      if (!result) return;
      const session = sessionsById.get(result.childSessionId);
      if (!session) return;
      const existing = previews.get(result.childSessionId);
      const fallbackLabel = titleFromSessionId(result.childSessionId);
      previews.set(result.childSessionId, {
        sessionId: result.childSessionId,
        label: existing?.label ?? fallbackLabel,
        title: session.title,
        copiedFiles: result.copiedFiles,
        summary: compactPreviewText(result.result),
        status: existing?.status === 'running' ? 'running' : 'success',
        startedAt: existing?.startedAt,
      });
    });

  toolActivities
    .filter((activity) => activity.toolName === 'run_subagent' && activity.result?.status === 'error')
    .forEach((activity) => {
      const childSessionId = failedSubagentSessionId(activity);
      if (!childSessionId) return;
      const session = sessionsById.get(childSessionId);
      if (!session) return;
      const existing = previews.get(childSessionId);
      const fallbackLabel = titleFromSessionId(childSessionId);
      previews.set(childSessionId, {
        sessionId: childSessionId,
        label: existing?.label ?? activity.agentRun?.label ?? activity.result?.agentRun?.label ?? fallbackLabel,
        title: session.title,
        copiedFiles: existing?.copiedFiles ?? [],
        summary: failedSubagentSummary(activity),
        status: 'error',
        startedAt: existing?.startedAt ?? activity.startedAt,
      });
    });

  messages
    .map(extractSubagentResultFromMessage)
    .filter((result): result is SubagentToolResult => result !== null)
    .forEach((result) => {
      const session = sessionsById.get(result.childSessionId);
      if (!session) return;
      const existing = previews.get(result.childSessionId);
      const fallbackLabel = titleFromSessionId(result.childSessionId);
      previews.set(result.childSessionId, {
        sessionId: result.childSessionId,
        label: existing?.label ?? fallbackLabel,
        title: session.title,
        copiedFiles: existing?.copiedFiles.length ? existing.copiedFiles : result.copiedFiles,
        summary: existing?.summary ?? compactPreviewText(result.result),
        status: existing?.status ?? 'success',
        startedAt: existing?.startedAt,
      });
    });

  return [...previews.values()].sort(
    (left, right) => (sessionUpdatedAt.get(left.sessionId) ?? 0) - (sessionUpdatedAt.get(right.sessionId) ?? 0),
  );
}

export function SubagentConversationCard({
  preview,
  transcript,
  onOpen,
}: {
  preview: SubagentCanvasPreview;
  transcript: ChatMessage[];
  onOpen: () => void;
}) {
  const visibleMessages = transcript
    .filter((message) => message.role === 'assistant')
    .slice()
    .sort((left, right) => left.createdAt - right.createdAt)
    .slice(-2);

  return (
    <div
      className="border border-sky-500/20 bg-sky-500/5 rounded-xl px-3 py-2.5 text-xs space-y-2"
      data-testid={`canvas-subagent-card-${preview.sessionId}`}
      data-session-id={preview.sessionId}
    >
      <div className="flex items-start gap-2">
        <BrainCircuit size={12} className="text-sky-400 mt-0.5 shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="text-sky-300 truncate">{preview.label}</p>
          <p className="text-base-content/50 truncate">{preview.title}</p>
        </div>
        <span
          data-testid={`canvas-subagent-status-${preview.sessionId}`}
          className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 font-mono text-[10px] ${
            preview.status === 'running'
              ? 'border-info/30 bg-info/10 text-info'
              : preview.status === 'error'
                ? 'border-error/30 bg-error/10 text-error'
                : 'border-success/25 bg-success/10 text-success'
          }`}
        >
          {preview.status === 'running' && <Loader2 size={10} className="animate-spin" />}
          {preview.status}
        </span>
        <button
          className="btn btn-ghost btn-xs"
          onClick={onOpen}
          aria-label="Open sub-agent chat"
          data-testid={`canvas-open-subagent-${preview.sessionId}`}
          data-session-id={preview.sessionId}
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
                <span className="text-base-content/35 mr-1">Agent:</span>
                <span className="text-base-content/70 whitespace-pre-wrap break-words">{compactPreviewText(message.content)}</span>
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
