import type { ChatMessage, ChatSession, Persona, SubagentCopiedFile, SubagentToolResult } from '@kalio/types';
import type { ToolActivity } from '../../../store/agentStore';
import type { AgentTurn } from '../../../store/sessionStore';
import {
  basename,
  buildToolSnapshots,
  extractArtifactFromData,
  extractSubagentContextPrompt,
  extractSubagentResult,
  getFinalAnswerMessage,
  getTurnStatus,
  NODE_WIDTH,
  statusFromActivity,
  type ExecutionGraphArtifact,
  type ExecutionGraphNodeStatus,
} from './executionGraphModel.helpers';
import { applyGraphNodeLayout, estimateGraphNodeHeight } from './executionGraphNodePresentation';

export type { ExecutionGraphArtifact, ExecutionGraphArtifactKind, ExecutionGraphNodeStatus } from './executionGraphModel.helpers';

export type ExecutionGraphNodeKind =
  | 'prompt'
  | 'turn'
  | 'tool-group'
  | 'tool'
  | 'subagent'
  | 'artifact'
  | 'final-answer';

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
  actorLabel: string | null;
  modelLabel: string | null;
};

type ToolPayload = {
  kind: 'tool';
  toolName: string;
  args: Record<string, unknown>;
  activity: ToolActivity | null;
  result: unknown;
  confirmationRequired: boolean;
};

type ToolGroupPayload = {
  kind: 'tool-group';
  tools: Array<{
    callId: string;
    toolName: string;
    args: Record<string, unknown>;
    status: ExecutionGraphNodeStatus;
    result: unknown;
    confirmationRequired: boolean;
  }>;
};

type SubagentPayload = {
  kind: 'subagent';
  result: SubagentToolResult;
  transcript: ChatMessage[];
  copiedFiles: SubagentCopiedFile[];
  actorLabel: string | null;
  modelLabel: string | null;
  inputPrompt: string | null;
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
  sessionAgentTurns?: Record<string, AgentTurn[]>;
  personas?: Persona[];
  collapseTools?: boolean;
}

export interface ExecutionGraphModel {
  nodes: ExecutionGraphNode[];
  edges: ExecutionGraphEdge[];
  board: { width: number; height: number };
  defaultSelectedNodeId: string | null;
}

function uniqueMessages(sessionMessages: Record<string, ChatMessage[]>): ChatMessage[] {
  const byId = new Map<string, ChatMessage>();
  Object.values(sessionMessages).forEach((messages) => {
    messages.forEach((message) => {
      byId.set(`${message.sessionId}:${message.id}`, message);
    });
  });
  return [...byId.values()];
}

function buildTurnIdentity(
  turn: AgentTurn,
  sessionById: Map<string, ChatSession>,
  personaById: Map<string, Persona>,
): { subtitle: string; detail?: string; actorLabel: string | null; modelLabel: string | null } {
  const session = sessionById.get(turn.sessionId) ?? null;
  const persona = session ? personaById.get(session.personaId) ?? null : null;
  const actorLabel = turn.agentRun?.label ?? persona?.name ?? session?.personaId ?? null;
  const modelLabel = persona?.model ?? null;

  if (actorLabel && modelLabel) {
    return {
      subtitle: `${actorLabel} · ${modelLabel}`,
      detail: turn.done ? 'Turn completed' : 'Turn in progress',
      actorLabel,
      modelLabel,
    };
  }

  if (actorLabel) {
    return {
      subtitle: actorLabel,
      detail: turn.done ? 'Turn completed' : 'Turn in progress',
      actorLabel,
      modelLabel,
    };
  }

  return {
    subtitle: turn.done ? 'Turn completed' : 'Turn in progress',
    actorLabel,
    modelLabel,
  };
}

function buildToolCycleLabel(toolCount: number): string {
  if (toolCount === 0) return 'No tools in cycle';
  return `${toolCount} tool${toolCount === 1 ? '' : 's'} in cycle`;
}

function buildCopiedFileArtifact(file: SubagentCopiedFile): ExecutionGraphArtifact {
  return {
    id: `artifact:${file.toPath}`,
    kind: 'file',
    label: basename(file.toPath),
    subtitle: file.toPath,
    path: file.toPath,
    preview: `${file.sizeBytes} bytes copied`,
    payload: file,
  };
}


