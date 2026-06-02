import { BrainCircuit } from 'lucide-react';
import type { ChatMessage, ChatSession, SubAgentFlowResult } from '@kalio/types';
import type { ToolActivity } from '../../store/agentStore';
import { SubAgentFlowResultBlock } from './ToolCallBubble.ResultBlocks';
import { extractSubAgentFlowResult } from './ToolCallBubble.parsers';

export interface AgentFlowCanvasPreview {
  flowRunId: string;
  sessionId: string;
  graphRunId: string;
  title: string;
  result: SubAgentFlowResult;
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

function previewFromResult(result: SubAgentFlowResult, sessions: ChatSession[]): AgentFlowCanvasPreview {
  const sessionId = result.openChatSessionId ?? result.childSessionId;
  const graphRunId = result.openGraphRunId ?? result.flowRunId;
  const session = sessions.find((item) => item.id === sessionId);
  return {
    flowRunId: result.flowRunId,
    sessionId,
    graphRunId,
    title: session?.title ?? `AgentFlow ${result.flowRunId}`,
    result,
    updatedAt: session?.updatedAt ?? 0,
  };
}

export function buildAgentFlowPreviews(
  messages: ChatMessage[],
  toolActivities: ToolActivity[],
  sessions: ChatSession[],
): AgentFlowCanvasPreview[] {
  const previews = new Map<string, AgentFlowCanvasPreview>();

  messages
    .map(resultFromMessage)
    .filter((result): result is SubAgentFlowResult => result !== null)
    .forEach((result) => {
      previews.set(result.flowRunId, previewFromResult(result, sessions));
    });

  toolActivities
    .filter((activity) => activity.toolName === 'run_sub_agentflow' && activity.result?.status === 'success')
    .map((activity) => extractSubAgentFlowResult(activity.result?.data))
    .filter((result): result is SubAgentFlowResult => result !== null)
    .forEach((result) => {
      previews.set(result.flowRunId, previewFromResult(result, sessions));
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
          <p className="text-violet-200 truncate">AgentFlow</p>
          <p className="text-base-content/55 truncate">{preview.title}</p>
        </div>
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
      <SubAgentFlowResultBlock result={preview.result} />
    </div>
  );
}
