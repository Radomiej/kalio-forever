import type { ChatMessage, ChatSession, SubagentCopiedFile, SubagentToolResult } from '@kalio/types';
import type { ToolActivity } from '../../../store/agentStore';
import type { AgentTurn } from '../../../store/sessionStore';

const NODE_WIDTH = 220;
const NODE_HEIGHT = 102;
const COLUMN_GAP = 68;
const ROW_GAP = 34;
const BOARD_PADDING_X = 28;
const BOARD_PADDING_Y = 28;

export type ExecutionGraphNodeKind =
  | 'prompt'
  | 'turn'
  | 'tool-group'
  | 'tool'
  | 'subagent'
  | 'artifact'
  | 'final-answer';

export type ExecutionGraphNodeStatus = 'idle' | 'running' | 'success' | 'error';
export type ExecutionGraphArtifactKind = 'file' | 'image' | 'raapp';

export interface ExecutionGraphArtifact {
  id: string;
  kind: ExecutionGraphArtifactKind;
  label: string;
  subtitle: string;
  path?: string;
  preview?: string;
  payload: unknown;
}

type PromptPayload = {
  kind: 'prompt';
  message: ChatMessage;
};

type TurnPayload = {
  kind: 'turn';
  turn: AgentTurn;
  textPreview: string | null;
  toolCount: number;
  thinkingCount: number;
};

type ToolPayload = {
  kind: 'tool';
  toolName: string;
  args: Record<string, unknown>;
  activity: ToolActivity | null;
  result: unknown;
};

type ToolGroupPayload = {
  kind: 'tool-group';
  tools: Array<{
    callId: string;
    toolName: string;
    args: Record<string, unknown>;
    status: ExecutionGraphNodeStatus;
    result: unknown;
  }>;
};

type SubagentPayload = {
  kind: 'subagent';
  result: SubagentToolResult;
  transcript: ChatMessage[];
  copiedFiles: SubagentCopiedFile[];
};

type ArtifactPayload = {
  kind: 'artifact';
  artifact: ExecutionGraphArtifact;
};

type FinalAnswerPayload = {
  kind: 'final-answer';
  message: ChatMessage | null;
  turn: AgentTurn;
};

export type ExecutionGraphNodePayload =
  | PromptPayload
  | TurnPayload
  | ToolPayload
  | ToolGroupPayload
  | SubagentPayload
  | ArtifactPayload
  | FinalAnswerPayload;

export interface ExecutionGraphNode {
  id: string;
  kind: ExecutionGraphNodeKind;
  title: string;
  subtitle: string;
  detail?: string;
  status: ExecutionGraphNodeStatus;
  column: number;
  row: number;
  x: number;
  y: number;
  width: number;
  height: number;
  payload: ExecutionGraphNodePayload;
  sessionId?: string;
  turnId?: string;
  callId?: string;
}

export interface ExecutionGraphEdge {
  id: string;
  sourceId: string;
  targetId: string;
  style: 'solid' | 'dashed';
}

interface ToolSnapshot {
  callId: string;
  toolName: string;
  args: Record<string, unknown>;
  activity: ToolActivity | null;
  result: unknown;
}

interface ActiveAgentLoop {
  sessionId: string;
  turnId: string;
  startedAt: number;
  agentRun?: ToolActivity['agentRun'];
}

export interface BuildExecutionGraphModelInput {
  sessionId: string;
  messages: ChatMessage[];
  turns: AgentTurn[];
  toolActivities: ToolActivity[];
  activeAgentLoops: Record<string, ActiveAgentLoop>;
  sessions: ChatSession[];
  sessionMessages: Record<string, ChatMessage[]>;
  collapseTools?: boolean;
}

export interface ExecutionGraphModel {
  nodes: ExecutionGraphNode[];
  edges: ExecutionGraphEdge[];
  board: { width: number; height: number };
  defaultSelectedNodeId: string | null;
}

function basename(value: string): string {
  const normalized = value.replace(/\\/g, '/');
  const parts = normalized.split('/').filter(Boolean);
  return parts.at(-1) ?? value;
}

function safeParse(content: string): unknown {
  try {
    return JSON.parse(content);
  } catch {
    return content;
  }
}

