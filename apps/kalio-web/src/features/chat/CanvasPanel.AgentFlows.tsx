import { BrainCircuit, Loader2 } from 'lucide-react';
import type { ChatMessage, ChatSession, RuntimeChildExecution, SubAgentFlowResult } from '@kalio/types';
import type { ToolActivity } from '../../store/agentStore';
import { SubAgentFlowResultBlock } from './ToolCallBubble.ResultBlocks';
import { extractSubAgentFlowResult } from './ToolCallBubble.parsers';

export interface AgentFlowCanvasPreview {
  flowRunId: string;
  sessionId: string;
  graphRunId: string;
  title: string;
  result: SubAgentFlowResult | null;
  status: RuntimeChildExecution['status'] | 'completed';
  label: string;
  updatedAt: number;
}

function resultFromMessage(message: ChatMessage): SubAgentFlowResult | null {
  if (message.role !== 'tool_result') return null;
  try {
    return extractSubAgentFlowResult(JSON.parse(message.content));
  } catch {
    return null;
  }
}

function previewFromResult(result: SubAgentFlowResult, sessions: ChatSession[]): AgentFlowCanvasPreview | null {
  const sessionId = result.openChatSessionId ?? result.childSessionId;
  const graphRunId = result.openGraphRunId ?? result.flowRunId;
  const session = sessions.find((item) => item.id === sessionId);
  if (!session) {
    return null;
  }
  return {
    flowRunId: result.flowRunId,
    sessionId,
    graphRunId,
    title: session.title,
    result,
    status: 'completed',
    label: 'AgentFlow',
    updatedAt: session.updatedAt,
  };
}

export function buildAgentFlowPreviews(
  messages: ChatMessage[],
  toolActivities: ToolActivity[],
  sessions: ChatSession[],
  childExecutions: RuntimeChildExecution[] = [],
): AgentFlowCanvasPreview[] {
  const previews = new Map<string, AgentFlowCanvasPreview>();

  messages
    .map(resultFromMessage)
    .filter((result): result is SubAgentFlowResult => result !== null)
    .forEach((result) => {
      const preview = previewFromResult(result, sessions);
      if (!preview) return;
      previews.set(result.flowRunId, preview);
    });

  toolActivities
    .filter((activity) => activity.toolName === 'run_sub_agentflow' && activity.result?.status === 'success')
    .map((activity) => extractSubAgentFlowResult(activity.result?.data))
    .filter((result): result is SubAgentFlowResult => result !== null)
    .forEach((result) => {
      const preview = previewFromResult(result, sessions);
      if (!preview) return;
      previews.set(result.flowRunId, preview);
    });

  childExecutions
    .filter((execution) => execution.kind === 'agent_flow' && execution.flowRunId)
    .forEach((execution) => {
      const session = sessions.find((item) => item.id === execution.childSessionId);
      if (!session) {
        return;
      }
      previews.set(execution.flowRunId!, {
        flowRunId: execution.flowRunId!,
        sessionId: execution.childSessionId,
        graphRunId: execution.flowRunId!,
        title: session.title,
        result: previews.get(execution.flowRunId!)?.result ?? null,
        status: execution.status,
        label: execution.label ?? 'AgentFlow',
        updatedAt: execution.updatedAt,
      });
    });

  return [...previews.values()].sort((left, right) => right.updatedAt - left.updatedAt);
}

export function AgentFlowConversationCard({
  preview,
  onOpenChat,
  onOpenGraph,
}: {
  preview: AgentFlowCanvasPreview;
  onOpenChat: () => void;
  onOpenGraph: () => void;
}) {
  return (
    <div
      className="border border-violet-500/20 bg-violet-500/5 rounded-xl px-3 py-2.5 text-xs space-y-2"
      data-testid={`canvas-agentflow-card-${preview.flowRunId}`}
      data-session-id={preview.sessionId}
    >
      <div className="flex items-start gap-2">
        <BrainCircuit size={12} className="text-violet-300 mt-0.5 shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="text-violet-200 truncate">{preview.label}</p>
          <p className="text-base-content/55 truncate">{preview.title}</p>
        </div>
        <span
          className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 font-mono text-[10px] ${
            preview.status === 'running' || preview.status === 'waiting'
              ? 'border-info/30 bg-info/10 text-info'
              : preview.status === 'failed' || preview.status === 'blocked' || preview.status === 'cancelled'
                ? 'border-error/30 bg-error/10 text-error'
                : 'border-success/25 bg-success/10 text-success'
          }`}
        >
          {(preview.status === 'running' || preview.status === 'waiting') && <Loader2 size={10} className="animate-spin" />}
          {preview.status}
        </span>
        <button
          className="btn btn-ghost btn-xs"
          onClick={onOpenChat}
          aria-label="Open AgentFlow chat"
          data-testid={`canvas-open-agentflow-chat-${preview.flowRunId}`}
        >
          Chat
        </button>
        <button
          className="btn btn-ghost btn-xs"
          onClick={onOpenGraph}
          aria-label="Open AgentFlow graph"
          data-testid={`canvas-open-agentflow-graph-${preview.flowRunId}`}
        >
          Graph
        </button>
      </div>
      {preview.result && <SubAgentFlowResultBlock result={preview.result} />}
    </div>
  );
}
