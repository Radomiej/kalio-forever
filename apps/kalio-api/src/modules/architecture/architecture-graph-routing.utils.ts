import type {
  ArchitectureNodeBehaviorMode,
  ArchitectureRouterOutput,
  ArchitectureSchema,
  ArchitectureSchemaEdge,
  ArchitectureSchemaNode,
} from '@kalio/types';
import { structuredRouteToCall } from './architecture-structured-output';

export type AgentRouteRequest = {
  targetNodeId: string;
  response?: string;
};

type SelectedOutgoingNodeIdsInput = {
  schema: ArchitectureSchema;
  node: ArchitectureSchemaNode;
  outgoingNodeIds: string[];
};

type ContinuationOutgoingNodeIdInput = {
  schema: ArchitectureSchema;
  sourceNodeId: string;
  incomingNodeIds: string[];
  outgoingNodeIds: string[];
  defaultNodeId: string | undefined;
};

type RouterActionTargetNodeIdInput = {
  schema: ArchitectureSchema;
  routerOutput: ArchitectureRouterOutput;
  sourceNodeId: string;
  outgoingNodeIds: string[];
};

export function selectedOutgoingNodeIds(input: SelectedOutgoingNodeIdsInput): string[] {
  const { schema, node, outgoingNodeIds } = input;
  if (outgoingNodeIds.length === 0) {
    return [];
  }
  const mode = node.behavior?.mode;
  const explicitSelection = selectedOutgoingNodeIdsFromEdges(schema, node.id, mode, outgoingNodeIds);
  if (explicitSelection) {
    return explicitSelection;
  }
  if (mode === 'choose_one') {
    return [outgoingNodeIds[0]];
  }
  if (mode === 'rank_then_merge' || mode === 'merge_inputs') {
    return outgoingNodeIds.slice(0, 1);
  }
  return outgoingNodeIds;
}

export function outgoingNodeIdForSelection(
  schema: ArchitectureSchema,
  sourceNodeId: string,
  outgoingNodeIds: string[],
  selection: NonNullable<ArchitectureSchemaEdge['selection']>,
): string | undefined {
  return schema.edges.find((edge) =>
    edge.fromNodeId === sourceNodeId
    && outgoingNodeIds.includes(edge.toNodeId)
    && edge.selection === selection)?.toNodeId;
}

export function defaultOutgoingNodeId(
  schema: ArchitectureSchema,
  sourceNodeId: string,
  outgoingNodeIds: string[],
): string | undefined {
  return outgoingNodeIdForSelection(schema, sourceNodeId, outgoingNodeIds, 'default');
}

export function routeConvergeNodeId(input: SelectedOutgoingNodeIdsInput): string | undefined {
  const { schema, node, outgoingNodeIds } = input;
  const explicitConvergeNodeId = outgoingNodeIdForSelection(schema, node.id, outgoingNodeIds, 'converge');
  if (explicitConvergeNodeId) {
    return explicitConvergeNodeId;
  }
  if (node.kind !== 'parallel' && node.behavior?.mode !== 'fan_out_all') {
    return undefined;
  }
  const branchConvergeTargets = new Set(
    schema.edges
      .filter((edge) => outgoingNodeIds.includes(edge.fromNodeId) && edge.selection === 'converge')
      .map((edge) => edge.toNodeId),
  );
  return branchConvergeTargets.size === 1
    ? [...branchConvergeTargets][0]
    : undefined;
}

export function continuationOutgoingNodeId(input: ContinuationOutgoingNodeIdInput): string | undefined {
  const { schema, sourceNodeId, incomingNodeIds, outgoingNodeIds, defaultNodeId } = input;
  const continuationNodeId = outgoingNodeIdForSelection(schema, sourceNodeId, outgoingNodeIds, 'continuation');
  if (continuationNodeId) {
    return continuationNodeId;
  }
  const nonDefaultNodeIds = outgoingNodeIds.filter((nodeId) => nodeId !== defaultNodeId);
  return nonDefaultNodeIds.find((nodeId) => incomingNodeIds.includes(nodeId)) ?? nonDefaultNodeIds[0];
}

export function routeRequest(data: Record<string, unknown>): AgentRouteRequest | undefined {
  const structuredRoute = structuredRouteToCall(data['routerOutput']);
  return structuredRoute
    ? { targetNodeId: structuredRoute.targetNodeId, response: structuredRoute.response }
    : undefined;
}

export function selectedRoleOutgoingNodeIds(input: {
  data: Record<string, unknown>;
  outgoingNodeIds: string[];
}): string[] {
  const request = routeRequest(input.data);
  if (request && input.outgoingNodeIds.includes(request.targetNodeId)) {
    return [request.targetNodeId];
  }
  return input.outgoingNodeIds;
}

export function routerActionTargetNodeId(input: RouterActionTargetNodeIdInput): string | undefined {
  const { schema, routerOutput, sourceNodeId, outgoingNodeIds } = input;
  if (routerOutput.nextAction !== 'run_more_research') {
    return undefined;
  }
  if (routerOutput.targetNodeId && outgoingNodeIds.includes(routerOutput.targetNodeId)) {
    return routerOutput.targetNodeId;
  }
  return outgoingNodeIdForSelection(schema, sourceNodeId, outgoingNodeIds, 'continuation');
}

export function routerOutputWithActionTarget(
  routerOutput: ArchitectureRouterOutput,
  targetNodeId: string,
): ArchitectureRouterOutput {
  return {
    ...routerOutput,
    selectedStrategy: targetNodeId,
    targetNodeId,
  };
}

export function isRouterPauseAction(nextAction: ArchitectureRouterOutput['nextAction']): boolean {
  return nextAction === 'ask_human' || nextAction === 'rerun_with_different_personas';
}

export function routerPauseActionSummary(nextAction: ArchitectureRouterOutput['nextAction']): string {
  return nextAction === 'rerun_with_different_personas'
    ? 'Waiting for orchestrator persona rerun decision.'
    : 'Waiting for human routing decision.';
}

export function routingMessage(node: ArchitectureSchemaNode, nextLabel: string, selectedCount: number): string {
  if (node.kind === 'parallel') {
    return `${node.label} started ${selectedCount} outgoing path${selectedCount === 1 ? '' : 's'}.`;
  }
  if (node.behavior?.mode === 'choose_one') {
    return `${node.label} selected ${nextLabel}.`;
  }
  if (node.behavior?.mode === 'fan_out_all') {
    return `${node.label} fanned out to ${selectedCount} path${selectedCount === 1 ? '' : 's'}.`;
  }
  return `${node.label} ranked and merged inputs for ${nextLabel}.`;
}

function selectedOutgoingNodeIdsFromEdges(
  schema: ArchitectureSchema,
  sourceNodeId: string,
  mode: ArchitectureNodeBehaviorMode | undefined,
  outgoingNodeIds: string[],
): string[] | undefined {
  const outgoingEdges = schema.edges.filter((edge) =>
    edge.fromNodeId === sourceNodeId && outgoingNodeIds.includes(edge.toNodeId));
  if (mode === 'rank_then_merge' || mode === 'merge_inputs') {
    const convergeEdge = outgoingEdges.find((edge) => edge.selection === 'converge');
    return convergeEdge ? [convergeEdge.toNodeId] : undefined;
  }
  if (mode === 'choose_one') {
    const defaultEdge = outgoingEdges.find((edge) => edge.selection === 'default');
    return defaultEdge ? [defaultEdge.toNodeId] : undefined;
  }
  return undefined;
}