function extractSubagentResult(data: unknown): SubagentToolResult | null {
  if (!data || typeof data !== 'object') return null;
  const candidate = data as Record<string, unknown>;
  if (typeof candidate['childSessionId'] !== 'string' || typeof candidate['result'] !== 'string') {
    return null;
  }
  return candidate as unknown as SubagentToolResult;
}

function extractArtifactFromData(callId: string, data: unknown): ExecutionGraphArtifact | null {
  if (!data || typeof data !== 'object') return null;
  const candidate = data as Record<string, unknown>;
  const path = typeof candidate['path'] === 'string' ? candidate['path'] : undefined;
  const outputType = typeof candidate['output_type'] === 'string' ? candidate['output_type'] : undefined;
  const type = typeof candidate['type'] === 'string' ? candidate['type'] : undefined;

  if (typeof candidate['status'] === 'string' && candidate['status'] === 'ready' && (type === 'html' || type === 'gui')) {
    return {
      id: `artifact:${callId}:raapp`,
      kind: 'raapp',
      label: type === 'html' ? 'HTML app' : 'GUI app',
      subtitle: 'Interactive preview block',
      preview: typeof candidate['content'] === 'string' ? candidate['content'] : undefined,
      payload: data,
    };
  }

  if (outputType === 'image' || (path && /\.(png|jpg|jpeg|gif|webp|svg)$/i.test(path))) {
    return {
      id: `artifact:${path ?? `${callId}:image`}`,
      kind: 'image',
      label: basename(path ?? 'generated-image'),
      subtitle: path ?? 'Generated image asset',
      path,
      preview: typeof candidate['message'] === 'string' ? candidate['message'] : undefined,
      payload: data,
    };
  }

  if (path) {
    return {
      id: `artifact:${path}`,
      kind: 'file',
      label: basename(path),
      subtitle: path,
      path,
      preview: typeof candidate['message'] === 'string' ? candidate['message'] : undefined,
      payload: data,
    };
  }

  return null;
}

function statusFromActivity(activity: ToolActivity | null, hasResult: boolean): ExecutionGraphNodeStatus {
  if (activity?.status === 'error' || activity?.status === 'cancelled' || activity?.status === 'expired') {
    return 'error';
  }
  if (activity?.status === 'running' || activity?.status === 'awaiting_confirmation') {
    return 'running';
  }
  if (activity?.status === 'success' || hasResult) {
    return 'success';
  }
  return 'idle';
}

function buildToolSnapshots(messages: ChatMessage[], toolActivities: ToolActivity[]): Map<string, ToolSnapshot> {
  const snapshots = new Map<string, ToolSnapshot>();

  messages.forEach((message) => {
    if (message.role !== 'assistant' || !message.toolCalls) return;

    message.toolCalls.forEach((toolCall) => {
      snapshots.set(toolCall.id, {
        callId: toolCall.id,
        toolName: toolCall.name,
        args: toolCall.args,
        activity: snapshots.get(toolCall.id)?.activity ?? null,
        result: snapshots.get(toolCall.id)?.result ?? null,
      });
    });
  });

  toolActivities.forEach((activity) => {
    const existing = snapshots.get(activity.callId);
    snapshots.set(activity.callId, {
      callId: activity.callId,
      toolName: activity.toolName,
      args: activity.args,
      activity,
      result: activity.result?.data ?? existing?.result ?? null,
    });
  });

  messages.forEach((message) => {
    if (message.role !== 'tool_result' || !message.toolCallId) return;
    const existing = snapshots.get(message.toolCallId);
    snapshots.set(message.toolCallId, {
      callId: message.toolCallId,
      toolName: existing?.toolName ?? 'tool',
      args: existing?.args ?? {},
      activity: existing?.activity ?? null,
      result: safeParse(message.content),
    });
  });

  return snapshots;
}

function positionFor(column: number, row: number): { x: number; y: number } {
  return {
    x: BOARD_PADDING_X + column * (NODE_WIDTH + COLUMN_GAP),
    y: BOARD_PADDING_Y + row * (NODE_HEIGHT + ROW_GAP),
  };
}

