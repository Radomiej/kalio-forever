import type { ChatMessage, RuntimeChildExecution } from '@kalio/types';
import type { AgentTurn } from '../../../store/sessionStore';
import { renderArchitectureRunProjection } from './executionGraphArchitectureRun';
import { findWorkflowEnvelopeArchitectureMessage } from './executionGraphWorkflowEnvelope';
import { resolveWorkflowTurnProjection } from '../workflowTurnProjection';
import {
  buildCopiedFileArtifact,
  buildToolCycleLabel,
  compactGraphText,
  buildTurnIdentity,
  extractCLIAgentSessionResult,
  extractSubAgentFlowResult,
  buildToolSnapshots,
  extractArtifactFromData,
  extractSubagentContextPrompt,
  extractSubagentResult,
  getFinalAnswerMessage,
  getTurnStatus,
  NODE_WIDTH,
  statusFromRuntimeChildExecution,
  statusFromActivity,
  uniqueMessages,
  type ExecutionGraphNodeStatus,
} from './executionGraphModel.helpers';
import { applyGraphNodeLayout, estimateGraphNodeHeight } from './executionGraphNodePresentation';
import type {
  BuildExecutionGraphModelInput,
  ExecutionGraphEdge,
  ExecutionGraphModel,
  ExecutionGraphNode,
} from './executionGraphModel.types';

export type { ExecutionGraphArtifact, ExecutionGraphArtifactKind, ExecutionGraphNodeStatus } from './executionGraphModel.helpers';
export type {
  ActiveAgentLoop,
  BuildExecutionGraphModelInput,
  ExecutionGraphEdge,
  ExecutionGraphModel,
  ExecutionGraphNode,
  ExecutionGraphNodeKind,
  ExecutionGraphNodePayload,
} from './executionGraphModel.types';

function findRuntimeChildExecution(
  childExecutionsByCallId: Map<string, RuntimeChildExecution>,
  callId: string,
  kind: RuntimeChildExecution['kind'],
): RuntimeChildExecution | null {
  const execution = childExecutionsByCallId.get(callId) ?? null;
  return execution?.kind === kind ? execution : null;
}

function cliSessionStatusFromRuntimeExecution(
  status: RuntimeChildExecution['status'],
): 'idle' | 'running' | 'completed' | 'failed' | 'stopped' {
  if (status === 'completed') {
    return 'completed';
  }
  if (status === 'failed' || status === 'blocked') {
    return 'failed';
  }
  if (status === 'cancelled' || status === 'stopped') {
    return 'stopped';
  }
  if (status === 'running' || status === 'waiting') {
    return 'running';
  }
  return 'idle';
}

function agentFlowStatusFromRuntimeExecution(
  status: RuntimeChildExecution['status'],
): 'queued' | 'running' | 'waiting_on_orchestrator' | 'done' | 'failed' | 'cancelled' | 'blocked' {
  if (status === 'completed') {
    return 'done';
  }
  if (status === 'waiting') {
    return 'waiting_on_orchestrator';
  }
  if (status === 'failed') {
    return 'failed';
  }
  if (status === 'blocked') {
    return 'blocked';
  }
  if (status === 'cancelled' || status === 'stopped') {
    return 'cancelled';
  }
  if (status === 'running') {
    return 'running';
  }
  return 'queued';
}

