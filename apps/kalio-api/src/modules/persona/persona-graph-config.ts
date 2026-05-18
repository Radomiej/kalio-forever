export type PersonaGraphNodeType = 'router' | 'persona' | 'tool' | 'final';

export interface PersonaGraphNode {
  id: string;
  type: PersonaGraphNodeType;
  label: string;
  personaId?: string;
  toolName?: string;
  maxVisits?: number;
  fallbackTargetNodeId?: string;
}

export interface PersonaGraphEdge {
  id: string;
  sourceNodeId: string;
  targetNodeId: string;
  label?: string;
}

export interface PersonaGraphConfig {
  version: 1;
  entryNodeId: string;
  maxSteps: number;
  nodes: PersonaGraphNode[];
  edges: PersonaGraphEdge[];
}

export interface PersonaGraphValidationError {
  code: string;
  path: string;
  message: string;
}

export interface PersonaGraphValidationResult {
  ok: boolean;
  errors: PersonaGraphValidationError[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

function isNodeType(value: unknown): value is PersonaGraphNodeType {
  return value === 'router' || value === 'persona' || value === 'tool' || value === 'final';
}

export function validatePersonaGraphConfig(config: unknown): PersonaGraphValidationResult {
  const errors: PersonaGraphValidationError[] = [];

  if (!isRecord(config)) {
    return {
      ok: false,
      errors: [{ code: 'INVALID_GRAPH_CONFIG', path: '', message: 'graph config must be an object' }],
    };
  }

  if (config['version'] !== 1) {
    errors.push({ code: 'INVALID_VERSION', path: 'version', message: 'version must equal 1' });
  }

  if (!isNonEmptyString(config['entryNodeId'])) {
    errors.push({ code: 'INVALID_ENTRY_NODE_ID', path: 'entryNodeId', message: 'entryNodeId must be a non-empty string' });
  }

  if (!isPositiveInteger(config['maxSteps'])) {
    errors.push({ code: 'INVALID_MAX_STEPS', path: 'maxSteps', message: 'maxSteps must be a positive integer' });
  }

  const rawNodes = config['nodes'];
  if (!Array.isArray(rawNodes)) {
    errors.push({ code: 'INVALID_NODES', path: 'nodes', message: 'nodes must be an array' });
  }

  const rawEdges = config['edges'];
  if (!Array.isArray(rawEdges)) {
    errors.push({ code: 'INVALID_EDGES', path: 'edges', message: 'edges must be an array' });
  }

  if (!Array.isArray(rawNodes) || !Array.isArray(rawEdges)) {
    return { ok: errors.length === 0, errors };
  }

  if (rawNodes.length === 0) {
    errors.push({ code: 'EMPTY_NODES', path: 'nodes', message: 'graph must contain at least one node' });
  }

  const nodeIds = new Set<string>();
  const edgeIds = new Set<string>();

  rawNodes.forEach((node, index) => {
    const path = `nodes[${index}]`;
    if (!isRecord(node)) {
      errors.push({ code: 'INVALID_NODE', path, message: 'node must be an object' });
      return;
    }

    const id = node['id'];
    if (!isNonEmptyString(id)) {
      errors.push({ code: 'INVALID_NODE_ID', path: `${path}.id`, message: 'node id must be a non-empty string' });
    } else if (nodeIds.has(id)) {
      errors.push({ code: 'DUPLICATE_NODE_ID', path: `${path}.id`, message: `duplicate node id: ${id}` });
    } else {
      nodeIds.add(id);
    }

    if (!isNodeType(node['type'])) {
      errors.push({ code: 'INVALID_NODE_TYPE', path: `${path}.type`, message: 'node type must be router, persona, tool, or final' });
    }

    if (!isNonEmptyString(node['label'])) {
      errors.push({ code: 'INVALID_NODE_LABEL', path: `${path}.label`, message: 'node label must be a non-empty string' });
    }

    if (node['maxVisits'] !== undefined && !isPositiveInteger(node['maxVisits'])) {
      errors.push({ code: 'INVALID_MAX_VISITS', path: `${path}.maxVisits`, message: 'maxVisits must be a positive integer when provided' });
    }

    if (node['fallbackTargetNodeId'] !== undefined && !isNonEmptyString(node['fallbackTargetNodeId'])) {
      errors.push({
        code: 'INVALID_FALLBACK_TARGET',
        path: `${path}.fallbackTargetNodeId`,
        message: 'fallbackTargetNodeId must be a non-empty string when provided',
      });
    }

    if (node['type'] === 'persona' && !isNonEmptyString(node['personaId'])) {
      errors.push({ code: 'INVALID_PERSONA_NODE', path: `${path}.personaId`, message: 'persona nodes must define personaId' });
    }

    if (node['type'] === 'tool' && !isNonEmptyString(node['toolName'])) {
      errors.push({ code: 'INVALID_TOOL_NODE', path: `${path}.toolName`, message: 'tool nodes must define toolName' });
    }
  });

  rawEdges.forEach((edge, index) => {
    const path = `edges[${index}]`;
    if (!isRecord(edge)) {
      errors.push({ code: 'INVALID_EDGE', path, message: 'edge must be an object' });
      return;
    }

    const id = edge['id'];
    if (!isNonEmptyString(id)) {
      errors.push({ code: 'INVALID_EDGE_ID', path: `${path}.id`, message: 'edge id must be a non-empty string' });
    } else if (edgeIds.has(id)) {
      errors.push({ code: 'DUPLICATE_EDGE_ID', path: `${path}.id`, message: `duplicate edge id: ${id}` });
    } else {
      edgeIds.add(id);
    }

    const sourceNodeId = edge['sourceNodeId'];
    if (!isNonEmptyString(sourceNodeId)) {
      errors.push({ code: 'INVALID_EDGE_SOURCE', path: `${path}.sourceNodeId`, message: 'sourceNodeId must be a non-empty string' });
    } else if (!nodeIds.has(sourceNodeId)) {
      errors.push({ code: 'EDGE_SOURCE_NOT_FOUND', path: `${path}.sourceNodeId`, message: `source node not found: ${sourceNodeId}` });
    }

    const targetNodeId = edge['targetNodeId'];
    if (!isNonEmptyString(targetNodeId)) {
      errors.push({ code: 'INVALID_EDGE_TARGET', path: `${path}.targetNodeId`, message: 'targetNodeId must be a non-empty string' });
    } else if (!nodeIds.has(targetNodeId)) {
      errors.push({ code: 'EDGE_TARGET_NOT_FOUND', path: `${path}.targetNodeId`, message: `target node not found: ${targetNodeId}` });
    }
  });

  if (isNonEmptyString(config['entryNodeId']) && !nodeIds.has(config['entryNodeId'])) {
    errors.push({ code: 'ENTRY_NODE_NOT_FOUND', path: 'entryNodeId', message: `entry node not found: ${config['entryNodeId']}` });
  }

  rawNodes.forEach((node, index) => {
    if (!isRecord(node) || !isNonEmptyString(node['fallbackTargetNodeId'])) {
      return;
    }

    if (!nodeIds.has(node['fallbackTargetNodeId'])) {
      errors.push({
        code: 'FALLBACK_TARGET_NOT_FOUND',
        path: `nodes[${index}].fallbackTargetNodeId`,
        message: `fallback target not found: ${node['fallbackTargetNodeId']}`,
      });
    }
  });

  return {
    ok: errors.length === 0,
    errors,
  };
}