import type {
  ArchitectureGraphProjection,
  ArchitectureRunStatus,
  ChatMessage,
  ChatSession,
} from '@kalio/types';
import { applyGraphNodeLayout, estimateGraphNodeHeight } from './executionGraphNodePresentation';
import type { ExecutionGraphModel, ExecutionGraphNode } from './executionGraphModel.types';

type ArchitectureGraphProjectionNode = ArchitectureGraphProjection['nodes'][number];
type ToolEvidence = {
  toolCallCount: number;
  toolResultCount: number;
  toolNames: string[];
  successfulToolNames: string[];
};

export function architectureRunIdFromRootSession(sessionId: string | null): string | null {
  const match = sessionId?.match(/^arch-(.+)-root$/);
  return match?.[1] ?? null;
}

export function buildArchitectureRootGraphModel(input: {
  graph: ArchitectureGraphProjection;
  rootSessionId: string;
  sessions: ChatSession[];
  sessionMessages: Record<string, ChatMessage[]>;
}): ExecutionGraphModel {
  const branchSessionByNodeId = branchSessionMap(input.graph.runId, input.rootSessionId, input.sessions);
  const layout = architectureNodeLayout(input.graph);
  const nodes = input.graph.nodes.map((node, index) => toExecutionNode({
    node,
    index,
    graph: input.graph,
    layout: layout.get(node.id),
    branchSessionId: branchSessionByNodeId.get(normalizeNodeId(node.id)),
    branchMessages: input.sessionMessages[branchSessionByNodeId.get(normalizeNodeId(node.id)) ?? ''] ?? [],
  }));
  const knownNodeIds = new Set(nodes.map((node) => node.id));
  const edges = input.graph.edges
    .filter((edge) => knownNodeIds.has(`architecture-root:${edge.fromNodeId}`) && knownNodeIds.has(`architecture-root:${edge.toNodeId}`))
    .map((edge) => ({
      id: `architecture-root-edge:${edge.id}`,
      sourceId: `architecture-root:${edge.fromNodeId}`,
      targetId: `architecture-root:${edge.toNodeId}`,
      style: 'solid' as const,
    }));
  const board = applyGraphNodeLayout(nodes);

  return {
    nodes,
    edges,
    board,
    defaultSelectedNodeId: nodes[0]?.id ?? null,
  };
}

function toExecutionNode(input: {
  node: ArchitectureGraphProjectionNode;
  index: number;
  graph: ArchitectureGraphProjection;
  layout?: { column: number; row: number };
  branchSessionId?: string;
  branchMessages: ChatMessage[];
}): ExecutionGraphNode {
  const { node, graph, branchSessionId, branchMessages } = input;
  const openableBranchSessionId = node.kind === 'role' ? branchSessionId : undefined;
  const toolEvidence = extractToolEvidence(node);
  const incompleteReason = extractIncompleteReason(node);
  const routeHops = graph.routeHops ?? [];
  const matchingHops = routeHops.filter((hop) => hop.fromNodeId === node.id || hop.toNodeId === node.id);
  const summary = {
    runId: graph.runId,
    schemaId: graph.schemaName ?? graph.schemaId ?? 'architecture-run',
    status: graph.status ?? graphStatus(graph.nodes),
    trace: node.eventIds.map((eventId) => ({
      speaker: node.kind === 'artifact' ? 'finalizer' as const : node.kind === 'router' ? 'router' as const : 'participant' as const,
      content: branchMessages.map((message) => message.content).filter(Boolean).join('\n'),
      eventId,
      nodeId: node.id,
      nextNodeId: matchingHops.find((hop) => hop.fromNodeId === node.id)?.toNodeId,
      stream: openableBranchSessionId ? {
        streamGroupId: graph.runId,
        branchSessionId: openableBranchSessionId,
        status: node.status === 'completed' ? 'completed' as const : 'started' as const,
        chunkCount: branchMessages.length,
        text: branchMessages.map((message) => message.content).filter(Boolean).join('\n'),
      } : undefined,
    })),
    routeHops,
  };
  const executionNode: ExecutionGraphNode = {
    id: `architecture-root:${node.id}`,
    kind: node.kind === 'artifact' ? 'artifact' : 'architecture-run',
    title: node.label,
    subtitle: [
      node.kind,
      node.status,
      openableBranchSessionId ? 'branch session' : undefined,
    ].filter(Boolean).join(' / '),
    detail: [
      node.behavior?.mode?.replaceAll('_', ' '),
      incompleteReason ? 'incomplete' : undefined,
      openableBranchSessionId && branchMessages.length > 0 ? `${branchMessages.length} branch messages loaded` : undefined,
      node.eventIds.length > 0 ? `${node.eventIds.length} events` : undefined,
    ].filter(Boolean).join(' - '),
    status: executionStatusFromArchitectureStatus(graph.status, node.status),
    column: input.layout?.column ?? graphColumn(node, input.index),
    row: input.layout?.row ?? graphRow(node, input.index),
    x: 0,
    y: 0,
    width: 260,
    height: 260,
    sessionId: openableBranchSessionId,
    payload: {
      kind: 'architecture-run',
      summary,
      route: matchingHops[0] ? {
        eventId: matchingHops[0].eventId,
        source: matchingHops[0].source,
        fromNodeId: matchingHops[0].fromNodeId,
        toNodeId: matchingHops[0].toNodeId,
        branchSessionOpenable: Boolean(openableBranchSessionId),
        branchSessionId: openableBranchSessionId,
        chunkCount: branchMessages.length,
        streamStatus: node.status,
        contentPreview: branchMessages.find((message) => message.content.trim().length > 0)?.content,
        incompleteReason,
        toolEvidence,
      } : undefined,
    },
  };
  executionNode.height = estimateGraphNodeHeight(executionNode);
  return executionNode;
}

