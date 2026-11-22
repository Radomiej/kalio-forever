import type { ArchitectureSchemaEdge, ArchitectureSchemaNode } from '@kalio/types';

export function isStatusRoutingConfig(value: unknown): value is NonNullable<ArchitectureSchemaNode['statusRouting']> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const config = value as Record<string, unknown>;
  return Object.keys(config).length === 2
    && typeof config.sourceNodeId === 'string' && config.sourceNodeId.trim().length > 0
    && (config.expectedStatus === 'completed' || config.expectedStatus === 'failed');
}

// Keep aligned with Architect's status routing validation.
export function hasValidStatusRoutingTopology(nodes: ArchitectureSchemaNode[], edges: ArchitectureSchemaEdge[]): boolean {
  return nodes.every(node => {
    if (node.kind !== 'status_router') return node.statusRouting === undefined;
    if (!isStatusRoutingConfig(node.statusRouting) || node.roleSlotId !== undefined
      || node.autoRouting !== undefined || node.toolOverride !== undefined || node.behavior !== undefined) return false;
    const source = nodes.find(candidate => candidate.id === node.statusRouting?.sourceNodeId);
    const sourceOutgoing = edges.filter(edge => edge.fromNodeId === source?.id);
    const incoming = edges.filter(edge => edge.toNodeId === node.id);
    const outgoing = edges.filter(edge => edge.fromNodeId === node.id);
    return source?.kind === 'role' && source.roleSlotId !== undefined
      && sourceOutgoing.length === 1 && sourceOutgoing[0]?.toNodeId === node.id
      && incoming.length === 1 && incoming[0]?.fromNodeId === source.id
      && outgoing.length === 2
      && outgoing.filter(edge => edge.selection === 'choice').length === 1
      && outgoing.filter(edge => edge.selection === 'default').length === 1
      && new Set(outgoing.map(edge => edge.toNodeId)).size === 2
      && outgoing.every(edge => edge.toNodeId !== node.id);
  });
}
