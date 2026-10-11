import type { ArchitectureRouteDecision, ArchitectureRouterOutput, ArchitectureSchemaNode } from '@kalio/types';
import { architectureActionSummaryForEvent } from './architecture-action-summary';
import { architectureIncompleteResultReason, workflowEvidenceArray } from './architecture-graph-finalization.utils';
import { judgeArchitectureContinuationGuard } from './architecture-graph-judge-guard.utils';
import {
  defaultOutgoingNodeId,
  isRouterPauseAction,
  routeConvergeNodeId,
  routeRequest,
  routerActionTargetNodeId,
  routerOutputWithActionTarget,
  routerPauseActionSummary,
  routingMessage,
  selectedOutgoingNodeIds,
} from './architecture-graph-routing.utils';
import type { ArchitectureGraphContext } from './architecture-graph-runtime.context';

export async function executeRoutingNode(ctx: ArchitectureGraphContext,
  node: ArchitectureSchemaNode,
  incomingNodeIds: string[],
  outgoingNodeIds: string[],
  nodesById: Map<string, ArchitectureSchemaNode>,
): Promise<string[]> {
  if (
    node.kind === 'router'
    && node.roleSlotId
    && ctx.options.run.executionMode === 'subagent_execution'
  ) {
    return executeRouterRoleNode(ctx, node, incomingNodeIds, outgoingNodeIds, nodesById);
  }
  return executeRoutingNodeSync(ctx, node, incomingNodeIds, outgoingNodeIds, nodesById);
}

export async function executeRouterRoleNode(ctx: ArchitectureGraphContext,
  node: ArchitectureSchemaNode,
  incomingNodeIds: string[],
  outgoingNodeIds: string[],
  nodesById: Map<string, ArchitectureSchemaNode>,
): Promise<string[]> {
  const slot = ctx.options.schema.roleSlots.find((candidate) => candidate.id === node.roleSlotId);
  if (!slot) {
    return executeRoutingFallbackNode(ctx, node, incomingNodeIds, outgoingNodeIds, nodesById);
  }
  const branchSessionId = ctx.options.run.branchSessionIds?.[slot.id];
  if (!branchSessionId) {
    throw new Error(`Missing branch session for role slot ${slot.id}`);
  }
  const result = await ctx.options.roleExecutor.execute({
    schema: ctx.options.schema,
    run: ctx.options.run,
    slot,
    branchSessionId,
    personaId: ctx.options.personaForSlot(slot),
    node,
    incomingEvents: ctx.incomingEventsForSlot(slot, incomingNodeIds),
    outgoingNodeIds,
    emit: ctx.branchEventEmit(node, slot),
  });
  const fallbackNodeIds = selectedOutgoingNodeIds({ schema: ctx.options.schema, node, outgoingNodeIds });
  const incompleteReason = architectureIncompleteResultReason(result.data);
  const requestedRoute = routeRequest(result.data);
  const canAgentRouteOverride = node.behavior?.mode !== 'fan_out_all';
  const hasAgentRoute = canAgentRouteOverride
    && !incompleteReason
    && requestedRoute !== undefined
    && outgoingNodeIds.includes(requestedRoute.targetNodeId);
  const defaultNodeId = defaultOutgoingNodeId(ctx.options.schema, node.id, outgoingNodeIds);
  const requestedSelectedNodeIds = incompleteReason
    ? ctx.incompleteContinuationNodeIds(outgoingNodeIds, node.id, defaultNodeId)
    : hasAgentRoute
    ? [requestedRoute.targetNodeId]
    : fallbackNodeIds;
  const guard = judgeArchitectureContinuationGuard({
    slot,
    node,
    schema: ctx.options.schema,
    requireGoalMasterLoopProof: ctx.options.run.context?.['requireGoalMasterLoopProof'] === true,
    incomingNodeIds,
    selectedNodeIds: requestedSelectedNodeIds,
    outgoingNodeIds,
    finalizationInput: ctx.finalizationInput(),
    events: ctx.events,
  });
  let finalSelectedNodeIds = guard.selectedNodeIds;
  let rejectedNodeIds = outgoingNodeIds.filter((nodeId) => !finalSelectedNodeIds.includes(nodeId));
  let route: ArchitectureRouteDecision = {
    source: incompleteReason || guard.applied ? 'runtime_fallback' : hasAgentRoute ? 'agent' : 'router',
    fromNodeId: node.id,
    selectedNodeIds: finalSelectedNodeIds,
    rejectedNodeIds,
    nextNodeId: finalSelectedNodeIds[0],
    convergeToNodeId: routeConvergeNodeId({ schema: ctx.options.schema, node, outgoingNodeIds }),
    mode: node.behavior?.mode,
    response: incompleteReason ?? guard.reason ?? requestedRoute?.response,
  };
  let routerOutput = ctx.toRouterOutput(
    node,
    incomingNodeIds,
    route,
    result.message,
    result.data,
  );
  const actionTargetNodeId = routerActionTargetNodeId({
    schema: ctx.options.schema,
    routerOutput,
    sourceNodeId: node.id,
    outgoingNodeIds,
  });
  if (actionTargetNodeId) {
    finalSelectedNodeIds = [actionTargetNodeId];
    rejectedNodeIds = outgoingNodeIds.filter((nodeId) => nodeId !== actionTargetNodeId);
    route = {
      ...route,
      selectedNodeIds: finalSelectedNodeIds,
      rejectedNodeIds,
      nextNodeId: actionTargetNodeId,
      response: routerOutput.response ?? route.response ?? routerOutput.mergedDecision,
    };
    routerOutput = routerOutputWithActionTarget(routerOutput, actionTargetNodeId);
  }
  const routerPause = isRouterPauseAction(routerOutput.nextAction);
  if (routerPause) {
    finalSelectedNodeIds = [];
    rejectedNodeIds = [...outgoingNodeIds];
    route = routerPauseRoute(ctx, node, route, outgoingNodeIds, routerOutput);
  }
  ctx.push('router_decision', result.message, {
    actionSummary: architectureActionSummaryForEvent('router_decision', 'router'),
    nodeId: node.id,
    roleSlotId: slot.id,
    route,
    routerOutput,
    evidence: workflowEvidenceArray(result.data),
    data: {
      ...result.data,
      behavior: node.behavior ? { ...node.behavior } : undefined,
      incomingNodeIds,
      nextNodeId: finalSelectedNodeIds[0],
      nextAction: routerOutput.nextAction,
      outgoingNodeIds,
      incompleteReason,
      runtimeGuard: incompleteReason ?? (guard.applied ? guard.reason : undefined),
      rejectedNodeIds,
      selectedNodeIds: finalSelectedNodeIds,
    },
  });
  ctx.push('router_output', routerOutput.mergedDecision, {
    actionSummary: architectureActionSummaryForEvent('router_output', 'router'),
    nodeId: node.id,
    roleSlotId: slot.id,
    route,
    routerOutput,
  });
  if (routerPause) {
    pushRouterRuntimePause(ctx, node, route, routerOutput, slot.id);
    return [];
  }
  return finalSelectedNodeIds;
}

