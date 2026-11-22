import type { ArchitectureSchema, ArchitectureSchemaNode } from '@kalio/types';

// Keep these schema rules aligned with the backend status-routing validator.
export function readStatusRoutingConfig(value: unknown): ArchitectureSchemaNode['statusRouting'] {
  if (value === undefined) return undefined;
  if (typeof value !== 'object' || value === null || Array.isArray(value)
    || Object.keys(value).length !== 2
    || !('sourceNodeId' in value) || typeof value.sourceNodeId !== 'string' || !value.sourceNodeId.trim()
    || !('expectedStatus' in value) || (value.expectedStatus !== 'completed' && value.expectedStatus !== 'failed')) {
    throw new Error('Status condition requires a source node and expected status completed or failed.');
  }
  return { sourceNodeId: value.sourceNodeId, expectedStatus: value.expectedStatus };
}

export function validateArchitectStatusRouting(schema: Pick<ArchitectureSchema, 'nodes' | 'edges'>): void {
  for (const node of schema.nodes) {
    const config = readStatusRoutingConfig(node.statusRouting);
    if (node.kind !== 'status_router') {
      if (config) throw new Error(`Status-routing settings require a status_router node: ${node.id}`);
      continue;
    }
    if (!config || config.sourceNodeId === node.id || !schema.nodes.some((source) => source.id === config.sourceNodeId)) {
      throw new Error(`Status condition ${node.id} requires another existing source node.`);
    }
    const source = schema.nodes.find((candidate) => candidate.id === config.sourceNodeId);
    const sourceOutgoing = schema.edges.filter((edge) => edge.fromNodeId === config.sourceNodeId);
    const incoming = schema.edges.filter((edge) => edge.toNodeId === node.id);
    if (source?.kind !== 'role' || source.roleSlotId === undefined
      || sourceOutgoing.length !== 1 || sourceOutgoing[0]?.toNodeId !== node.id
      || incoming.length !== 1 || incoming[0]?.fromNodeId !== source.id) {
      throw new Error(`Status condition ${node.id} requires exactly one incoming edge from its source role node.`);
    }
    if (node.roleSlotId !== undefined || node.autoRouting !== undefined || node.behavior !== undefined || node.toolOverride !== undefined) throw new Error(`Status conditions cannot own a role slot: ${node.id}`);
    const outgoing = schema.edges.filter((edge) => edge.fromNodeId === node.id);
    if (outgoing.filter((edge) => edge.selection === 'choice').length !== 1
      || outgoing.filter((edge) => edge.selection === 'default').length !== 1 || outgoing.length !== 2
      || new Set(outgoing.map((edge) => edge.toNodeId)).size !== 2
      || outgoing.some((edge) => edge.toNodeId === node.id)) {
      throw new Error(`Status condition ${node.id} requires exactly one Yes (choice) and one Else (default) route.`);
    }
  }
}
