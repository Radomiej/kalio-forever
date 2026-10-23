import type { ArchitectureExecutionEvent } from '@kalio/types';
import { architectureActionSummaryForEvent } from './architecture-action-summary';
import { partitionReadyNodesByVisitLimit, runtimeLimitDecisionForPendingNodes } from './architecture-graph-scheduler.utils';
import { groupArchitectureEdges, markActiveIncoming, returnToOrchestratorNodeIds, rootArchitectureNodes } from './architecture-graph-topology.utils';
import { createWorkflowError, workflowFailureFromError } from '../../common/utils/workflow-error.util';
import { ArchitectureGraphContext, type GraphRuntimeOptions } from './architecture-graph-runtime.context';
import { executeNode, handleRecoverableNodeError } from './architecture-graph-runtime.nodes';
import { gateGoalBatch, goalProtocolRequired, pauseGoalGraph, validateGoalGraphConfig } from './architecture-graph-goal-nodes';
import { acknowledgeGoalVisit } from './architecture-graph-goal-visits';
export type { GraphRuntimeOptions } from './architecture-graph-runtime.context';

export async function createArchitectureGraphEvents(options: GraphRuntimeOptions): Promise<ArchitectureExecutionEvent[]> {
  const ctx = new ArchitectureGraphContext(options);
  ctx.seedPriorEvents();
  if (ctx.isStopped()) return ctx.events;
  if (!ctx.options.resumeFrom) {
    ctx.push('run_created', `Architecture run created for: ${ctx.options.run.prompt}`, {
      actionSummary: architectureActionSummaryForEvent('run_created'),
      lifecycle: 'started',
      status: 'running',
      data: { rootSessionId: ctx.options.run.rootSessionId },
    });
  }

  const nodesById = new Map(ctx.options.schema.nodes.map((node) => [node.id, node]));
  const incoming = groupArchitectureEdges(ctx.options.schema, 'toNodeId');
  const outgoing = groupArchitectureEdges(ctx.options.schema, 'fromNodeId');
  let ready;
  try { ready = goalProtocolRequired(ctx) && options.resumeFrom
    ? [...new Set(options.resumeFrom.pendingNodeIds)].flatMap(id => nodesById.has(id) ? [nodesById.get(id)!] : [])
    : goalProtocolRequired(ctx) ? [nodesById.get(validateGoalGraphConfig(ctx).workerNodeId)!]
      : ctx.readyNodesFromCursor(nodesById) ?? rootArchitectureNodes(ctx.options.schema, incoming);
  } catch (error) {
    const failure = workflowFailureFromError(error);
    ctx.push('node_failed', 'Goal graph protocol failed.', { lifecycle: 'failed', status: 'failed', errorCode: failure.code, failure });
    throw error;
  }
  if (goalProtocolRequired(ctx) && typeof options.persistGoalVisit !== 'function') {
    throw createWorkflowError('CONTRACT_VIOLATION', 'Goal graph visit failed.', { source: 'architecture-graph-runtime', retryable: false });
  }
  const queuedNodeIds = new Set(ready.map((node) => node.id));
  const maxVisitBlockedNodeIds = new Set<string>();
  ready.forEach((node) => ctx.activeNodeIds.add(node.id));
  const maxSteps = ctx.maxSteps();
  const maxNodeVisits = ctx.maxNodeVisits();
  let steps = 0;

  while ((ready.length > 0 || goalProtocolRequired(ctx)) && steps < maxSteps && !ctx.isStopped()) {
    let permitted;
    try {
      permitted = await gateGoalBatch(ctx, ready);
    } catch (error) {
      const failure = workflowFailureFromError(error);
      ctx.push('node_failed', 'Goal graph protocol failed.', { nodeId: ready[0]?.id, lifecycle: 'failed', status: 'failed', errorCode: failure.code, failure });
      throw error;
    }
    if (ctx.isStopped() || ctx.goalPaused) return ctx.events;
    const stepBudget = maxSteps - steps;
    const batch = permitted.slice(0, stepBudget);
    for (const node of batch) ready.splice(ready.indexOf(node), 1);
    batch.forEach((node) => queuedNodeIds.delete(node.id));
    const partition = partitionReadyNodesByVisitLimit({
      nodes: batch,
      maxNodeVisits,
      visitCount: (nodeId) => ctx.visitCount(nodeId),
    });
    partition.blockedNodeIds.forEach((nodeId) => maxVisitBlockedNodeIds.add(nodeId));
    if (partition.executableNodes.length === 0) {
      continue;
    }
    const executableBatch = partition.executableNodes;
    steps += executableBatch.length;

    const settledBatch = await Promise.allSettled(executableBatch.map(async (node) => {
      if (ctx.isStopped()) return { node, selectedNodeIds: [] };
      let startedEvent = [...ctx.events].reverse().find(event => event.nodeId === node.id && event.type === 'node_started');
      const replayStart = ctx.resumesIncompleteNode(node.id);
      if (!replayStart) {
        const event = ctx.createEvent('node_started', `${node.label} started.`, {
          actionSummary: architectureActionSummaryForEvent('node_started', node.kind),
          lifecycle: 'node_started',
          status: 'running',
          nodeId: node.id,
          roleSlotId: node.roleSlotId,
          data: { kind: node.kind, behavior: node.behavior ? { ...node.behavior } : undefined },
        });
        startedEvent = event;
        if (goalProtocolRequired(ctx)) {
          if (!await acknowledgeGoalVisit(ctx, node, event, event.id, false)) return { node, selectedNodeIds: [] };
        } else ctx.appendEvent(event);
      } else if (goalProtocolRequired(ctx)) {
        if (!startedEvent) throw createWorkflowError('CONTRACT_VIOLATION', 'Goal graph visit failed.', { source: 'architecture-graph-runtime', retryable: false });
        if (!await acknowledgeGoalVisit(ctx, node, startedEvent, startedEvent.id, true)) return { node, selectedNodeIds: [] };
      }
      if (ctx.isStopped()) return { node, selectedNodeIds: [] };
      const outgoingNodeIds = outgoing.get(node.id) ?? [];
      let selectedNodeIds: string[];
      try {
        selectedNodeIds = await executeNode(ctx,
          node,
          ctx.incomingNodeIdsFor(node.id, incoming),
          outgoingNodeIds,
          nodesById,
        );
      } catch (error) {
        if (goalProtocolRequired(ctx) && ctx.isStopped()) return { node, selectedNodeIds: [] };
        const caughtError = goalProtocolRequired(ctx)
          ? createWorkflowError('CONTRACT_VIOLATION', 'Goal graph protocol failed.', { source: 'architecture-graph-runtime', retryable: false })
          : error;
        if (node.kind === 'auto_router' || !ctx.isRecoverableNodeError(caughtError)) {
          const failure = workflowFailureFromError(caughtError);
          ctx.push('node_failed', `${node.label} failed.`, {
            actionSummary: architectureActionSummaryForEvent('node_failed', node.kind),
            lifecycle: 'failed',
            status: 'failed',
            nodeId: node.id,
            roleSlotId: node.roleSlotId,
            errorCode: failure.code,
            failure,
            data: {
              errorCode: failure.code,
              failure,
            },
          });
          throw caughtError;
        }
        selectedNodeIds = handleRecoverableNodeError(ctx, node, outgoingNodeIds, caughtError);
      }
      if (ctx.isStopped() || ctx.goalPaused || ctx.goalTerminalPublished) return { node, selectedNodeIds: [] };
      const completedEvent = ctx.createEvent('node_completed', `${node.label} completed.`, {
        lifecycle: 'node_completed',
        status: 'done',
        nodeId: node.id,
        roleSlotId: node.roleSlotId,
        data: { selectedNodeIds },
      });
      if (goalProtocolRequired(ctx)) {
        if (!startedEvent || !await acknowledgeGoalVisit(ctx, node, completedEvent, startedEvent.id, false)) return { node, selectedNodeIds: [] };
      } else ctx.appendEvent(completedEvent);
      return { node, selectedNodeIds };
    }));
    const failedResult = settledBatch.find((result) => result.status === 'rejected');
    if (failedResult?.status === 'rejected') throw failedResult.reason;
    if (ctx.isStopped() || ctx.goalPaused || ctx.goalTerminalPublished) return ctx.events;
    const batchResults = settledBatch.flatMap((result) => result.status === 'fulfilled' ? [result.value] : []);

    for (const { node, selectedNodeIds } of batchResults) {
      ctx.nodeVisitCounts.set(node.id, ctx.visitCount(node.id) + 1);

      for (const nextNodeId of selectedNodeIds) {
        markActiveIncoming(ctx.activeIncomingNodeIds, nextNodeId, node.id);
        ctx.activeNodeIds.add(nextNodeId);
      }
    }

    const orchestratorHandoff = batchResults
      .map(({ node, selectedNodeIds }) => ({
        node,
        pendingNodeIds: returnToOrchestratorNodeIds({
          schema: ctx.options.schema,
          fromNodeId: node.id,
          selectedNodeIds,
          pauseEnabled: ctx.returnToOrchestratorPauseEnabled(),
        }),
      }))
      .find((handoff) => handoff.pendingNodeIds.length > 0);
    if (orchestratorHandoff) {
      if (goalProtocolRequired(ctx)) {
        try {
          await pauseGoalGraph(ctx, orchestratorHandoff.pendingNodeIds);
        } catch (error) {
          const failure = workflowFailureFromError(error);
          ctx.push('node_failed', 'Goal graph protocol failed.', { nodeId: orchestratorHandoff.node.id, lifecycle: 'failed', status: 'failed', errorCode: failure.code, failure });
          throw error;
        }
        return ctx.events;
      }
      ctx.push('router_decision', `${orchestratorHandoff.node.label} returned control to the orchestrator.`, {
        actionSummary: architectureActionSummaryForEvent('router_decision', orchestratorHandoff.node.kind),
        nodeId: orchestratorHandoff.node.id,
        roleSlotId: orchestratorHandoff.node.roleSlotId,
        reasonCode: 'return_to_orchestrator',
        data: {
          reasonCode: 'return_to_orchestrator',
          pendingNodeIds: orchestratorHandoff.pendingNodeIds,
          returnToOrchestrator: true,
          visitCounts: Object.fromEntries(ctx.nodeVisitCounts.entries()),
        },
      });
      return ctx.events;
    }

    for (const { selectedNodeIds } of batchResults) {
      for (const nextNodeId of selectedNodeIds) {
        const nextNode = nodesById.get(nextNodeId);
        if (!nextNode || queuedNodeIds.has(nextNodeId)) {
          continue;
        }
        if (ctx.visitCount(nextNodeId) >= maxNodeVisits) {
          maxVisitBlockedNodeIds.add(nextNodeId);
          continue;
        }
        if (ctx.nodeReady(nextNodeId, incoming)) {
          ready.push(nextNode);
          queuedNodeIds.add(nextNodeId);
        }
      }
    }
  }

  if (goalProtocolRequired(ctx) && !ctx.isStopped()) {
    try {
      await pauseGoalGraph(ctx, [...new Set([...ready.map(node => node.id), ...maxVisitBlockedNodeIds])]);
    } catch (error) {
      const failure = workflowFailureFromError(error);
      ctx.push('node_failed', 'Goal graph protocol failed.', { lifecycle: 'failed', status: 'failed', errorCode: failure.code, failure });
      throw error;
    }
    return ctx.events;
  }

  const limitDecision = runtimeLimitDecisionForPendingNodes({
    readyNodeIds: ready.map((node) => node.id),
    maxVisitBlockedNodeIds: Array.from(maxVisitBlockedNodeIds),
    maxSteps,
    maxNodeVisits,
    visitCounts: Object.fromEntries(ctx.nodeVisitCounts.entries()),
  });
  if (limitDecision) {
    ctx.push('router_decision', limitDecision.message, {
      actionSummary: architectureActionSummaryForEvent('router_decision'),
      reasonCode: limitDecision.reasonCode,
      data: limitDecision.data,
    });
  }

  return ctx.events;
}