function architectureNodeLayout(graph: ArchitectureGraphProjection): Map<string, { column: number; row: number }> {
  const orderedNodeIds = routeOrderedNodeIds(graph);
  const routeColumnByNodeId = new Map<string, number>();
  orderedNodeIds.forEach((nodeId, index) => routeColumnByNodeId.set(nodeId, index));

  const fallbackColumns = graphColumnByDagLevel(graph);
  const columnGroups = new Map<number, string[]>();

  graph.nodes.forEach((node, index) => {
    const column = routeColumnByNodeId.get(node.id) ?? fallbackColumns.get(node.id) ?? graphColumn(node, index);
    columnGroups.set(column, [...(columnGroups.get(column) ?? []), node.id]);
  });

  const layout = new Map<string, { column: number; row: number }>();
  columnGroups.forEach((nodeIds, column) => {
    nodeIds.forEach((nodeId, row) => layout.set(nodeId, { column, row }));
  });
  return layout;
}

function routeOrderedNodeIds(graph: ArchitectureGraphProjection): string[] {
  const order: string[] = [];
  const seen = new Set<string>();
  const add = (nodeId: string) => {
    if (!seen.has(nodeId)) {
      seen.add(nodeId);
      order.push(nodeId);
    }
  };

  graph.routeHops?.forEach((hop) => {
    add(hop.fromNodeId);
    add(hop.toNodeId);
  });

  return order;
}

function graphColumnByDagLevel(graph: ArchitectureGraphProjection): Map<string, number> {
  const nodeIds = new Set(graph.nodes.map((node) => node.id));
  const columns = new Map<string, number>();
  const incoming = new Map<string, number>();
  const outgoing = new Map<string, string[]>();

  graph.nodes.forEach((node) => {
    incoming.set(node.id, 0);
    outgoing.set(node.id, []);
  });

  graph.edges.forEach((edge) => {
    if (!nodeIds.has(edge.fromNodeId) || !nodeIds.has(edge.toNodeId)) return;
    outgoing.set(edge.fromNodeId, [...(outgoing.get(edge.fromNodeId) ?? []), edge.toNodeId]);
    incoming.set(edge.toNodeId, (incoming.get(edge.toNodeId) ?? 0) + 1);
  });

  const queue = graph.nodes
    .filter((node) => (incoming.get(node.id) ?? 0) === 0)
    .map((node) => node.id);

  queue.forEach((nodeId) => columns.set(nodeId, 0));

  for (let index = 0; index < queue.length; index += 1) {
    const nodeId = queue[index];
    const nextColumn = (columns.get(nodeId) ?? 0) + 1;
    for (const targetId of outgoing.get(nodeId) ?? []) {
      columns.set(targetId, Math.max(columns.get(targetId) ?? 0, nextColumn));
      incoming.set(targetId, Math.max(0, (incoming.get(targetId) ?? 0) - 1));
      if (incoming.get(targetId) === 0) {
        queue.push(targetId);
      }
    }
  }

  return columns;
}

function extractIncompleteReason(node: ArchitectureGraphProjectionNode): string | undefined {
  const value = node.incompleteReason;
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function extractToolEvidence(node: ArchitectureGraphProjectionNode): ToolEvidence | undefined {
  const value = node.toolEvidence;
  if (!value) return undefined;
  return {
    toolCallCount: numericValue(value.toolCallCount),
    toolResultCount: numericValue(value.toolResultCount),
    toolNames: stringArray(value.toolNames),
    successfulToolNames: stringArray(value.successfulToolNames),
  };
}

function numericValue(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function branchSessionMap(runId: string, rootSessionId: string, sessions: ChatSession[]): Map<string, string> {
  const pairs = sessions
    .filter((session) => session.kind === 'subagent' && session.parentSessionId === rootSessionId && session.id.startsWith(`arch-${runId}-`))
    .map((session): [string, string] => [normalizeNodeId(session.id.replace(`arch-${runId}-`, '')), session.id]);
  return new Map(pairs);
}

function normalizeNodeId(value: string): string {
  return value.replace(/_/g, '-');
}

function graphStatus(nodes: ArchitectureGraphProjectionNode[]): ArchitectureRunStatus {
  if (nodes.every((node) => node.status === 'completed')) {
    return 'completed';
  }
  return 'running';
}

function executionStatusFromArchitectureStatus(status: ArchitectureRunStatus | undefined, nodeStatus: ArchitectureGraphProjectionNode['status']) {
  if (status === 'failed' || status === 'cancelled') return 'error' as const;
  if (status === 'completed') return 'success' as const;
  if (status === 'running' && nodeStatus === 'completed') return 'success' as const;
  if (status === 'running') return 'running' as const;
  return nodeStatus === 'completed' ? 'success' as const : 'idle' as const;
}

function graphColumn(node: ArchitectureGraphProjectionNode, index: number): number {
  if (node.kind === 'parallel') return 0;
  if (node.kind === 'role') return 1;
  if (node.kind === 'router') return 2;
  if (node.kind === 'artifact') return 3;
  return Math.min(3, index);
}

function graphRow(node: ArchitectureGraphProjectionNode, index: number): number {
  if (node.kind !== 'role') {
    return 0;
  }
  return Math.max(0, index - 1);
}