export function executeRoutingFallbackNode(ctx: ArchitectureGraphContext,
  node: ArchitectureSchemaNode,
  incomingNodeIds: string[],
  outgoingNodeIds: string[],
  nodesById: Map<string, ArchitectureSchemaNode>,
): string[] {
  return executeRoutingNodeSync(ctx, node, incomingNodeIds, outgoingNodeIds, nodesById);
}

export function executeRoutingNodeSync(ctx: ArchitectureGraphContext,
  node: ArchitectureSchemaNode,
  incomingNodeIds: string[],
  outgoingNodeIds: string[],
  nodesById: Map<string, ArchitectureSchemaNode>,
): string[] {
  const behavior = node.behavior;
  let selectedNodeIds = selectedOutgoingNodeIds({ schema: ctx.options.schema, node, outgoingNodeIds });
  let rejectedNodeIds = outgoingNodeIds.filter((nodeId) => !selectedNodeIds.includes(nodeId));
  let nextNodeId: string | undefined = selectedNodeIds[0];
  let nextLabel = nextNodeId ? nodesById.get(nextNodeId)?.label ?? nextNodeId : 'end';
  let message = routingMessage(node, nextLabel, selectedNodeIds.length);
  let route: ArchitectureRouteDecision = {
    source: node.kind === 'parallel' ? 'parallel' : 'router',
    fromNodeId: node.id,
    selectedNodeIds,
    rejectedNodeIds,
    nextNodeId,
    convergeToNodeId: routeConvergeNodeId({ schema: ctx.options.schema, node, outgoingNodeIds }),
    mode: behavior?.mode,
  };
  let routerOutput = node.kind === 'router'
    ? ctx.toRouterOutput(node, incomingNodeIds, route, message, {})
    : undefined;
  const actionTargetNodeId = routerOutput
    ? routerActionTargetNodeId({
      schema: ctx.options.schema,
      routerOutput,
      sourceNodeId: node.id,
      outgoingNodeIds,
    })
    : undefined;
  if (routerOutput && actionTargetNodeId) {
    selectedNodeIds = [actionTargetNodeId];
    rejectedNodeIds = outgoingNodeIds.filter((nodeId) => nodeId !== actionTargetNodeId);
    nextNodeId = actionTargetNodeId;
    nextLabel = nodesById.get(nextNodeId)?.label ?? nextNodeId;
    message = routingMessage(node, nextLabel, selectedNodeIds.length);
    route = {
      ...route,
      selectedNodeIds,
      rejectedNodeIds,
      nextNodeId,
      response: routerOutput.response ?? routerOutput.mergedDecision,
    };
    routerOutput = routerOutputWithActionTarget(
      ctx.toRouterOutput(node, incomingNodeIds, route, message, {}),
      actionTargetNodeId,
    );
  }
  const routerPause = routerOutput ? isRouterPauseAction(routerOutput.nextAction) : false;
  if (routerOutput && routerPause) {
    selectedNodeIds = [];
    rejectedNodeIds = [...outgoingNodeIds];
    nextNodeId = undefined;
    route = routerPauseRoute(ctx, node, route, outgoingNodeIds, routerOutput);
    message = routerOutput.mergedDecision || `${node.label} requested human input.`;
  }
  ctx.push('router_decision', message, {
    actionSummary: architectureActionSummaryForEvent('router_decision', node.kind),
    nodeId: node.id,
    roleSlotId: node.roleSlotId,
    route,
    routerOutput,
    data: {
      behavior: behavior ? { ...behavior } : undefined,
      branchSessionIds: ctx.options.run.branchSessionIds,
      convergeToNodeId: route.convergeToNodeId,
      incomingNodeIds,
      nextNodeId,
      nextAction: routerOutput?.nextAction,
      outgoingNodeIds,
      rejectedNodeIds,
      rootSessionId: ctx.options.run.rootSessionId,
      selectedNodeIds,
    },
  });
  if (routerOutput) {
    ctx.push('router_output', routerOutput.mergedDecision, {
      actionSummary: architectureActionSummaryForEvent('router_output', node.kind),
      nodeId: node.id,
      roleSlotId: node.roleSlotId,
      route,
      routerOutput,
    });
    if (routerPause) {
      pushRouterRuntimePause(ctx, node, route, routerOutput);
      return [];
    }
  }
  return selectedNodeIds;
}