export function buildExecutionGraphModel({
  sessionId,
  messages,
  turns,
  toolActivities,
  activeAgentLoops,
  childExecutions = [],
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
  const toolArgsByCallId = new Map<string, Record<string, unknown>>();
  for (const message of messages) {
    if (message.role === 'assistant' && message.toolCalls) {
      for (const toolCall of message.toolCalls) {
        toolArgsByCallId.set(toolCall.id, toolCall.args);
      }
    }
  }
  for (const activity of toolActivities) {
    toolArgsByCallId.set(activity.callId, activity.args);
  }
  const childExecutionsByCallId = new Map<string, RuntimeChildExecution>();
  childExecutions.forEach((execution) => {
    if (execution.parentToolCallId) {
      childExecutionsByCallId.set(execution.parentToolCallId, execution);
    }
  });
  const sessionById = new Map(sessions.map((session) => [session.id, session]));
  const personaById = new Map(personas.map((persona) => [persona.id, persona]));
  const activeLoopSessionIds = new Set(Object.values(activeAgentLoops).map((loop) => loop.sessionId));
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
  const visibleArgNames = (args: Record<string, unknown>): string => Object.keys(args)
    .filter((key) => !['architectureRunId', 'childSessionId', 'nodeId', 'parentSessionId', 'roleSlotId'].includes(key))
    .slice(0, 3)
    .join(', ');
  const architectureBranchLabel = (snapshot: { toolName: string; args: Record<string, unknown> } | undefined): string | null => {
    if (snapshot?.toolName !== 'run_subagent' || typeof snapshot.args['architectureRunId'] !== 'string') {
      return null;
    }
    const role = typeof snapshot.args['roleSlotId'] === 'string'
      ? snapshot.args['roleSlotId']
      : typeof snapshot.args['nodeId'] === 'string'
        ? snapshot.args['nodeId']
        : 'branch';
    return role
      .replace(/[-_]+/g, ' ')
      .split(' ')
      .filter(Boolean)
      .map((part) => `${part[0]?.toUpperCase() ?? ''}${part.slice(1)}`)
      .join(' ');
  };
  const thinkingPreviewsForTurn = (turn: AgentTurn): string[] => turn.items
    .filter((item): item is Extract<AgentTurn['items'][number], { kind: 'thinking' }> => item.kind === 'thinking')
    .map((item) => messageById.get(item.messageId)?.thinking?.trim() ?? '')
    .filter((thinking) => thinking.length > 0)
    .slice(-3);

  const renderTurn = (
    parentNodeId: string,
    turn: AgentTurn,
    startRow: number,
    baseColumn: number,
    visitedSessions: Set<string>,
  ): number => {
    const turnToolItems = turn.items.filter((item): item is Extract<AgentTurn['items'][number], { kind: 'tool' }> => item.kind === 'tool');
    const finalMessage = getFinalAnswerMessage(turn, messageById);
    const workflowTurnProjection = resolveWorkflowTurnProjection(turn, messages, toolArgsByCallId);
    const turnIdentity = buildTurnIdentity(turn, sessionById, personaById);
    const thinkingPreviews = thinkingPreviewsForTurn(turn);
    const workflowEnvelopeMessage = turn.turnKind === 'workflow-envelope'
      ? findWorkflowEnvelopeArchitectureMessage(turn, messages, toolArgsByCallId, finalMessage)
      : null;
    const isWorkflowEnvelope = turn.turnKind === 'workflow-envelope' && workflowEnvelopeMessage !== null;
    const graphToolItems = isWorkflowEnvelope ? [] : turnToolItems;

    const turnNode = isWorkflowEnvelope
      ? null
      : addNode({
        id: `turn:${turn.id}`,
        kind: 'turn',
        title: 'Turn',
        subtitle: turnIdentity.subtitle,
        detail: [buildToolCycleLabel(graphToolItems.length), compactGraphText(finalMessage?.content)].filter(Boolean).join(' - ') || turnIdentity.detail,
        status: getTurnStatus(turn, toolSnapshots),
        column: baseColumn,
        row: startRow,
        sessionId: turn.sessionId,
        turnId: turn.id,
        payload: {
          kind: 'turn',
          turn,
          textPreview: finalMessage?.content ?? null,
          toolCount: graphToolItems.length,
          thinkingCount: turn.items.filter((item) => item.kind === 'thinking').length,
          thinkingPreviews,
          actorLabel: turnIdentity.actorLabel,
          modelLabel: turnIdentity.modelLabel,
        },
      });

    if (turnNode) {
      addEdge(parentNodeId, turnNode.id);
    }

    const turnSourceNodeId = turnNode?.id ?? parentNodeId;
    const turnSourceColumn = turnNode?.column ?? Math.max(baseColumn - 1, 0);

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
      const runtimeSubagentExecution = findRuntimeChildExecution(childExecutionsByCallId, callId, 'subagent');
      const runtimeCliExecution = findRuntimeChildExecution(childExecutionsByCallId, callId, 'cli_agent');
      const runtimeAgentFlowExecution = findRuntimeChildExecution(childExecutionsByCallId, callId, 'agent_flow');
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
          title: childSession?.title ?? childPersona?.name ?? `Sub-agent ${subagentResult.childSessionId.slice(0, 8)}`,
          subtitle: [
            childPersona?.name,
            childPersona?.model,
          ].filter(Boolean).join(' - ') || 'Sub-agent branch',
          detail: [
            contextPrompt,
            childPersona?.model,
            subagentResult.vfsMode === 'isolated' ? 'isolated VFS' : 'shared VFS',
            compactGraphText(subagentResult.result),
          ].filter(Boolean).join(' - '),
          status: runtimeSubagentExecution
            ? statusFromRuntimeChildExecution(runtimeSubagentExecution.status)
            : activeLoopSessionIds.has(subagentResult.childSessionId)
              ? 'running'
              : statusFromActivity(snapshot.activity, true, snapshot.result, snapshot.toolName),
          column: branchColumn,
          row: subagentRow,
          sessionId: subagentResult.childSessionId,
          callId,
          payload: {
            kind: 'subagent',
            childExecutionKind: 'sub_agent',
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

      const cliAgentResult = extractCLIAgentSessionResult(snapshot.result);
      if (cliAgentResult) {
        const childSession = sessionById.get(cliAgentResult.childSessionId) ?? null;
        const cliRow = Math.max(branchStartRow - 1, 0);
        const cliNode = addNode({
          id: `cli-agent:${cliAgentResult.childSessionId}`,
          kind: 'cli-agent',
          title: childSession?.title ?? `${cliAgentResult.agentId} CLI`,
          subtitle: cliAgentResult.agentId || 'CLI session',
          detail: [
            cliAgentResult.lastPrompt || extractSubagentContextPrompt(snapshot.args),
            cliAgentResult.agentId,
            cliAgentResult.workdir,
            compactGraphText(cliAgentResult.lastOutput),
          ].filter(Boolean).join(' - '),
          status: runtimeCliExecution
            ? statusFromRuntimeChildExecution(runtimeCliExecution.status)
            : activeLoopSessionIds.has(cliAgentResult.childSessionId)
              ? 'running'
              : statusFromActivity(snapshot.activity, true, snapshot.result, snapshot.toolName),
          column: branchColumn,
          row: cliRow,
          sessionId: cliAgentResult.childSessionId,
          callId,
          payload: {
            kind: 'cli-agent',
            childExecutionKind: 'cli_agent',
            snapshot: {
              ...cliAgentResult,
              parentSessionId: cliAgentResult.parentSessionId || sessionId,
            },
            transcript: allSessionMessages[cliAgentResult.childSessionId] ?? [],
            inputPrompt: cliAgentResult.lastPrompt || extractSubagentContextPrompt(snapshot.args),
          },
        });
        addEdge(sourceNodeId, cliNode.id);
        outcomeIds.push(cliNode.id);
        maxRow = cliRow;

        const nestedMaxRow = renderNestedSessionTurns(cliNode.id, cliAgentResult.childSessionId, cliRow, branchColumn + 1);
        if (nestedMaxRow >= cliRow) {
          maxRow = Math.max(maxRow, nestedMaxRow);
        }

        return { outcomeIds, maxRow };
      }

      const subAgentFlowResult = extractSubAgentFlowResult(snapshot.result);
      if (subAgentFlowResult) {
        const childSessionId = subAgentFlowResult.openChatSessionId ?? subAgentFlowResult.childSessionId;
        const graphRunId = subAgentFlowResult.openGraphRunId ?? subAgentFlowResult.flowRunId;
        const flowRow = Math.max(branchStartRow - 1, 0);
        const flowStatus: ExecutionGraphNodeStatus = runtimeAgentFlowExecution
          ? statusFromRuntimeChildExecution(runtimeAgentFlowExecution.status)
          : subAgentFlowResult.status === 'failed' || subAgentFlowResult.status === 'blocked' || subAgentFlowResult.status === 'cancelled'
            ? 'error'
            : subAgentFlowResult.status === 'waiting_on_orchestrator'
              ? 'waiting'
              : subAgentFlowResult.status === 'done'
                ? 'success'
                : 'running';
        const flowNode = addNode({
          id: `agent-flow:${subAgentFlowResult.flowRunId}`,
          kind: 'agent-flow',
          title: 'Sub AgentFlow',
          subtitle: `${graphRunId} / ${subAgentFlowResult.status}`,
          detail: compactGraphText(subAgentFlowResult.summary),
          status: flowStatus,
          column: branchColumn,
          row: flowRow,
          sessionId: childSessionId,
          callId,
          payload: {
            kind: 'agent-flow',
            childExecutionKind: 'sub_agentflow',
            result: subAgentFlowResult,
            childSessionId,
            graphRunId,
            inputPrompt: extractSubagentContextPrompt(snapshot.args),
          },
        });
        addEdge(sourceNodeId, flowNode.id);
        outcomeIds.push(flowNode.id);
        maxRow = flowRow;

        const nestedMaxRow = renderNestedSessionTurns(flowNode.id, childSessionId, flowRow, branchColumn + 1);
        if (nestedMaxRow >= flowRow) {
          maxRow = Math.max(maxRow, nestedMaxRow);
        }

        return { outcomeIds, maxRow };
      }

      if (runtimeSubagentExecution) {
        const childSession = sessionById.get(runtimeSubagentExecution.childSessionId) ?? null;
        const childPersona = childSession ? personaById.get(childSession.personaId) ?? null : null;
        const contextPrompt = extractSubagentContextPrompt(snapshot.args);
        const subagentRow = Math.max(branchStartRow - 1, 0);
        const subagentNode = addNode({
          id: `subagent:${runtimeSubagentExecution.childSessionId}`,
          kind: 'subagent',
          title: childSession?.title ?? childPersona?.name ?? runtimeSubagentExecution.label ?? `Sub-agent ${runtimeSubagentExecution.childSessionId.slice(0, 8)}`,
          subtitle: [
            runtimeSubagentExecution.label ?? childPersona?.name,
            childPersona?.model,
          ].filter(Boolean).join(' - ') || 'Sub-agent branch',
          detail: [
            contextPrompt,
            compactGraphText(runtimeSubagentExecution.lastOutput),
          ].filter(Boolean).join(' - ') || 'Live runtime branch',
          status: statusFromRuntimeChildExecution(runtimeSubagentExecution.status),
          column: branchColumn,
          row: subagentRow,
          sessionId: runtimeSubagentExecution.childSessionId,
          callId,
          payload: {
            kind: 'subagent',
            childExecutionKind: 'sub_agent',
            result: null,
            transcript: allSessionMessages[runtimeSubagentExecution.childSessionId] ?? [],
            copiedFiles: [],
            actorLabel: childPersona?.name ?? runtimeSubagentExecution.label ?? null,
            modelLabel: childPersona?.model ?? null,
            inputPrompt: contextPrompt,
          },
        });
        addEdge(sourceNodeId, subagentNode.id);
        outcomeIds.push(subagentNode.id);
        maxRow = subagentRow;

        const nestedMaxRow = renderNestedSessionTurns(
          subagentNode.id,
          runtimeSubagentExecution.childSessionId,
          subagentRow,
          branchColumn + 1,
        );
        if (nestedMaxRow >= subagentRow) {
          maxRow = Math.max(maxRow, nestedMaxRow);
        }

        return { outcomeIds, maxRow };
      }

      if (runtimeCliExecution) {
        const childSession = sessionById.get(runtimeCliExecution.childSessionId) ?? null;
        const inputPrompt = extractSubagentContextPrompt(snapshot.args);
        const workdir = typeof snapshot.args['workdir'] === 'string' ? snapshot.args['workdir'] : '';
        const agentId = typeof snapshot.args['agentId'] === 'string'
          ? snapshot.args['agentId']
          : runtimeCliExecution.label ?? 'copilot';
        const cliRow = Math.max(branchStartRow - 1, 0);
        const cliNode = addNode({
          id: `cli-agent:${runtimeCliExecution.childSessionId}`,
          kind: 'cli-agent',
          title: childSession?.title ?? `${agentId} CLI`,
          subtitle: agentId,
          detail: [
            inputPrompt,
            workdir,
            compactGraphText(runtimeCliExecution.lastOutput),
          ].filter(Boolean).join(' - ') || 'Live CLI runtime',
          status: statusFromRuntimeChildExecution(runtimeCliExecution.status),
          column: branchColumn,
          row: cliRow,
          sessionId: runtimeCliExecution.childSessionId,
          callId,
          payload: {
            kind: 'cli-agent',
            childExecutionKind: 'cli_agent',
            snapshot: {
              childSessionId: runtimeCliExecution.childSessionId,
              parentSessionId: runtimeCliExecution.parentSessionId,
              agentId,
              workdir,
              status: cliSessionStatusFromRuntimeExecution(runtimeCliExecution.status),
              lastPrompt: inputPrompt ?? '',
              updatedAt: runtimeCliExecution.updatedAt,
              lastOutput: runtimeCliExecution.lastOutput,
            },
            transcript: allSessionMessages[runtimeCliExecution.childSessionId] ?? [],
            inputPrompt,
          },
        });
        addEdge(sourceNodeId, cliNode.id);
        outcomeIds.push(cliNode.id);
        maxRow = cliRow;

        const nestedMaxRow = renderNestedSessionTurns(
          cliNode.id,
          runtimeCliExecution.childSessionId,
          cliRow,
          branchColumn + 1,
        );
        if (nestedMaxRow >= cliRow) {
          maxRow = Math.max(maxRow, nestedMaxRow);
        }

        return { outcomeIds, maxRow };
      }

      if (runtimeAgentFlowExecution) {
        const childSession = sessionById.get(runtimeAgentFlowExecution.childSessionId) ?? null;
        const graphRunId = runtimeAgentFlowExecution.flowRunId ?? runtimeAgentFlowExecution.id;
        const flowRow = Math.max(branchStartRow - 1, 0);
        const runtimeFlowStatus = agentFlowStatusFromRuntimeExecution(runtimeAgentFlowExecution.status);
        const flowNode = addNode({
          id: `agent-flow:${graphRunId}`,
          kind: 'agent-flow',
          title: runtimeAgentFlowExecution.label ?? childSession?.title ?? 'Sub AgentFlow',
          subtitle: `${graphRunId} / ${runtimeFlowStatus}`,
          detail: compactGraphText(runtimeAgentFlowExecution.lastOutput) || 'Live AgentFlow runtime',
          status: statusFromRuntimeChildExecution(runtimeAgentFlowExecution.status),
          column: branchColumn,
          row: flowRow,
          sessionId: runtimeAgentFlowExecution.childSessionId,
          callId,
          payload: {
            kind: 'agent-flow',
            childExecutionKind: 'sub_agentflow',
            result: null,
            childSessionId: runtimeAgentFlowExecution.childSessionId,
            graphRunId,
            inputPrompt: extractSubagentContextPrompt(snapshot.args),
          },
        });
        addEdge(sourceNodeId, flowNode.id);
        outcomeIds.push(flowNode.id);
        maxRow = flowRow;

        const nestedMaxRow = renderNestedSessionTurns(
          flowNode.id,
          runtimeAgentFlowExecution.childSessionId,
          flowRow,
          branchColumn + 1,
        );
        if (nestedMaxRow >= flowRow) {
          maxRow = Math.max(maxRow, nestedMaxRow);
        }

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
          status: statusFromActivity(snapshot.activity, true, snapshot.result, snapshot.toolName),
          column: branchColumn,
          row: branchStartRow,
          callId,
          payload: { kind: 'artifact', artifact },
        });
        addEdge(sourceNodeId, artifactNode.id);
        outcomeIds.push(artifactNode.id);
        maxRow = branchStartRow;
      }

      if ((snapshot.toolName === 'run_subagent' || snapshot.toolName === 'spawn_subagent' || snapshot.toolName === 'message_subagent')
        && snapshot.result != null) {
        const fallbackNode = addNode({
          id: `tool-result:${callId}`,
          kind: 'tool-result',
          title: 'Unparsed child result',
          subtitle: snapshot.toolName,
          detail: 'Kalio received a child-agent tool result, but it did not include a recognized childSessionId/result payload.',
          status: 'error',
          column: branchColumn,
          row: branchStartRow,
          callId,
          payload: {
            kind: 'tool-result',
            toolName: snapshot.toolName,
            result: snapshot.result,
            reason: 'Unrecognized child-agent result shape',
          },
        });
        addEdge(sourceNodeId, fallbackNode.id, 'dashed');
        outcomeIds.push(fallbackNode.id);
        maxRow = branchStartRow;
      }

      return { outcomeIds, maxRow };
    };

    let maxRow = startRow;
    const outcomeIds: string[] = [];

    if (collapseTools && graphToolItems.length > 1) {
      const groupedTools = graphToolItems.map((item) => {
        const snapshot = toolSnapshots.get(item.callId);
        return {
          callId: item.callId,
          toolName: snapshot?.toolName ?? 'tool',
          args: snapshot?.args ?? {},
          status: statusFromActivity(snapshot?.activity ?? null, snapshot?.result != null, snapshot?.result, snapshot?.toolName),
          result: snapshot?.result ?? null,
          confirmationRequired: snapshot?.activity?.status === 'awaiting_confirmation',
        };
      });

      const groupStatus: ExecutionGraphNodeStatus = groupedTools.some((tool) => tool.status === 'error')
        ? 'error'
        : groupedTools.some((tool) => tool.status === 'waiting')
          ? 'waiting'
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
      addEdge(turnSourceNodeId, groupNode.id);
      maxRow = Math.max(maxRow, groupNode.row);

      let nextOutcomeRow = groupNode.row + 1;
      graphToolItems.forEach((item) => {
        const outcome = renderOutcomes(item.callId, groupNode.id, nextOutcomeRow, baseColumn + 1);
        outcomeIds.push(...outcome.outcomeIds);
        if (outcome.maxRow >= nextOutcomeRow) {
          maxRow = Math.max(maxRow, outcome.maxRow);
          nextOutcomeRow = outcome.maxRow + 1;
        }
      });
    } else {
      graphToolItems.forEach((item, index) => {
        const snapshot = toolSnapshots.get(item.callId);
        const branchLabel = architectureBranchLabel(snapshot);
        const toolRow = startRow + index + 1;
        const toolNode = addNode({
          id: `tool:${item.callId}`,
          kind: 'tool',
          title: branchLabel ? `${branchLabel} branch` : snapshot?.toolName ?? 'Tool call',
          subtitle: branchLabel
            ? 'Architecture branch'
            : snapshot?.activity?.status === 'awaiting_confirmation'
            ? 'Awaiting confirmation'
            : snapshot?.activity?.status === 'running'
              ? 'Running'
              : 'Execution step',
          detail: snapshot?.activity?.status === 'awaiting_confirmation'
            ? 'Accept required before this branch can continue'
            : branchLabel
              ? undefined
              : visibleArgNames(snapshot?.args ?? {}) || undefined,
          status: statusFromActivity(snapshot?.activity ?? null, snapshot?.result != null, snapshot?.result, snapshot?.toolName),
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
        addEdge(turnSourceNodeId, toolNode.id);
        maxRow = Math.max(maxRow, toolRow);

        const outcome = renderOutcomes(item.callId, toolNode.id, toolRow + 1, baseColumn + 1);
        outcomeIds.push(...outcome.outcomeIds);
        if (outcome.maxRow >= toolRow + 1) {
          maxRow = Math.max(maxRow, outcome.maxRow);
        }
      });
    }

    const finalRenderableMessage = workflowEnvelopeMessage ?? finalMessage;
    if (finalRenderableMessage) {
      const branchMaxColumn = nodes
        .filter((node) => node.turnId === turn.id)
        .reduce((value, node) => Math.max(value, node.column), turnSourceColumn);
      const turnArchitectureRun = finalRenderableMessage.architectureRun
        ? null
        : workflowTurnProjection.architectureRun;
      const architectureProjection = renderArchitectureRunProjection({
        addEdge,
        addNode,
        architectureRun: turnArchitectureRun,
        branchMaxColumn,
        finalMessage: finalRenderableMessage,
        startRow,
        turn,
        turnNodeId: turnSourceNodeId,
      });
      maxRow = Math.max(maxRow, architectureProjection.maxRow);

      const finalNode = addNode({
        id: `final:${turn.id}`,
        kind: 'final-answer',
        title: 'Final response',
        subtitle: 'Last chat reply',
        detail: finalMessage?.content ?? finalRenderableMessage.content,
        status: turn.done ? 'success' : 'running',
        column: architectureProjection.finalColumn,
        row: startRow,
        turnId: turn.id,
        payload: {
          kind: 'final-answer',
          message: finalMessage ?? finalRenderableMessage,
          turn,
        },
      });
      addEdge(architectureProjection.finalSourceId, finalNode.id);
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
