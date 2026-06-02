import type { ArchitectureContextPolicyOverride, ArchitectureNodeKind, ArchitectureSchemaNode } from '@kalio/types';
import type { ArchitectNode, ArchitectSchema, NodeBehaviorOverrideMap, NodeKindOverrideMap } from './architect.types';

export interface GraphDraft {
  nodePositions: Record<string, { x: number; y: number }>;
  nodeBehaviors: NodeBehaviorOverrideMap;
  addedNodes: ArchitectNode[];
  edges: ArchitectSchema['edges'] | null;
}

export const EMPTY_GRAPH_DRAFT: GraphDraft = {
  nodePositions: {},
  nodeBehaviors: {},
  addedNodes: [],
  edges: null,
};

export function chooseInitialSchema(schemas: ArchitectSchema[]): string | null {
  const seeded = schemas.find((schema) => (
    schema.id.toLowerCase().includes('strategic-decision-council')
    || schema.name.toLowerCase().includes('strategic decision council')
  ));
  return (seeded ?? schemas[0])?.id ?? null;
}

export function findNode(schema: ArchitectSchema | null, nodeId: string | null): ArchitectNode | null {
  if (!schema || !nodeId) {
    return null;
  }
  return schema.nodes.find((node) => node.id === nodeId) ?? null;
}

export function applyGraphDraft(
  schema: ArchitectSchema | null,
  kindOverrides: NodeKindOverrideMap,
  graphDraft: GraphDraft,
  contextPolicyOverrides: Record<string, ArchitectureContextPolicyOverride> = {},
): ArchitectSchema | null {
  if (!schema) {
    return schema;
  }
  return {
    ...schema,
    roleSlots: [
      ...schema.roleSlots,
      ...graphDraft.addedNodes.flatMap((node) => {
        if (node.kind !== 'role' || !node.roleSlotId || schema.roleSlots.some((slot) => slot.id === node.roleSlotId)) {
          return [];
        }
        return {
          id: node.roleSlotId,
          label: node.label,
          description: `Generated agent slot for ${node.label}.`,
          slotType: 'participant' as const,
          defaultPersonaId: 'default',
          allowedPersonaTags: ['custom'],
          required: true,
          canOverrideAtRunStart: true,
        };
      }),
    ],
    nodes: schema.nodes.map((node) => ({
      ...node,
      ...(graphDraft.nodePositions[node.id] ?? {}),
      kind: kindOverrides[node.id] ?? node.kind,
      behavior: graphDraft.nodeBehaviors[node.id] ?? node.behavior,
    })).concat(graphDraft.addedNodes.map((node) => ({
      ...node,
      ...(graphDraft.nodePositions[node.id] ?? {}),
      kind: kindOverrides[node.id] ?? node.kind,
      behavior: graphDraft.nodeBehaviors[node.id] ?? node.behavior,
    }))),
    edges: graphDraft.edges ?? schema.edges,
    contextPolicy: {
      ...schema.contextPolicy,
      perSlotOverrides: {
        ...(schema.contextPolicy.perSlotOverrides ?? {}),
        ...contextPolicyOverrides,
      },
    },
  };
}

export function toSchemaNodes(schema: ArchitectSchema): ArchitectureSchemaNode[] {
  return schema.nodes.map((node) => ({
    id: node.id,
    label: node.label,
    kind: node.kind,
    roleSlotId: node.roleSlotId,
    behavior: node.behavior ? { ...node.behavior } : undefined,
    x: node.x,
    y: node.y,
  }));
}

export function createDraftNode(
  existingNodes: ArchitectNode[],
  position: { x: number; y: number },
  kind: ArchitectureNodeKind = 'role',
): ArchitectNode {
  let index = existingNodes.length + 1;
  let id = `custom-node-${index}`;
  const ids = new Set(existingNodes.map((node) => node.id));
  while (ids.has(id)) {
    index += 1;
    id = `custom-node-${index}`;
  }
  const roundedPosition = {
    x: Math.round(position.x),
    y: Math.round(position.y),
  };
  if (kind === 'router') {
    return {
      id,
      label: `Router ${index}`,
      kind,
      behavior: { mode: 'choose_one', fanOut: 'sequential', maxBranches: 1, scoringPolicy: 'confidence' },
      ...roundedPosition,
      slots: [],
      connections: [],
    };
  }
  if (kind === 'parallel') {
    return {
      id,
      label: `Parallel Router ${index}`,
      kind,
      behavior: { mode: 'fan_out_all', fanOut: 'parallel' },
      ...roundedPosition,
      slots: [],
      connections: [],
    };
  }
  if (kind === 'artifact') {
    return {
      id,
      label: `Artifact ${index}`,
      kind,
      behavior: { mode: 'finalize' },
      ...roundedPosition,
      slots: [],
      connections: [],
    };
  }
  return {
    id,
    label: `Custom Node ${index}`,
    kind,
    roleSlotId: id,
    ...roundedPosition,
    slots: [{ id, label: `Agent ${index}`, slotType: 'participant', defaultPersonaId: 'default' }],
    connections: [],
  };
}

export function toggleEdge(
  schema: ArchitectSchema,
  currentEdges: ArchitectSchema['edges'] | null,
  fromNodeId: string,
  toNodeId: string,
): ArchitectSchema['edges'] {
  const sourceEdges = currentEdges ?? schema.edges;
  const existing = sourceEdges.find((edge) => edge.fromNodeId === fromNodeId && edge.toNodeId === toNodeId);
  if (existing) {
    return sourceEdges.filter((edge) => edge.id !== existing.id);
  }
  const baseId = `${fromNodeId}-${toNodeId}`;
  const ids = new Set(sourceEdges.map((edge) => edge.id));
  let id = baseId;
  let suffix = 2;
  while (ids.has(id)) {
    id = `${baseId}-${suffix}`;
    suffix += 1;
  }
  return [...sourceEdges, { id, fromNodeId, toNodeId }];
}
