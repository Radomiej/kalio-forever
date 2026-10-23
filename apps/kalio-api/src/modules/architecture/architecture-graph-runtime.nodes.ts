import type { ArchitectureSchemaNode } from '@kalio/types';
import { types } from 'node:util';
import { architectureActionSummaryForEvent } from './architecture-action-summary';
import { finalArtifactFromRoleResult, finalArtifactFromSynthesizedGraphOutputs, synthesizedArtifactMessage } from './architecture-graph-artifact.utils';
import {
  architectureIncompleteResultReason,
  architectureToolExecutorContract,
  blockingFinalizationReason,
  incompleteToolExecutorReason,
  workflowEvidenceArray,
} from './architecture-graph-finalization.utils';
import { recoverableNodeErrorDecision } from './architecture-graph-recoverable-error.utils';
import { defaultOutgoingNodeId, routeRequest, selectedRoleOutgoingNodeIds } from './architecture-graph-routing.utils';
import { createWorkflowError } from '../../common/utils/workflow-error.util';
import type { ArchitectureGraphContext, GraphRuntimeOptions } from './architecture-graph-runtime.context';
import { executeAutoRoutingGraphNode } from './architecture-graph-auto-routing.utils';
import { executeRoutingNode } from './architecture-graph-runtime.routing';
import { executeGoalNode, goalProtocolRequired } from './architecture-graph-goal-nodes';
import { assertGoalArtifactPort, persistGoalRoute, publishGoalArtifact, refreshGoalWorkState } from './architecture-graph-goal-completion';

export async function executeNode(ctx: ArchitectureGraphContext,
  node: ArchitectureSchemaNode,
  incomingNodeIds: string[],
  outgoingNodeIds: string[],
  nodesById: Map<string, ArchitectureSchemaNode>,
): Promise<string[]> {
  const goalResult = await executeGoalNode(ctx, node, outgoingNodeIds);
  if (goalResult !== null) return goalResult;
  if (node.kind === 'auto_router') {
    if (!ctx.options.persistAutoRouteDecision) {
      throw new Error('Durable route decision storage is unavailable.');
    }
    const visit = ctx.visitCount(node.id) + 1;
    return executeAutoRoutingGraphNode({
      schema: ctx.options.schema,
      node,
      run: ctx.options.run,
      incomingNodeIds,
      incomingEvents: ctx.events,
      outgoingEdges: ctx.options.schema.edges.filter((edge) => edge.fromNodeId === node.id),
      nodesById,
      visit,
      visitCounts: { ...Object.fromEntries(ctx.nodeVisitCounts), [node.id]: visit },
      choose: ctx.options.chooseAutoRoute,
      createDecisionEvent: (projection) => ctx.createEvent('router_decision', projection.message, {
        actionSummary: architectureActionSummaryForEvent('router_decision', 'auto_router'),
        nodeId: node.id,
        route: projection.route,
        data: projection.data,
      }),
      persistDecision: ctx.options.persistAutoRouteDecision,
      appendEvent: (event) => ctx.appendEvent(event),
    });
  }
  if (node.kind === 'role' && node.roleSlotId) {
    return executeRoleNode(ctx, node, outgoingNodeIds);
  }

  if (node.kind === 'parallel' || node.kind === 'router') {
    return executeRoutingNode(ctx, node, incomingNodeIds, outgoingNodeIds, nodesById);
  }

  if (node.kind === 'artifact') {
    if (goalProtocolRequired(ctx)) assertGoalArtifactPort(ctx, node);
    if (node.roleSlotId && ctx.options.run.executionMode === 'subagent_execution') {
      return executeFinalizerNode(ctx, node, incomingNodeIds, outgoingNodeIds);
    }
    const projection = finalArtifactFromSynthesizedGraphOutputs({
      node,
      incomingNodeIds,
      incomingEvents: ctx.eventsForNodeIds(incomingNodeIds),
      rootSessionId: ctx.options.run.rootSessionId,
      personaId: node.roleSlotId ? ctx.personaForRoleSlotId(node.roleSlotId) : undefined,
    });
    if (goalProtocolRequired(ctx)) await publishGoalArtifact(ctx, node, projection.message, projection.options);
    else ctx.push('final_artifact', projection.message, projection.options);
  }

  return outgoingNodeIds;
}

