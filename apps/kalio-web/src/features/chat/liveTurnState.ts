import type { ChatMessage } from '@kalio/types';
import type { ToolActivity } from '../../store/agentStore';
import type { AgentTurn } from '../../store/sessionStore';

export type LiveTurnPhase =
  | 'idle'
  | 'pending'
  | 'thinking'
  | 'streaming_text'
  | 'running_tool'
  | 'queued_followup'
  | 'completed'
  | 'stopped'
  | 'failed';

export interface LiveTurnState {
  sessionId: string | null;
  phase: LiveTurnPhase;
  stoppable: boolean;
  previewText: string | null;
  toolName: string | null;
  queuedDepth: number;
  showPlaceholderBubble: boolean;
  workflowActive: boolean;
}

interface ResolveLiveTurnStateArgs {
  sessionId: string | null;
  sessionMessages: ChatMessage[];
  agentTurns: AgentTurn[];
  activeTurnId: string | null;
  isStreaming: boolean;
  streamingSessionId: string | null;
  awaitingFirstChunk: boolean;
  hasActiveLoop: boolean;
  queuedDepth: number;
  activeToolActivities: ToolActivity[];
  streamingChunks: Record<string, string>;
  thinkingChunks: Record<string, string>;
  chunkSessionIds: Record<string, string>;
}

function sessionChunkIds(
  sessionId: string,
  chunkSessionIds: Record<string, string>,
  chunks: Record<string, string>,
): string[] {
  return Object.keys(chunks).filter((messageId) => chunkSessionIds[messageId] === sessionId);
}

function latestChunkPreview(
  sessionMessages: ChatMessage[],
  chunkIds: string[],
  chunks: Record<string, string>,
): string | null {
  if (chunkIds.length === 0) {
    return null;
  }

  const orderedIds = new Set(chunkIds);
  for (let index = sessionMessages.length - 1; index >= 0; index -= 1) {
    const messageId = sessionMessages[index]?.id;
    if (messageId && orderedIds.has(messageId)) {
      return chunks[messageId] ?? null;
    }
  }

  const fallbackId = chunkIds[chunkIds.length - 1];
  return chunks[fallbackId] ?? null;
}

function hasMaterializedIncompleteTurn(
  agentTurns: AgentTurn[],
  sessionMessages: ChatMessage[],
): boolean {
  const messageById = new Map(sessionMessages.map((message) => [message.id, message] as const));

  return agentTurns.some((turn) => (
    !turn.done
    && turn.items.some((item) => {
      if (item.kind === 'tool') {
        return false;
      }

      const message = messageById.get(item.messageId);
      if (!message) {
        return item.kind === 'thinking';
      }

      return item.kind === 'thinking'
        || item.kind === 'text';
    })
  ));
}

function hasActiveWorkflowEnvelopeTurn(agentTurns: AgentTurn[]): boolean {
  return agentTurns.some((turn) => turn.turnKind === 'workflow-envelope' && !turn.done);
}

export function resolveLiveTurnState({
  sessionId,
  sessionMessages,
  agentTurns,
  activeTurnId: _activeTurnId,
  isStreaming,
  streamingSessionId,
  awaitingFirstChunk,
  hasActiveLoop,
  queuedDepth,
  activeToolActivities,
  streamingChunks,
  thinkingChunks,
  chunkSessionIds,
}: ResolveLiveTurnStateArgs): LiveTurnState {
  if (!sessionId) {
    return {
      sessionId: null,
      phase: 'idle',
      stoppable: false,
    previewText: null,
    toolName: null,
    queuedDepth: 0,
    showPlaceholderBubble: false,
    workflowActive: false,
  };
}

  const streamingMessageIds = sessionChunkIds(sessionId, chunkSessionIds, streamingChunks);
  const thinkingMessageIds = sessionChunkIds(sessionId, chunkSessionIds, thinkingChunks);
  const latestStreamingPreview = latestChunkPreview(sessionMessages, streamingMessageIds, streamingChunks);
  const latestThinkingPreview = latestChunkPreview(sessionMessages, thinkingMessageIds, thinkingChunks);
  const runningTool = [...activeToolActivities].reverse().find((activity) => (
    activity.status === 'running' || activity.status === 'awaiting_confirmation'
  )) ?? null;
  const workflowActive = hasActiveWorkflowEnvelopeTurn(agentTurns);
  const isStreamingForSession = isStreaming && (!streamingSessionId || streamingSessionId === sessionId);
  const liveSignal = (
    awaitingFirstChunk
    || hasActiveLoop
    || isStreamingForSession
    || queuedDepth > 0
    || runningTool !== null
    || latestStreamingPreview !== null
    || latestThinkingPreview !== null
    || workflowActive
  );

  if (!liveSignal) {
    return {
      sessionId,
      phase: 'idle',
      stoppable: false,
      previewText: null,
      toolName: null,
      queuedDepth,
      showPlaceholderBubble: false,
      workflowActive: false,
    };
  }

  const phase: LiveTurnPhase = runningTool
    ? 'running_tool'
    : latestStreamingPreview
      ? 'streaming_text'
      : latestThinkingPreview
        ? 'thinking'
        : queuedDepth > 0
          ? 'queued_followup'
          : 'pending';

  return {
    sessionId,
    phase,
    stoppable: true,
    previewText: latestStreamingPreview ?? latestThinkingPreview,
    toolName: runningTool?.toolName ?? null,
    queuedDepth,
    showPlaceholderBubble: workflowActive || !hasMaterializedIncompleteTurn(agentTurns, sessionMessages),
    workflowActive,
  };
}
