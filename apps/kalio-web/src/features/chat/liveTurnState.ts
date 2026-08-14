import type { ArchitectureRunStatus, ChatMessage } from '@kalio/types';
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

function isTerminalArchitectureRunStatus(status: ArchitectureRunStatus | undefined): boolean {
  return status === 'completed' || status === 'failed' || status === 'cancelled';
}

function workflowEnvelopeTurnHasTerminalProjection(
  turn: AgentTurn,
  messageById: Map<string, ChatMessage>,
): boolean {
  return turn.items.some((item) => {
    if (item.kind === 'tool') {
      return false;
    }

    const message = messageById.get(item.messageId);
    return isTerminalArchitectureRunStatus(message?.architectureRun?.status);
  });
}

function findActiveOrLatestIncompleteTurn(
  agentTurns: AgentTurn[],
  activeTurnId: string | null,
): AgentTurn | null {
  if (activeTurnId) {
    const activeTurn = agentTurns.find((turn) => turn.id === activeTurnId);
    if (activeTurn) {
      return activeTurn;
    }
  }

  for (let index = agentTurns.length - 1; index >= 0; index -= 1) {
    const turn = agentTurns[index];
    if (turn && !turn.done) {
      return turn;
    }
  }

  return null;
}

function hasTerminalWorkflowEnvelopeLiveTurn(
  agentTurns: AgentTurn[],
  sessionMessages: ChatMessage[],
  activeTurnId: string | null,
): boolean {
  const turn = findActiveOrLatestIncompleteTurn(agentTurns, activeTurnId);
  if (!turn || turn.done || turn.turnKind !== 'workflow-envelope') {
    return false;
  }

  const messageById = new Map(sessionMessages.map((message) => [message.id, message] as const));
  const promptMessageId = turn.promptMessageId;
  return workflowEnvelopeTurnHasTerminalProjection(turn, messageById)
    || (
      typeof promptMessageId === 'string'
      && terminalWorkflowPromptIds(agentTurns, messageById).has(promptMessageId)
    );
}

function hasActiveWorkflowEnvelopeTurn(
  agentTurns: AgentTurn[],
  sessionMessages: ChatMessage[],
): boolean {
  const messageById = new Map(sessionMessages.map((message) => [message.id, message] as const));
  const terminalPromptIds = terminalWorkflowPromptIds(agentTurns, messageById);

  return agentTurns.some((turn) => (
    turn.turnKind === 'workflow-envelope'
    && !turn.done
    && (!turn.promptMessageId || !terminalPromptIds.has(turn.promptMessageId))
    && !workflowEnvelopeTurnHasTerminalProjection(turn, messageById)
  ));
}

function terminalWorkflowPromptIds(
  agentTurns: AgentTurn[],
  messageById: Map<string, ChatMessage>,
): Set<string> {
  const promptIds = new Set<string>();
  for (const turn of agentTurns) {
    if (
      turn.turnKind === 'workflow-envelope'
      && turn.promptMessageId
      && workflowEnvelopeTurnHasTerminalProjection(turn, messageById)
    ) {
      promptIds.add(turn.promptMessageId);
    }
  }
  return promptIds;
}

export function resolveLiveTurnState({
  sessionId,
  sessionMessages,
  agentTurns,
  activeTurnId,
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
  const workflowActive = hasActiveWorkflowEnvelopeTurn(agentTurns, sessionMessages);
  const terminalWorkflowLiveTurn = hasTerminalWorkflowEnvelopeLiveTurn(agentTurns, sessionMessages, activeTurnId);
  const suppressStaleLoopSignals = (
    terminalWorkflowLiveTurn
    && runningTool === null
    && latestStreamingPreview === null
    && latestThinkingPreview === null
    && queuedDepth === 0
  );
  const isStreamingForSession = !suppressStaleLoopSignals && isStreaming && (!streamingSessionId || streamingSessionId === sessionId);
  const liveSignal = (
    (!suppressStaleLoopSignals && awaitingFirstChunk)
    || (!suppressStaleLoopSignals && hasActiveLoop)
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