export function pushRouterRuntimePause(ctx: ArchitectureGraphContext,
  node: ArchitectureSchemaNode,
  route: ArchitectureRouteDecision,
  routerOutput: ArchitectureRouterOutput,
  roleSlotId?: string,
): void {
  const runtimeDecision = {
    status: 'waiting_on_orchestrator' as const,
    reasonCode: 'runtime_pause' as const,
    message: routerOutput.mergedDecision,
  };
  ctx.push('human_gate', routerOutput.mergedDecision || `${node.label} requested human input.`, {
    actionSummary: routerPauseActionSummary(routerOutput.nextAction),
    nodeId: node.id,
    roleSlotId: roleSlotId ?? node.roleSlotId,
    route,
    routerOutput,
    reasonCode: 'runtime_pause',
    runtimeDecision,
    data: {
      reasonCode: 'runtime_pause',
      runtimeDecision,
      nextAction: routerOutput.nextAction,
      routerOutput,
      unresolvedConflicts: routerOutput.unresolvedConflicts,
    },
  });
}

export function routerPauseRoute(ctx: ArchitectureGraphContext,
  node: ArchitectureSchemaNode,
  route: ArchitectureRouteDecision,
  outgoingNodeIds: string[],
  routerOutput: ArchitectureRouterOutput,
): ArchitectureRouteDecision {
  return {
    ...route,
    source: node.kind === 'parallel' ? 'parallel' : 'router',
    selectedNodeIds: [],
    rejectedNodeIds: [...outgoingNodeIds],
    nextNodeId: undefined,
    convergeToNodeId: undefined,
    response: routerOutput.response ?? routerOutput.mergedDecision,
  };
}