function workAttemptFail(): never { throw new Error('GOAL_GRAPH_WORK_ATTEMPT_FAILED'); }
function goalWorkerIdentity(ctx: ArchitectureGraphContext, node: ArchitectureSchemaNode, branchSessionId: string): string {
  const { run, schema, goalProtocol, signal } = ctx.options;
  const directive = ctx.goalDirective;
  if (!signal || !(signal instanceof AbortSignal) || !goalProtocol || directive?.kind !== 'work'
    || node.id !== goalProtocol.workerNodeId || !directive.executableNodeIds.includes(node.id)
    || !schema.nodes.includes(node) || node.kind !== 'role' || !node.roleSlotId
    || run.branchSessionIds?.[node.roleSlotId] !== branchSessionId || run.executionMode !== 'subagent_execution'
    || directive.state.runId !== run.id || directive.state.rootSessionId !== run.rootSessionId
    || directive.state.packet.projection.status !== 'accepted' || run.goalPacket?.projection.status !== 'accepted'
    || JSON.stringify(directive.state.packet) !== JSON.stringify(run.goalPacket)) return workAttemptFail();
  return JSON.stringify([run.id, run.rootSessionId, run.schemaId, run.branchSessionIds, run.goalPacket,
    directive, goalProtocol.workerNodeId, node]);
}
type WorkerAttempt = Awaited<ReturnType<NonNullable<GraphRuntimeOptions['openGoalWorkerAttempt']>>>;
/** Inspect object capabilities without JSON cloning or invoking accessors. */
function workerAttempt(raw: unknown): WorkerAttempt {
  const descriptors = (value: unknown): Record<string, PropertyDescriptor> => {
    if (!value || typeof value !== 'object' || types.isProxy(value) || Array.isArray(value)
      || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) return workAttemptFail();
    const keys = Reflect.ownKeys(value);
    if (keys.some(key => typeof key !== 'string')) return workAttemptFail();
    const result = Object.getOwnPropertyDescriptors(value);
    if (Object.values(result).some(item => !item.enumerable || !Object.hasOwn(item, 'value'))) return workAttemptFail();
    return result;
  };
  try {
    const outer = descriptors(raw);
    if (Object.keys(outer).length !== 2 || typeof outer.finish?.value !== 'function' || !outer.observer) return workAttemptFail();
    const hooks = descriptors(outer.observer.value);
    if (['admit', 'commit', 'drain', 'journalComplete'].some(key => typeof hooks[key]?.value !== 'function')
      || hooks.resolvedDispatch && typeof hooks.resolvedDispatch.value !== 'function') return workAttemptFail();
    return raw as WorkerAttempt;
  } catch { return workAttemptFail(); }
}

export async function executeRoleNode(ctx: ArchitectureGraphContext, node: ArchitectureSchemaNode, outgoingNodeIds: string[]): Promise<string[]> {
  const goalWork = goalProtocolRequired(ctx);
  if (goalWork && ctx.isStopped()) return [];
  const goalSnapshot = goalWork
    ? JSON.stringify([ctx.options.run.id, ctx.options.run.rootSessionId, ctx.options.run.goalPacket]) : undefined;
  const slot = ctx.options.schema.roleSlots.find((candidate) => candidate.id === node.roleSlotId);
  if (!slot || !ctx.shouldExecuteSlot(slot)) {
    if (goalWork) return workAttemptFail();
    return outgoingNodeIds;
  }
  const branchSessionId = ctx.options.run.branchSessionIds?.[slot.id];
  if (!branchSessionId) {
    if (goalWork) return workAttemptFail();
    throw new Error(`Missing branch session for role slot ${slot.id}`);
  }
  let attempt: WorkerAttempt | undefined;
  let workIdentity: string | undefined;
  const workSignal = ctx.options.signal;
  const assertCurrentWork = (): void => {
    if (ctx.options.signal !== workSignal || workIdentity !== goalWorkerIdentity(ctx, node, branchSessionId)) workAttemptFail();
  };
  if (goalWork) {
    workIdentity = goalWorkerIdentity(ctx, node, branchSessionId);
    if (typeof ctx.options.openGoalWorkerAttempt !== 'function') workAttemptFail();
    let opened: unknown;
    try {
      opened = await ctx.options.openGoalWorkerAttempt({ run: structuredClone(ctx.options.run), nodeId: node.id,
        branchSessionId, signal: ctx.options.signal });
    } catch { return workAttemptFail(); }
    if (ctx.isStopped()) return [];
    assertCurrentWork();
    attempt = workerAttempt(opened);
  }
  ctx.push('agent_started', `${slot.label} agent started.`, {
    actionSummary: architectureActionSummaryForEvent('agent_started', 'role'),
    nodeId: node.id,
    roleSlotId: slot.id,
    data: {
      branchSessionId,
      personaId: ctx.options.personaForSlot(slot),
      slotType: slot.slotType,
    },
  });
  if (attempt) {
    if (ctx.isStopped()) return [];
    assertCurrentWork();
  }
  const result = await ctx.options.roleExecutor.execute({
    schema: ctx.options.schema,
    run: ctx.options.run,
    slot,
    branchSessionId,
    personaId: ctx.options.personaForSlot(slot),
    node,
    incomingEvents: ctx.incomingEventsForSlot(slot, ctx.incomingNodeIdsFor(node.id)),
    outgoingNodeIds,
    resumeChildTurnId: ctx.options.resumeFrom?.waitingNodeId === node.id
      ? ctx.options.resumeFrom.waitIdentity?.childTurnId
      : undefined,
    emit: ctx.branchEventEmit(node, slot),
    ...(attempt ? { hostRuntimeReceiptObserver: attempt.observer } : {}),
  });
  if (goalSnapshot !== undefined) {
    if (ctx.isStopped()) return [];
    assertCurrentWork();
    if (goalSnapshot !== JSON.stringify([ctx.options.run.id, ctx.options.run.rootSessionId, ctx.options.run.goalPacket])) {
      throw createWorkflowError('CONTRACT_VIOLATION', 'Goal graph protocol failed.', { source: 'architecture-graph-runtime', retryable: false });
    }
  }
  const toolContract = architectureToolExecutorContract({
    slot,
    data: result.data,
    incomingEvents: ctx.events,
    ...ctx.finalizationInput(),
  });
  if (!toolContract.ok) {
    throw createWorkflowError(
      'CONTRACT_VIOLATION',
      `Architecture tool executor ${slot.id} completed without required tool evidence: ${toolContract.reason}`,
      { source: 'architecture-graph-runtime' },
    );
  }
  const incompleteReason = architectureIncompleteResultReason(result.data)
    ?? incompleteToolExecutorReason({ slot, data: result.data, incomingEvents: ctx.events });
  const selectedNodeIds = goalWork ? outgoingNodeIds.filter(id => id === ctx.options.goalProtocol?.judgeNodeId) : incompleteReason
    ? ctx.incompleteContinuationNodeIds(outgoingNodeIds, node.id, defaultOutgoingNodeId(ctx.options.schema, node.id, outgoingNodeIds))
    : selectedRoleOutgoingNodeIds({ data: result.data, outgoingNodeIds });
  const requestedRoute = routeRequest(result.data);
  const hasAgentRoute = !incompleteReason && requestedRoute !== undefined && outgoingNodeIds.includes(requestedRoute.targetNodeId);
  if (attempt) {
    if (ctx.isStopped()) return [];
    assertCurrentWork();
    try { await attempt.finish(); } catch { return workAttemptFail(); }
    if (ctx.isStopped()) return [];
    assertCurrentWork();
  }
  ctx.push('participant_output', result.message, {
    actionSummary: architectureActionSummaryForEvent('participant_output', 'role'),
    nodeId: node.id,
    roleSlotId: slot.id,
    route: {
      source: incompleteReason ? 'runtime_fallback' : hasAgentRoute ? 'agent' : 'runtime_fallback',
      fromNodeId: node.id,
      selectedNodeIds,
      rejectedNodeIds: outgoingNodeIds.filter((nodeId) => !selectedNodeIds.includes(nodeId)),
      nextNodeId: selectedNodeIds[0],
      response: incompleteReason ?? (hasAgentRoute ? requestedRoute.response : undefined),
    },
    evidence: workflowEvidenceArray(result.data),
    data: {
      ...result.data,
      incompleteReason,
      incomingNodeIds: ctx.incomingNodeIdsFor(node.id),
      selectedNodeIds,
    },
  });
  if (goalWork) {
    if (ctx.isStopped()) return [];
    assertCurrentWork();
    if (selectedNodeIds.length !== 1) throw new Error('GOAL_GRAPH_WORK_ROUTE_FAILED');
    await refreshGoalWorkState(ctx);
    if (ctx.isStopped()) return [];
    await persistGoalRoute(ctx, node, selectedNodeIds);
  }
  return selectedNodeIds;
}

