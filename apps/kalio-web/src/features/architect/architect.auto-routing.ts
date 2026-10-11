import type { ArchitectureSchema, ArchitectureSchemaNode } from '@kalio/types';

// Keep these schema rules aligned with architecture-runtime-schema.utils.ts.
export function readAutoRoutingConfig(value: unknown): ArchitectureSchemaNode['autoRouting'] {
  if (value === undefined) return undefined;
  if (typeof value !== 'object' || value === null || Array.isArray(value)
    || !('confidenceThreshold' in value) || !('instructions' in value)
    || typeof value.confidenceThreshold !== 'number' || !Number.isFinite(value.confidenceThreshold)
    || value.confidenceThreshold < 0 || value.confidenceThreshold > 1
    || typeof value.instructions !== 'string' || value.instructions.length > 2_000) {
    throw new Error('Auto-routing requires a finite confidence threshold from 0 to 1 and instructions up to 2000 characters.');
  }
  return { confidenceThreshold: value.confidenceThreshold, instructions: value.instructions };
}

export function validateArchitectAutoRouting(schema: Pick<ArchitectureSchema, 'nodes' | 'edges'>): void {
  for (const node of schema.nodes) {
    readAutoRoutingConfig(node.autoRouting);
    if (node.kind !== 'auto_router') {
      if (node.autoRouting !== undefined) throw new Error(`Auto-routing settings require an auto_router node: ${node.id}`);
      continue;
    }
    if (node.roleSlotId !== undefined) throw new Error(`Auto-routing nodes cannot own a role slot: ${node.id}`);
    const outgoing = schema.edges.filter((edge) => edge.fromNodeId === node.id);
    if (outgoing.filter((edge) => edge.selection === 'default').length !== 1
      || !outgoing.some((edge) => edge.selection === 'choice')
      || outgoing.some((edge) => edge.selection !== 'default' && edge.selection !== 'choice')) {
      throw new Error(`Auto-routing node ${node.id} requires at least one choice and exactly one default route.`);
    }
  }
}
