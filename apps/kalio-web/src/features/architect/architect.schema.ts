import type { ArchitectNode, ArchitectSchema, ArchitectSlot } from './architect.types';
import type {
  ArchitectureNodeBehaviorMode,
  ArchitectureNodeFanOutMode,
  ArchitectureNodeKind,
  ArchitectureNodeScoringPolicy,
  ArchitectureContextPolicy,
  ArchitectureRoleSlot,
  ArchitectureSchemaEdge,
} from '@kalio/types';
import { layoutMissingNodePositions } from './ArchitectGraphLayout';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readString(record: Record<string, unknown>, keys: string[], fallback: string): string;
function readString(record: Record<string, unknown>, keys: string[], fallback?: undefined): string | undefined;
function readString(record: Record<string, unknown>, keys: string[], fallback?: string): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) {
      return value;
    }
  }
  return fallback;
}

function readNumber(record: Record<string, unknown>, key: string, fallback: number): number {
  const value = record[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function hasFiniteNumber(record: Record<string, unknown>, key: string): boolean {
  const value = record[key];
  return typeof value === 'number' && Number.isFinite(value);
}

function normalizeSlot(raw: unknown, index: number): ArchitectSlot {
  if (!isRecord(raw)) {
    return { id: `slot-${index + 1}`, label: `Slot ${index + 1}` };
  }

  const id = readString(raw, ['id', 'key', 'name'], `slot-${index + 1}`);
  return {
    id,
    label: readString(raw, ['label', 'name', 'title'], id),
    kind: readString(raw, ['kind', 'type'], undefined),
    slotType: readSlotType(readString(raw, ['slotType', 'kind', 'type'], undefined)),
    defaultPersonaId: readString(raw, ['defaultPersonaId', 'personaId', 'persona'], undefined),
    allowedPersonaTags: readStringArray(raw, 'allowedPersonaTags'),
    required: readBoolean(raw, 'required', undefined),
    canOverrideAtRunStart: readBoolean(raw, 'canOverrideAtRunStart', undefined),
    description: readString(raw, ['description', 'summary'], undefined),
  };
}

function readStringArray(record: Record<string, unknown>, key: string): string[] | undefined {
  const value = record[key];
  if (!Array.isArray(value)) {
    return undefined;
  }
  const strings = value.filter((item): item is string => typeof item === 'string');
  return strings.length > 0 ? strings : undefined;
}

function readBoolean(record: Record<string, unknown>, key: string, fallback: boolean | undefined): boolean | undefined {
  const value = record[key];
  return typeof value === 'boolean' ? value : fallback;
}

function readNodeKind(value: string | undefined): ArchitectureNodeKind {
  if (value === 'parallel' || value === 'role' || value === 'router' || value === 'artifact') {
    return value;
  }
  return 'role';
}

function readNodeBehaviorMode(value: string | undefined): ArchitectureNodeBehaviorMode | undefined {
  if (
    value === 'fan_out_all'
    || value === 'choose_one'
    || value === 'rank_then_merge'
    || value === 'merge_inputs'
    || value === 'finalize'
  ) {
    return value;
  }
  return undefined;
}

function readFanOutMode(value: string | undefined): ArchitectureNodeFanOutMode | undefined {
  return value === 'parallel' || value === 'sequential' ? value : undefined;
}

function readScoringPolicy(value: string | undefined): ArchitectureNodeScoringPolicy | undefined {
  if (value === 'confidence' || value === 'risk' || value === 'cost' || value === 'custom') {
    return value;
  }
  return undefined;
}

function readContextCompression(value: unknown): ArchitectureContextPolicy['contextCompression'] | undefined {
  return value === 'none' || value === 'summary' || value === 'evidence_only' ? value : undefined;
}

function readContextPolicy(raw: Record<string, unknown>): ArchitectureContextPolicy {
  const value = raw['contextPolicy'];
  if (!isRecord(value)) {
    return defaultContextPolicy();
  }
  const perSlotOverrides = isRecord(value['perSlotOverrides'])
    ? Object.fromEntries(Object.entries(value['perSlotOverrides']).flatMap(([slotId, override]) => {
        if (!isRecord(override)) {
          return [];
        }
        return [[slotId, {
          includeUserTask: readBoolean(override, 'includeUserTask', undefined),
          includeProjectMemory: readBoolean(override, 'includeProjectMemory', undefined),
          includeBrowserSession: readBoolean(override, 'includeBrowserSession', undefined),
          includePriorDecisions: readBoolean(override, 'includePriorDecisions', undefined),
          includeOtherAgentOutputs: readBoolean(override, 'includeOtherAgentOutputs', undefined),
          includeToolResults: readBoolean(override, 'includeToolResults', undefined),
          contextCompression: readContextCompression(override['contextCompression']),
        }]];
      }))
    : undefined;
  return {
    includeUserTask: readBoolean(value, 'includeUserTask', true) ?? true,
    includeProjectMemory: readBoolean(value, 'includeProjectMemory', false) ?? false,
    includeBrowserSession: readBoolean(value, 'includeBrowserSession', false) ?? false,
    includePriorDecisions: readBoolean(value, 'includePriorDecisions', false) ?? false,
    includeOtherAgentOutputs: readBoolean(value, 'includeOtherAgentOutputs', undefined),
    includeToolResults: readBoolean(value, 'includeToolResults', undefined),
    contextCompression: readContextCompression(value['contextCompression']),
    perSlotOverrides,
  };
}

function defaultContextPolicy(): ArchitectureContextPolicy {
  return {
    includeUserTask: true,
    includeProjectMemory: false,
    includeBrowserSession: false,
    includePriorDecisions: false,
  };
}

function readNodeBehavior(raw: Record<string, unknown>): ArchitectNode['behavior'] | undefined {
  const value = raw['behavior'];
  if (!isRecord(value)) {
    return undefined;
  }
  const mode = readNodeBehaviorMode(readString(value, ['mode'], undefined));
  if (!mode) {
    return undefined;
  }
  return {
    mode,
    fanOut: readFanOutMode(readString(value, ['fanOut'], undefined)),
    maxBranches: readNumber(value, 'maxBranches', Number.NaN) || undefined,
    scoringPolicy: readScoringPolicy(readString(value, ['scoringPolicy'], undefined)),
    description: readString(value, ['description'], undefined),
  };
}

function readNodeToolOverride(raw: Record<string, unknown>): ArchitectNode['toolOverride'] | undefined {
  const value = raw['toolOverride'];
  if (!isRecord(value)) {
    return undefined;
  }
  const allowedToolNames = readStringArray(value, 'allowedToolNames')
    ?.map((name) => name.trim())
    .filter(Boolean);
  return allowedToolNames ? { allowedToolNames } : undefined;
}

function readSlotType(value: string | undefined): ArchitectureRoleSlot['slotType'] | undefined {
  if (
    value === 'participant'
    || value === 'router'
    || value === 'judge'
    || value === 'finalizer'
    || value === 'critic'
    || value === 'tool_executor'
  ) {
    return value;
  }
  return undefined;
}

function readConnections(raw: Record<string, unknown>): string[] {
  const source = raw['connections'] ?? raw['targets'] ?? raw['outgoing'];
  if (!Array.isArray(source)) {
    return [];
  }

  return source.flatMap((entry) => {
    if (typeof entry === 'string') {
      return [entry];
    }
    if (isRecord(entry)) {
      const target = readString(entry, ['target', 'targetId', 'to']);
      return target ? [target] : [];
    }
    return [];
  });
}

function normalizeNode(raw: unknown, index: number): ArchitectNode {
  if (!isRecord(raw)) {
    const id = `node-${index + 1}`;
    return { id, label: `Node ${index + 1}`, kind: 'role', x: 120 + index * 160, y: 120, slots: [], connections: [] };
  }

  const id = readString(raw, ['id', 'key'], `node-${index + 1}`);
  const slots = Array.isArray(raw['slots']) ? raw['slots'].map(normalizeSlot) : [];
  const roleSlotId = readString(raw, ['roleSlotId', 'slotId'], undefined);

  return {
    id,
    label: readString(raw, ['label', 'name', 'title'], id),
    kind: readNodeKind(readString(raw, ['kind', 'role', 'type'], undefined)),
    role: readString(raw, ['role', 'type'], undefined),
    roleSlotId,
    maxToolAttempts: hasFiniteNumber(raw, 'maxToolAttempts') ? readNumber(raw, 'maxToolAttempts', 0) : undefined,
    toolOverride: readNodeToolOverride(raw),
    behavior: readNodeBehavior(raw),
    personaId: readString(raw, ['personaId', 'persona', 'defaultPersonaId'], undefined),
    description: readString(raw, ['description', 'summary'], undefined),
    x: readNumber(raw, 'x', 120 + (index % 4) * 180),
    y: readNumber(raw, 'y', 90 + Math.floor(index / 4) * 160),
    slots,
    connections: readConnections(raw),
  };
}

function applyTopLevelEdges(schema: ArchitectSchema, raw: Record<string, unknown>): ArchitectSchema {
  if (!Array.isArray(raw['edges'])) {
    return schema;
  }

  const bySource = new Map<string, string[]>();
  const edges: ArchitectureSchemaEdge[] = [];
  for (const edge of raw['edges']) {
    if (!isRecord(edge)) {
      continue;
    }
    const source = readString(edge, ['source', 'sourceId', 'from', 'fromNodeId']);
    const target = readString(edge, ['target', 'targetId', 'to', 'toNodeId']);
    if (!source || !target) {
      continue;
    }
    edges.push({
      id: readString(edge, ['id'], `${source}-${target}`),
      fromNodeId: source,
      toNodeId: target,
      label: readString(edge, ['label'], undefined),
      selection: readEdgeSelection(readString(edge, ['selection'], undefined)),
      returnToOrchestrator: readBoolean(edge, 'returnToOrchestrator', undefined),
    });
    bySource.set(source, [...(bySource.get(source) ?? []), target]);
  }

  return {
    ...schema,
    edges,
    nodes: schema.nodes.map((node) => ({
      ...node,
      connections: [...new Set([...node.connections, ...(bySource.get(node.id) ?? [])])],
    })),
  };
}

function readEdgeSelection(value: string | undefined): ArchitectureSchemaEdge['selection'] | undefined {
  if (value === 'default' || value === 'converge' || value === 'continuation') {
    return value;
  }
  return undefined;
}

export function normalizeArchitectureSchema(raw: unknown, index = 0): ArchitectSchema {
  if (!isRecord(raw)) {
    return {
      id: `schema-${index + 1}`,
      name: `Schema ${index + 1}`,
      description: '',
      version: '0.0.0',
      roleSlots: [],
      nodes: [],
      edges: [],
      routerPolicy: {
        mode: 'rank_then_merge',
        mustAddressCriticFindings: false,
        canReturnNeedsMoreResearch: false,
      },
      contextPolicy: defaultContextPolicy(),
      memoryPolicy: {
        persistFinalArtifact: false,
        persistRouterDecision: false,
      },
      outputArtifactSchema: 'Artifact',
    };
  }

  const id = readString(raw, ['id', 'slug', 'key'], `schema-${index + 1}`);
  const roleSlots = Array.isArray(raw['roleSlots'])
    ? raw['roleSlots'].map((slot, slotIndex) => normalizeRoleSlot(slot, slotIndex))
    : [];
  const slotById = new Map(roleSlots.map((slot) => [slot.id, slot]));
  const rawNodes = Array.isArray(raw['nodes']) ? raw['nodes'] : [];
  const missingPositionIds = new Set<string>();
  const nodes = rawNodes.length > 0
    ? rawNodes.map((node, nodeIndex) => {
        const normalized = attachRoleSlot(normalizeNode(node, nodeIndex), slotById);
        if (!isRecord(node) || !hasFiniteNumber(node, 'x') || !hasFiniteNumber(node, 'y')) {
          missingPositionIds.add(normalized.id);
        }
        return normalized;
      })
    : [];
  const schema: ArchitectSchema = {
    id,
    name: readString(raw, ['name', 'label', 'title'], id),
    description: readString(raw, ['description', 'summary'], ''),
    version: readString(raw, ['version'], '0.0.0'),
    roleSlots,
    nodes,
    edges: [],
    routerPolicy: {
      mode: 'rank_then_merge',
      mustAddressCriticFindings: false,
      canReturnNeedsMoreResearch: false,
    },
    contextPolicy: readContextPolicy(raw),
    memoryPolicy: {
      persistFinalArtifact: false,
      persistRouterDecision: false,
    },
    outputArtifactSchema: readString(raw, ['outputArtifactSchema'], 'Artifact'),
  };

  const schemaWithEdges = applyTopLevelEdges(schema, raw);
  return {
    ...schemaWithEdges,
    nodes: layoutMissingNodePositions(schemaWithEdges.nodes, schemaWithEdges.edges, missingPositionIds),
  };
}

function normalizeRoleSlot(raw: unknown, index: number): ArchitectureRoleSlot {
  const slot = normalizeSlot(raw, index);
  return {
    id: slot.id,
    label: slot.label,
    description: slot.description ?? '',
    slotType: slot.slotType ?? 'participant',
    defaultPersonaId: slot.defaultPersonaId ?? '',
    allowedPersonaTags: slot.allowedPersonaTags ?? [],
    required: slot.required ?? false,
    canOverrideAtRunStart: slot.canOverrideAtRunStart ?? false,
  };
}

function attachRoleSlot(node: ArchitectNode, slotById: Map<string, ArchitectureRoleSlot>): ArchitectNode {
  if (!node.roleSlotId) {
    return node;
  }
  const roleSlot = slotById.get(node.roleSlotId);
  if (!roleSlot) {
    return node;
  }
  return {
    ...node,
    personaId: node.personaId ?? roleSlot.defaultPersonaId,
    slots: node.slots.length > 0
      ? node.slots
      : [{
        id: roleSlot.id,
        label: roleSlot.label,
        slotType: roleSlot.slotType,
        defaultPersonaId: roleSlot.defaultPersonaId,
        allowedPersonaTags: roleSlot.allowedPersonaTags,
        required: roleSlot.required,
        canOverrideAtRunStart: roleSlot.canOverrideAtRunStart,
        description: roleSlot.description,
      }],
  };
}

export function normalizeArchitectureSchemas(raw: unknown): ArchitectSchema[] {
  const source = isRecord(raw) && Array.isArray(raw['schemas']) ? raw['schemas'] : raw;
  if (!Array.isArray(source)) {
    return [];
  }

  return source.map(normalizeArchitectureSchema);
}