export function buildExecutionGraphModel({
  sessionId,
  messages,
  turns,
  toolActivities,
  sessions,
  sessionMessages,
  sessionAgentTurns = {},
  personas = [],
  collapseTools = false,
}: BuildExecutionGraphModelInput): ExecutionGraphModel {
  const nodes: ExecutionGraphNode[] = [];
  const edges: ExecutionGraphEdge[] = [];
  const nodeById = new Map<string, ExecutionGraphNode>();
  const edgeIds = new Set<string>();
  const allSessionMessages: Record<string, ChatMessage[]> = {
    ...sessionMessages,
    [sessionId]: messages,
  };
  const allSessionTurns: Record<string, AgentTurn[]> = {
    ...sessionAgentTurns,
    [sessionId]: turns,
  };
  const toolSnapshots = buildToolSnapshots(uniqueMessages(allSessionMessages), toolActivities);
  const promptMessages = messages.filter((message) => message.role === 'user');
  const messageById = new Map(messages.map((message) => [message.id, message]));
  const sessionById = new Map(sessions.map((session) => [session.id, session]));
  const personaById = new Map(personas.map((persona) => [persona.id, persona]));
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

    const nextNode: ExecutionGraphNode = {
      ...node,
      x: 0,
      y: 0,
      width: NODE_WIDTH,
      height: NODE_WIDTH,
    };
    nextNode.height = estimateGraphNodeHeight(nextNode);
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

  const renderTurn = (
    parentNodeId: string,
    turn: AgentTurn,
    startRow: number,
    baseColumn: number,
    visitedSessions: Set<string>,
  ): number => {
    const turnToolItems = turn.items.filter((item): item is Extract<AgentTurn['items'][number], { kind: 'tool' }> => item.kind === 'tool');
    const finalMessage = getFinalAnswerMessage(turn, messageById);
    const turnIdentity = buildTurnIdentity(turn, sessionById, personaById);
    const turnNode = addNode({
      id: `turn:${turn.id}`,
      kind: 'turn',
      title: 'Turn',
      subtitle: turnIdentity.subtitle,
      detail: [buildToolCycleLabel(turnToolItems.length), finalMessage?.content].filter(Boolean).join(' • ') || turnIdentity.detail,
      status: getTurnStatus(turn, toolSnapshots),
      column: baseColumn,
      row: startRow,
      sessionId: turn.sessionId,
      turnId: turn.id,
      payload: {
        kind: 'turn',
        turn,
        textPreview: finalMessage?.content ?? null,
        toolCount: turnToolItems.length,
        thinkingCount: turn.items.filter((item) => item.kind === 'thinking').length,
        actorLabel: turnIdentity.actorLabel,
        modelLabel: turnIdentity.modelLabel,
      },
    });
    addEdge(parentNodeId, turnNode.id);

    const renderNestedSessionTurns = (
      subagentNodeId: string,
      childSessionId: string,
      childStartRow: number,
      childColumn: number,
    ): number => {
      if (visitedSessions.has(childSessionId)) {
        return childStartRow - 1;
      }

      const nestedTurns = allSessionTurns[childSessionId] ?? [];
      if (nestedTurns.length === 0) {
        return childStartRow - 1;
      }

      const nextVisitedSessions = new Set(visitedSessions);
      nextVisitedSessions.add(childSessionId);

      let nestedMaxRow = childStartRow - 1;
      nestedTurns.forEach((nestedTurn) => {
        const nextRow = nestedMaxRow >= childStartRow ? nestedMaxRow + 1 : childStartRow;
        nestedMaxRow = renderTurn(subagentNodeId, nestedTurn, nextRow, childColumn, nextVisitedSessions);
      });

      return nestedMaxRow;
    };

    const renderOutcomes = (
      callId: string,
      sourceNodeId: string,
      branchStartRow: number,
      branchColumn: number,
    ) => {
      const snapshot = toolSnapshots.get(callId);
      const outcomeIds: string[] = [];
      let maxRow = branchStartRow - 1;

      if (!snapshot) {
        return { outcomeIds, maxRow };
      }

      const subagentResult = extractSubagentResult(snapshot.result);
      if (subagentResult) {
        const childSession = sessionById.get(subagentResult.childSessionId) ?? null;
        const childPersona = childSession ? personaById.get(childSession.personaId) ?? null : null;
        const contextPrompt = extractSubagentContextPrompt(snapshot.args);
        const subagentRow = Math.max(branchStartRow - 1, 0);
        const subagentNode = addNode({
          id: `subagent:${subagentResult.childSessionId}`,
          kind: 'subagent',
          title: childPersona?.name ?? childSession?.title ?? `Sub-agent ${subagentResult.childSessionId.slice(0, 8)}`,
          subtitle: contextPrompt ?? 'Sub-agent context',
          detail: [
            childPersona?.model,
            subagentResult.vfsMode === 'isolated' ? 'isolated VFS' : 'shared VFS',
            subagentResult.result,
          ].filter(Boolean).join(' • '),
          status: statusFromActivity(snapshot.activity, true),
          column: branchColumn,
          row: subagentRow,
          sessionId: subagentResult.childSessionId,
          callId,
          payload: {
            kind: 'subagent',
            result: subagentResult,
            transcript: allSessionMessages[subagentResult.childSessionId] ?? [],
            copiedFiles: subagentResult.copiedFiles,
            actorLabel: childPersona?.name ?? null,
            modelLabel: childPersona?.model ?? null,
            inputPrompt: contextPrompt,
          },
        });
        addEdge(sourceNodeId, subagentNode.id);
        outcomeIds.push(subagentNode.id);
        maxRow = subagentRow;

        const nestedMaxRow = renderNestedSessionTurns(subagentNode.id, subagentResult.childSessionId, subagentRow, branchColumn + 1);
        if (nestedMaxRow >= subagentRow) {
          maxRow = Math.max(maxRow, nestedMaxRow);
        }

        subagentResult.copiedFiles.forEach((file, index) => {
          const artifact = buildCopiedFileArtifact(file);
          const artifactRow = maxRow + index + 1;
          const artifactNode = addNode({
            id: artifact.id,
            kind: 'artifact',
            title: artifact.label,
            subtitle: artifact.subtitle,
            detail: artifact.preview,
            status: 'success',
            column: branchColumn + 1,
            row: artifactRow,
            sessionId: subagentResult.childSessionId,
            payload: { kind: 'artifact', artifact },
          });
          addEdge(subagentNode.id, artifactNode.id);
          outcomeIds.push(artifactNode.id);
          maxRow = Math.max(maxRow, artifactRow);
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
          column: branchColumn,
          row: branchStartRow,
          callId,
          payload: { kind: 'artifact', artifact },
        });
        addEdge(sourceNodeId, artifactNode.id);
        outcomeIds.push(artifactNode.id);
        maxRow = branchStartRow;
      }

      return { outcomeIds, maxRow };
    };

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
          confirmationRequired: snapshot?.activity?.status === 'awaiting_confirmation',
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
        column: baseColumn,
        row: startRow + 1,
        turnId: turn.id,
        payload: { kind: 'tool-group', tools: groupedTools },
      });
      addEdge(turnNode.id, groupNode.id);
      maxRow = Math.max(maxRow, groupNode.row);

      let nextOutcomeRow = groupNode.row + 1;
      turnToolItems.forEach((item) => {
        const outcome = renderOutcomes(item.callId, groupNode.id, nextOutcomeRow, baseColumn + 1);
        outcomeIds.push(...outcome.outcomeIds);
        if (outcome.maxRow >= nextOutcomeRow) {
          maxRow = Math.max(maxRow, outcome.maxRow);
          nextOutcomeRow = outcome.maxRow + 1;
        }
      });
    } else {
      turnToolItems.forEach((item, index) => {
        const snapshot = toolSnapshots.get(item.callId);
        const toolRow = startRow + index + 1;
        const toolNode = addNode({
          id: `tool:${item.callId}`,
          kind: 'tool',
          title: snapshot?.toolName ?? 'Tool call',
          subtitle: snapshot?.activity?.status === 'awaiting_confirmation'
            ? 'Awaiting confirmation'
            : snapshot?.activity?.status === 'running'
              ? 'Running'
              : 'Execution step',
          detail: snapshot?.activity?.status === 'awaiting_confirmation'
            ? 'Accept required before this branch can continue'
            : Object.keys(snapshot?.args ?? {}).slice(0, 3).join(', ') || undefined,
          status: statusFromActivity(snapshot?.activity ?? null, snapshot?.result != null),
          column: baseColumn,
          row: toolRow,
          callId: item.callId,
          payload: {
            kind: 'tool',
            toolName: snapshot?.toolName ?? 'tool',
            args: snapshot?.args ?? {},
            activity: snapshot?.activity ?? null,
            result: snapshot?.result ?? null,
            confirmationRequired: snapshot?.activity?.status === 'awaiting_confirmation',
          },
        });
        addEdge(turnNode.id, toolNode.id);
        maxRow = Math.max(maxRow, toolRow);

        const outcome = renderOutcomes(item.callId, toolNode.id, toolRow + 1, baseColumn + 1);
        outcomeIds.push(...outcome.outcomeIds);
        if (outcome.maxRow >= toolRow + 1) {
          maxRow = Math.max(maxRow, outcome.maxRow);
        }
      });
    }

    if (finalMessage) {
      const branchMaxColumn = nodes
        .slice(nodes.findIndex((node) => node.id === turnNode.id))
        .reduce((value, node) => Math.max(value, node.column), baseColumn);
      const finalNode = addNode({
        id: `final:${turn.id}`,
        kind: 'final-answer',
        title: 'Final response',
        subtitle: 'Last chat reply',
        detail: finalMessage.content,
        status: turn.done ? 'success' : 'running',
        column: branchMaxColumn + 1,
        row: startRow,
        turnId: turn.id,
        payload: {
          kind: 'final-answer',
          message: finalMessage,
          turn,
        },
      });
      addEdge(turnNode.id, finalNode.id);
      maxRow = Math.max(maxRow, finalNode.row);
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
      groupMaxRow = Math.max(groupMaxRow, renderTurn(promptNode.id, turn, startRow, 1, new Set([sessionId])));
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

    currentRow = renderTurn(promptNode.id, turn, currentRow, 1, new Set([turn.sessionId])) + 3;
  });

  const board = applyGraphNodeLayout(nodes);

  return {
    nodes,
    edges,
    board,
    defaultSelectedNodeId: nodes[0]?.id ?? null,
  };
}