export async function executeFinalizerNode(ctx: ArchitectureGraphContext,
  node: ArchitectureSchemaNode,
  incomingNodeIds: string[],
  outgoingNodeIds: string[],
): Promise<string[]> {
  if (goalProtocolRequired(ctx)) assertGoalArtifactPort(ctx, node);
  const blockingReason = blockingFinalizationReason(ctx.finalizationInput());
  if (blockingReason) {
    throw new Error(`Architecture finalization blocked: ${blockingReason}`);
  }
  const slot = ctx.options.schema.roleSlots.find((candidate) => candidate.id === node.roleSlotId);
  if (!slot) {
    return outgoingNodeIds;
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
    emit: ctx.options.emit,
  });
  if (goalProtocolRequired(ctx) && ctx.isStopped()) return [];
  const projection = finalArtifactFromRoleResult({
    node,
    slot,
    branchSessionId,
    message: result.message,
    data: result.data,
    incomingNodeIds,
    outgoingNodeIds,
  });
  if (goalProtocolRequired(ctx)) await publishGoalArtifact(ctx, node, projection.message, projection.options);
  else ctx.push('final_artifact', projection.message, projection.options);
  return outgoingNodeIds;
}

export function handleRecoverableNodeError(ctx: ArchitectureGraphContext,
  node: ArchitectureSchemaNode,
  outgoingNodeIds: string[],
  error: unknown,
): string[] {
  const incomingNodeIds = ctx.incomingNodeIdsFor(node.id);
  const decision = recoverableNodeErrorDecision({
    schema: ctx.options.schema,
    node,
    incomingNodeIds,
    outgoingNodeIds,
    error,
    synthesizedArtifactMessage: synthesizedArtifactMessage({
      node,
      incomingEvents: ctx.eventsForNodeIds(incomingNodeIds),
    }),
  });
  ctx.push(decision.event.type, decision.event.message, decision.event.options);
  return decision.selectedNodeIds;
}
