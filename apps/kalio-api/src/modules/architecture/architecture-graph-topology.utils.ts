import type { ArchitectureExecutionEvent, ArchitectureSchema, ArchitectureSchemaEdge, ArchitectureSchemaNode } from '@kalio/types';

type IncomingNodeIdsInput = {
  schema: ArchitectureSchema;
  nodeId: string;
  fallback?: Map<string, string[]>;
  activeNodeIds: Set<string>;
  activeIncomingNodeIds: Map<string, Set<string>>;
};

type NodeReadyInput = IncomingNodeIdsInput & {
  visitCount: (nodeId: string) => number;
};

export function selectedNodeIdsFromEvent(event: ArchitectureExecutionEvent): string[] {
  const selected = event.route?.selectedNodeIds ?? event.data?.['selectedNodeIds'];
  return Array.isArray(selected)
    ? selected.filter((nodeId): nodeId is string => typeof nodeId === 'string' && nodeId.length > 0)
    : [];
}

export function rootArchitectureNodes(
  schema: ArchitectureSchema,
  incoming: Map<string, string[]>,
): ArchitectureSchemaNode[] {
  const roots = schema.nodes.filter((node) => (incoming.get(node.id) ?? []).length === 0);
  return roots.length > 0 ? roots : schema.nodes.slice(0, 1);
}

export function groupArchitectureEdges(
  schema: ArchitectureSchema,
  key: 'fromNodeId' | 'toNodeId',
): Map<string, string[]> {
  const groups = new Map<string, string[]>();
  for (const edge of schema.edges) {
    const source = edge[key];
    const target = key === 'fromNodeId' ? edge.toNodeId : edge.fromNodeId;
    groups.set(source, [...(groups.get(source) ?? []), target]);
  }
  return groups;
}

export function returnToOrchestratorNodeIds(input: {
  schema: ArchitectureSchema;
  fromNodeId: string;
  selectedNodeIds: string[];
  pauseEnabled: boolean;
}): string[] {
  if (input.selectedNodeIds.length === 0 || !input.pauseEnabled) {
    return [];
  }
  const selected = new Set(input.selectedNodeIds);
  return input.schema.edges
    .filter((edge): edge is ArchitectureSchemaEdge & { returnToOrchestrator: true } =>
      edge.fromNodeId === input.fromNodeId
      && selected.has(edge.toNodeId)
      && edge.returnToOrchestrator === true)
    .map((edge) => edge.toNodeId);
}

export function isNodeReady(input: NodeReadyInput): boolean {
  const incomingNodeIds = incomingNodeIdsFor(input);
  return incomingNodeIds.length === 0 || incomingNodeIds.every((incomingNodeId) => input.visitCount(incomingNodeId) > 0);
}

export function incomingNodeIdsFor(input: IncomingNodeIdsInput): string[] {
  const staticIncoming = input.fallback?.get(input.nodeId) ?? input.schema.edges
    .filter((edge) => edge.toNodeId === input.nodeId)
    .map((edge) => edge.fromNodeId);
  const activeIncoming = staticIncoming.filter((incomingNodeId) => input.activeNodeIds.has(incomingNodeId));
  if (activeIncoming.length > 0) {
    return activeIncoming;
  }
  const explicitIncoming = input.activeIncomingNodeIds.get(input.nodeId);
  return explicitIncoming ? Array.from(explicitIncoming) : staticIncoming;
}

export function markActiveIncoming(
  activeIncomingNodeIds: Map<string, Set<string>>,
  nodeId: string,
  fromNodeId: string,
): void {
  const incoming = activeIncomingNodeIds.get(nodeId) ?? new Set<string>();
  incoming.add(fromNodeId);
  activeIncomingNodeIds.set(nodeId, incoming);
}