function getFinalAnswerMessage(turn: AgentTurn, messageById: Map<string, ChatMessage>): ChatMessage | null {
  const textMessageIds = turn.items
    .filter((item): item is Extract<AgentTurn['items'][number], { kind: 'text' }> => item.kind === 'text')
    .map((item) => item.messageId);

  const candidates = textMessageIds
    .map((messageId) => messageById.get(messageId) ?? null)
    .filter((message): message is ChatMessage => message !== null && message.content.trim().length > 0);

  return candidates.at(-1) ?? null;
}

function getTurnStatus(turn: AgentTurn, toolSnapshots: Map<string, ToolSnapshot>): ExecutionGraphNodeStatus {
  if (turn.error) return 'error';
  if (!turn.done) return 'running';

  const toolStatuses = turn.items
    .filter((item): item is Extract<AgentTurn['items'][number], { kind: 'tool' }> => item.kind === 'tool')
    .map((item) => {
      const snapshot = toolSnapshots.get(item.callId);
      return statusFromActivity(snapshot?.activity ?? null, snapshot?.result != null);
    });

  if (toolStatuses.includes('error')) return 'error';
  if (toolStatuses.includes('running')) return 'running';
  return 'success';
}

export function buildExecutionGraphModel({
  sessionId,
  messages,
  turns,
  toolActivities,
  sessions,
  sessionMessages,
  collapseTools = false,
}: BuildExecutionGraphModelInput): ExecutionGraphModel {
  const nodes: ExecutionGraphNode[] = [];
  const edges: ExecutionGraphEdge[] = [];
  const nodeById = new Map<string, ExecutionGraphNode>();
  const edgeIds = new Set<string>();
  const toolSnapshots = buildToolSnapshots(messages, toolActivities);
  const promptMessages = messages.filter((message) => message.role === 'user');
  const messageById = new Map(messages.map((message) => [message.id, message]));
  const sessionTitleById = new Map(sessions.map((session) => [session.id, session.title]));
  const knownPromptIds = new Set(promptMessages.map((message) => message.id));
  const turnsByPromptId = new Map<string, AgentTurn[]>();
  const leadingTurns: AgentTurn[] = [];

  turns.forEach((turn) => {
    if (!turn.promptMessageId || !knownPromptIds.has(turn.promptMessageId)) {
      leadingTurns.push(turn);
      return;
    }

    const bucket = turnsByPromptId.get(turn.promptMessageId) ?? [];
    bucket.push(turn);
    turnsByPromptId.set(turn.promptMessageId, bucket);
  });

  const addNode = (node: Omit<ExecutionGraphNode, 'x' | 'y' | 'width' | 'height'>): ExecutionGraphNode => {
    const existing = nodeById.get(node.id);
    if (existing) {
      return existing;
    }

    const position = positionFor(node.column, node.row);
    const nextNode: ExecutionGraphNode = {
      ...node,
      ...position,
      width: NODE_WIDTH,
      height: NODE_HEIGHT,
    };
    nodeById.set(node.id, nextNode);
    nodes.push(nextNode);
    return nextNode;
  };

  const addEdge = (sourceId: string, targetId: string, style: 'solid' | 'dashed' = 'solid') => {
    const id = `${sourceId}->${targetId}:${style}`;
    if (edgeIds.has(id)) return;
    edgeIds.add(id);
    edges.push({ id, sourceId, targetId, style });
  };

  const renderOutcomes = (callId: string, sourceNodeId: string, baseRow: number) => {
    const snapshot = toolSnapshots.get(callId);
    const outcomeIds: string[] = [];
    let maxRow = baseRow;

    if (!snapshot) {
      return { outcomeIds, maxRow };
    }

    const subagentResult = extractSubagentResult(snapshot.result);
    if (subagentResult) {
      const childSessionTitle = sessionTitleById.get(subagentResult.childSessionId) ?? `Sub-agent ${subagentResult.childSessionId.slice(0, 8)}`;
      const subagentNode = addNode({
        id: `subagent:${subagentResult.childSessionId}`,
        kind: 'subagent',
        title: childSessionTitle,
        subtitle: subagentResult.vfsMode === 'isolated' ? 'Child session root' : 'Shared-session branch',
        detail: subagentResult.result,
        status: statusFromActivity(snapshot.activity, true),
        column: 3,
        row: baseRow,
        sessionId: subagentResult.childSessionId,
        callId,
        payload: {
          kind: 'subagent',
          result: subagentResult,
          transcript: sessionMessages[subagentResult.childSessionId] ?? [],
          copiedFiles: subagentResult.copiedFiles,
        },
      });
      addEdge(sourceNodeId, subagentNode.id);
      outcomeIds.push(subagentNode.id);

      subagentResult.copiedFiles.forEach((file, index) => {
        const artifact = {
          id: `artifact:${file.toPath}`,
          kind: 'file' as const,
          label: basename(file.toPath),
          subtitle: file.toPath,
          path: file.toPath,
          preview: `${file.sizeBytes} bytes copied`,
          payload: file,
        };
        const artifactNode = addNode({
          id: artifact.id,
          kind: 'artifact',
          title: artifact.label,
          subtitle: artifact.subtitle,
          detail: artifact.preview,
          status: 'success',
          column: 4,
          row: baseRow + index,
          sessionId: subagentResult.childSessionId,
          payload: { kind: 'artifact', artifact },
        });
        addEdge(subagentNode.id, artifactNode.id);
        outcomeIds.push(artifactNode.id);
        maxRow = Math.max(maxRow, baseRow + index);
      });

      return { outcomeIds, maxRow };
    }

    const artifact = extractArtifactFromData(callId, snapshot.result);
    if (artifact) {
      const artifactNode = addNode({
        id: artifact.id,
        kind: 'artifact',
        title: artifact.label,
        subtitle: artifact.subtitle,
        detail: artifact.preview,
        status: statusFromActivity(snapshot.activity, true),
        column: 3,
        row: baseRow,
        callId,
        payload: { kind: 'artifact', artifact },
      });
      addEdge(sourceNodeId, artifactNode.id);
      outcomeIds.push(artifactNode.id);
      maxRow = Math.max(maxRow, baseRow);
    }

    return { outcomeIds, maxRow };
  };

  const renderTurn = (promptNodeId: string, turn: AgentTurn, startRow: number): number => {
    const turnToolItems = turn.items.filter((item): item is Extract<AgentTurn['items'][number], { kind: 'tool' }> => item.kind === 'tool');
    const finalMessage = getFinalAnswerMessage(turn, messageById);
    const turnNode = addNode({
      id: `turn:${turn.id}`,
      kind: 'turn',
      title: turn.agentRun?.agentType === 'subagent' ? (turn.agentRun.label ?? 'Sub-agent turn') : 'Orchestrator turn',
      subtitle: turn.agentRun?.agentType === 'subagent'
        ? `${turn.items.length} events in child session`
        : `${turnToolItems.length} tool${turnToolItems.length === 1 ? '' : 's'} in cycle`,
      detail: finalMessage?.content || undefined,
      status: getTurnStatus(turn, toolSnapshots),
      column: 1,
      row: startRow,
      sessionId: turn.sessionId,
      turnId: turn.id,
      payload: {
        kind: 'turn',
        turn,
        textPreview: finalMessage?.content ?? null,
        toolCount: turnToolItems.length,
        thinkingCount: turn.items.filter((item) => item.kind === 'thinking').length,
      },
    });
    addEdge(promptNodeId, turnNode.id);

    let maxRow = startRow;
    const outcomeIds: string[] = [];

    if (collapseTools && turnToolItems.length > 1) {
      const groupedTools = turnToolItems.map((item) => {
        const snapshot = toolSnapshots.get(item.callId);
        return {
          callId: item.callId,
          toolName: snapshot?.toolName ?? 'tool',
          args: snapshot?.args ?? {},
          status: statusFromActivity(snapshot?.activity ?? null, snapshot?.result != null),
          result: snapshot?.result ?? null,
        };
      });

      const groupStatus: ExecutionGraphNodeStatus = groupedTools.some((tool) => tool.status === 'error')
        ? 'error'
        : groupedTools.some((tool) => tool.status === 'running')
          ? 'running'
          : groupedTools.some((tool) => tool.status === 'success')
            ? 'success'
            : 'idle';

      const groupNode = addNode({
        id: `tool-group:${turn.id}`,
        kind: 'tool-group',
        title: 'Tool group',
        subtitle: `${groupedTools.length} calls collapsed`,
        detail: groupedTools.map((tool) => tool.toolName).join(', '),
        status: groupStatus,
        column: 2,
        row: startRow,
        turnId: turn.id,
        payload: { kind: 'tool-group', tools: groupedTools },
      });
      addEdge(turnNode.id, groupNode.id);

      turnToolItems.forEach((item, index) => {
        const outcome = renderOutcomes(item.callId, groupNode.id, startRow + index);
        outcomeIds.push(...outcome.outcomeIds);
        maxRow = Math.max(maxRow, outcome.maxRow);
      });
    } else {
      turnToolItems.forEach((item, index) => {
        const snapshot = toolSnapshots.get(item.callId);
        const toolRow = startRow + index;
        const toolNode = addNode({
          id: `tool:${item.callId}`,
          kind: 'tool',
          title: snapshot?.toolName ?? 'Tool call',
          subtitle: snapshot?.activity?.status === 'running' ? 'Running' : 'Execution step',
          detail: Object.keys(snapshot?.args ?? {}).slice(0, 3).join(', ') || undefined,
          status: statusFromActivity(snapshot?.activity ?? null, snapshot?.result != null),
          column: 2,
          row: toolRow,
          callId: item.callId,
          payload: {
            kind: 'tool',
            toolName: snapshot?.toolName ?? 'tool',
            args: snapshot?.args ?? {},
            activity: snapshot?.activity ?? null,
            result: snapshot?.result ?? null,
          },
        });
        addEdge(turnNode.id, toolNode.id);

        const outcome = renderOutcomes(item.callId, toolNode.id, toolRow);
        outcomeIds.push(...outcome.outcomeIds);
        maxRow = Math.max(maxRow, outcome.maxRow);
      });
    }

    if (finalMessage) {
      const finalNode = addNode({
        id: `final:${turn.id}`,
        kind: 'final-answer',
        title: 'Final answer',
        subtitle: 'Summary and persisted reply',
        detail: finalMessage.content,
        status: turn.done ? 'success' : 'running',
        column: 4,
        row: maxRow,
        turnId: turn.id,
        payload: {
          kind: 'final-answer',
          message: finalMessage,
          turn,
        },
      });
      addEdge(turnNode.id, finalNode.id);
      outcomeIds.forEach((outcomeId) => addEdge(outcomeId, finalNode.id, 'dashed'));
    }

    return maxRow;
  };

  let currentRow = 0;

  promptMessages.forEach((promptMessage) => {
    const promptNode = addNode({
      id: `prompt:${promptMessage.id}`,
      kind: 'prompt',
      title: 'Prompt',
      subtitle: promptMessage.content,
      detail: 'User task root',
      status: 'success',
      column: 0,
      row: currentRow,
      sessionId,
      payload: { kind: 'prompt', message: promptMessage },
    });

    const anchoredTurns = turnsByPromptId.get(promptMessage.id) ?? [];
    let groupMaxRow = currentRow;

    anchoredTurns.forEach((turn, index) => {
      const startRow = index === 0 ? currentRow : groupMaxRow + 2;
      groupMaxRow = Math.max(groupMaxRow, renderTurn(promptNode.id, turn, startRow));
    });

    currentRow = groupMaxRow + 3;
  });

  leadingTurns.forEach((turn) => {
    const promptNode = addNode({
      id: `prompt:lead:${turn.id}`,
      kind: 'prompt',
      title: 'Context',
      subtitle: 'Turn restored without an anchored user prompt',
      detail: 'Historical fallback',
      status: 'idle',
      column: 0,
      row: currentRow,
      sessionId: turn.sessionId,
      payload: {
        kind: 'prompt',
        message: {
          id: `context-${turn.id}`,
          sessionId: turn.sessionId,
          role: 'user',
          content: 'Recovered historical context',
          createdAt: 0,
        },
      },
    });

    currentRow = renderTurn(promptNode.id, turn, currentRow) + 3;
  });

  const maxColumn = nodes.reduce((value, node) => Math.max(value, node.column), 0);
  const maxRow = nodes.reduce((value, node) => Math.max(value, node.row), 0);

  return {
    nodes,
    edges,
    board: {
      width: BOARD_PADDING_X * 2 + (maxColumn + 1) * NODE_WIDTH + maxColumn * COLUMN_GAP,
      height: BOARD_PADDING_Y * 2 + (maxRow + 1) * NODE_HEIGHT + maxRow * ROW_GAP,
    },
    defaultSelectedNodeId: nodes[0]?.id ?? null,
  };
}