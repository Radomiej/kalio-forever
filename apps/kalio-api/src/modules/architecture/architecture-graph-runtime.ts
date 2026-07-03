import type { AgentFlowContinuationCursor, ArchitectureExecutionEvent, ArchitectureRoleSlot, ArchitectureRouteDecision, ArchitectureRouterOutput, ArchitectureRun, ArchitectureSchema, ArchitectureSchemaNode } from '@kalio/types';
import type { ArchitectureRoleExecutionInput, ArchitectureRoleExecutor } from './architecture-role-executor';
import { architectureActionFieldsForEvent, architectureActionSummaryForEvent } from './architecture-action-summary';
import {
  finalArtifactFromRoleResult,
  finalArtifactFromSynthesizedGraphOutputs,
  synthesizedArtifactMessage,
} from './architecture-graph-artifact.utils';
import {
  architectureIncompleteResultReason,
  architectureToolExecutorContract,
  blockingFinalizationReason,
  externalQualityGateAcceptanceReason,
  incompleteToolExecutorReason,
  workflowEvidenceArray,
  type ArchitectureGraphFinalizationInput,
} from './architecture-graph-finalization.utils';
import { judgeArchitectureContinuationGuard } from './architecture-graph-judge-guard.utils';
import { architectureBranchStreamProjection } from './architecture-graph-branch-events.utils';
import { recoverableNodeErrorDecision } from './architecture-graph-recoverable-error.utils';
import {
  continuationOutgoingNodeId,
  defaultOutgoingNodeId,
  isRouterPauseAction,
  routeConvergeNodeId,
  routeRequest,
  routerActionTargetNodeId,
  routerOutputWithActionTarget,
  routerPauseActionSummary,
  routingMessage,
  selectedOutgoingNodeIds,
  selectedRoleOutgoingNodeIds,
} from './architecture-graph-routing.utils';
import {
  partitionReadyNodesByVisitLimit,
  runtimeLimitDecisionForPendingNodes,
} from './architecture-graph-scheduler.utils';
import {
  groupArchitectureEdges,
  incomingNodeIdsFor,
  isNodeReady,
  markActiveIncoming,
  returnToOrchestratorNodeIds,
  rootArchitectureNodes,
  selectedNodeIdsFromEvent,
} from './architecture-graph-topology.utils';
import { createArchitectureRouterOutput } from './architecture-router-output';
import { createWorkflowError, isWorkflowError, workflowFailureFromError } from '../../common/utils/workflow-error.util';

type GraphRuntimeOptions = {
  schema: ArchitectureSchema;
  run: ArchitectureRun;
  now: number;
  roleExecutor: ArchitectureRoleExecutor;
  personaForSlot: (slot: ArchitectureRoleSlot) => string;
  priorEvents?: ArchitectureExecutionEvent[];
  resumeFrom?: AgentFlowContinuationCursor;
  emit?: ArchitectureRoleExecutionInput['emit'];
  onEvent?: (event: ArchitectureExecutionEvent) => void;
};

type EventOptions = {
  actionSummary?: string;
  lifecycle?: ArchitectureExecutionEvent['lifecycle'];
  status?: ArchitectureExecutionEvent['status'];
  nodeId?: string;
  roleSlotId?: string;
  route?: ArchitectureRouteDecision;
  routerOutput?: ArchitectureRouterOutput;
  reasonCode?: ArchitectureExecutionEvent['reasonCode'];
  errorCode?: ArchitectureExecutionEvent['errorCode'];
  failure?: ArchitectureExecutionEvent['failure'];
  evidence?: ArchitectureExecutionEvent['evidence'];
  runtimeDecision?: ArchitectureExecutionEvent['runtimeDecision'];
  data?: Record<string, unknown>;
};

export async function createArchitectureGraphEvents(options: GraphRuntimeOptions): Promise<ArchitectureExecutionEvent[]> {
  const runtime = new ArchitectureGraphRuntime(options);
  return runtime.createEvents();
}

class ArchitectureGraphRuntime {
  private readonly events: ArchitectureExecutionEvent[] = [];
  private readonly activeNodeIds = new Set<string>();
  private readonly nodeVisitCounts = new Map<string, number>();
  private readonly activeIncomingNodeIds = new Map<string, Set<string>>();
  private sequence = 0;

  constructor(private readonly options: GraphRuntimeOptions) {}

  async createEvents(): Promise<ArchitectureExecutionEvent[]> {
    this.seedPriorEvents();
    if (!this.options.resumeFrom) {
      this.push('run_created', `Architecture run created for: ${this.options.run.prompt}`, {
        actionSummary: architectureActionSummaryForEvent('run_created'),
        lifecycle: 'started',
        status: 'running',
        data: { rootSessionId: this.options.run.rootSessionId },
      });
    }

    const nodesById = new Map(this.options.schema.nodes.map((node) => [node.id, node]));
    const incoming = groupArchitectureEdges(this.options.schema, 'toNodeId');
    const outgoing = groupArchitectureEdges(this.options.schema, 'fromNodeId');
    const ready = this.readyNodesFromCursor(nodesById) ?? rootArchitectureNodes(this.options.schema, incoming);
    const queuedNodeIds = new Set(ready.map((node) => node.id));
    const maxVisitBlockedNodeIds = new Set<string>();
    ready.forEach((node) => this.activeNodeIds.add(node.id));
    const maxSteps = this.maxSteps();
    const maxNodeVisits = this.maxNodeVisits();
    let steps = 0;

    while (ready.length > 0 && steps < maxSteps) {
      const stepBudget = maxSteps - steps;
      const batch = ready.splice(0, stepBudget);
      batch.forEach((node) => queuedNodeIds.delete(node.id));
      const partition = partitionReadyNodesByVisitLimit({
        nodes: batch,
        maxNodeVisits,
        visitCount: (nodeId) => this.visitCount(nodeId),
      });
      partition.blockedNodeIds.forEach((nodeId) => maxVisitBlockedNodeIds.add(nodeId));
      if (partition.executableNodes.length === 0) {
        continue;
      }
      const executableBatch = partition.executableNodes;
      steps += executableBatch.length;

      const batchResults = await Promise.all(executableBatch.map(async (node) => {
        this.push('node_started', `${node.label} started.`, {
          actionSummary: architectureActionSummaryForEvent('node_started', node.kind),
          lifecycle: 'node_started',
          status: 'running',
          nodeId: node.id,
          roleSlotId: node.roleSlotId,
          data: { kind: node.kind, behavior: node.behavior ? { ...node.behavior } : undefined },
        });
        const outgoingNodeIds = outgoing.get(node.id) ?? [];
        let selectedNodeIds: string[];
        try {
          selectedNodeIds = await this.executeNode(
            node,
            this.incomingNodeIdsFor(node.id, incoming),
            outgoingNodeIds,
            nodesById,
          );
        } catch (error) {
          if (!this.isRecoverableNodeError(error)) {
            const failure = workflowFailureFromError(error);
            this.push('node_failed', `${node.label} failed.`, {
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
            throw error;
          }
          selectedNodeIds = this.handleRecoverableNodeError(node, outgoingNodeIds, error);
        }
        this.push('node_completed', `${node.label} completed.`, {
          lifecycle: 'node_completed',
          status: 'done',
          nodeId: node.id,
          roleSlotId: node.roleSlotId,
          data: { selectedNodeIds },
        });
        return { node, selectedNodeIds };
      }));

      for (const { node, selectedNodeIds } of batchResults) {
        this.nodeVisitCounts.set(node.id, this.visitCount(node.id) + 1);

        for (const nextNodeId of selectedNodeIds) {
          markActiveIncoming(this.activeIncomingNodeIds, nextNodeId, node.id);
          this.activeNodeIds.add(nextNodeId);
        }
      }

      const orchestratorHandoff = batchResults
        .map(({ node, selectedNodeIds }) => ({
          node,
          pendingNodeIds: returnToOrchestratorNodeIds({
            schema: this.options.schema,
            fromNodeId: node.id,
            selectedNodeIds,
            pauseEnabled: this.returnToOrchestratorPauseEnabled(),
          }),
        }))
        .find((handoff) => handoff.pendingNodeIds.length > 0);
      if (orchestratorHandoff) {
        this.push('router_decision', `${orchestratorHandoff.node.label} returned control to the orchestrator.`, {
          actionSummary: architectureActionSummaryForEvent('router_decision', orchestratorHandoff.node.kind),
          nodeId: orchestratorHandoff.node.id,
          roleSlotId: orchestratorHandoff.node.roleSlotId,
          reasonCode: 'return_to_orchestrator',
          data: {
            reasonCode: 'return_to_orchestrator',
            pendingNodeIds: orchestratorHandoff.pendingNodeIds,
            returnToOrchestrator: true,
            visitCounts: Object.fromEntries(this.nodeVisitCounts.entries()),
          },
        });
        return this.events;
      }

      for (const { selectedNodeIds } of batchResults) {
        for (const nextNodeId of selectedNodeIds) {
          const nextNode = nodesById.get(nextNodeId);
          if (!nextNode || queuedNodeIds.has(nextNodeId)) {
            continue;
          }
          if (this.visitCount(nextNodeId) >= maxNodeVisits) {
            maxVisitBlockedNodeIds.add(nextNodeId);
            continue;
          }
          if (this.nodeReady(nextNodeId, incoming)) {
            ready.push(nextNode);
            queuedNodeIds.add(nextNodeId);
          }
        }
      }
    }

    const limitDecision = runtimeLimitDecisionForPendingNodes({
      readyNodeIds: ready.map((node) => node.id),
      maxVisitBlockedNodeIds: Array.from(maxVisitBlockedNodeIds),
      maxSteps,
      maxNodeVisits,
      visitCounts: Object.fromEntries(this.nodeVisitCounts.entries()),
    });
    if (limitDecision) {
      this.push('router_decision', limitDecision.message, {
        actionSummary: architectureActionSummaryForEvent('router_decision'),
        reasonCode: limitDecision.reasonCode,
        data: limitDecision.data,
      });
    }

    return this.events;
  }

  private seedPriorEvents(): void {
    if (!this.options.priorEvents || this.options.priorEvents.length === 0) {
      return;
    }
    this.events.push(...this.options.priorEvents);
    this.sequence = Math.max(...this.options.priorEvents.map((event) => event.sequence), 0);
    for (const event of this.options.priorEvents) {
      if (event.nodeId) {
        this.activeNodeIds.add(event.nodeId);
      }
      const selectedNodeIds = selectedNodeIdsFromEvent(event);
      if (!event.nodeId || selectedNodeIds.length === 0) {
        continue;
      }
      for (const selectedNodeId of selectedNodeIds) {
        markActiveIncoming(this.activeIncomingNodeIds, selectedNodeId, event.nodeId);
        this.activeNodeIds.add(selectedNodeId);
      }
    }
    for (const [nodeId, count] of Object.entries(this.options.resumeFrom?.visitCounts ?? {})) {
      if (Number.isFinite(count) && count > 0) {
        this.nodeVisitCounts.set(nodeId, count);
      }
    }
  }

  private readyNodesFromCursor(
    nodesById: Map<string, ArchitectureSchemaNode>,
  ): ArchitectureSchemaNode[] | null {
    const acceptanceResumeNode = this.acceptanceResumeNode(nodesById);
    if (acceptanceResumeNode) {
      return [acceptanceResumeNode];
    }
    const pendingNodeIds = this.options.resumeFrom?.pendingNodeIds ?? [];
    const ready = pendingNodeIds
      .map((nodeId) => nodesById.get(nodeId))
      .filter((node): node is ArchitectureSchemaNode => node !== undefined);
    return ready.length > 0 ? ready : null;
  }

  private acceptanceResumeNode(
    nodesById: Map<string, ArchitectureSchemaNode>,
  ): ArchitectureSchemaNode | null {
    if (!externalQualityGateAcceptanceReason(this.finalizationInput())) {
      return null;
    }
    const lastCompletedNodeId = this.options.resumeFrom?.lastCompletedNodeId;
    if (lastCompletedNodeId) {
      const node = nodesById.get(lastCompletedNodeId);
      const slot = node ? this.options.schema.roleSlots.find((candidate) => candidate.id === node.roleSlotId) : undefined;
      if (node && slot?.slotType === 'judge') {
        return node;
      }
    }
    return this.lastCompletedJudgeNode(nodesById);
  }

  private lastCompletedJudgeNode(
    nodesById: Map<string, ArchitectureSchemaNode>,
  ): ArchitectureSchemaNode | null {
    for (const event of [...this.events].reverse()) {
      if (event.type !== 'node_completed' || !event.nodeId) {
        continue;
      }
      const node = nodesById.get(event.nodeId);
      const slot = node ? this.options.schema.roleSlots.find((candidate) => candidate.id === node.roleSlotId) : undefined;
      if (node && slot?.slotType === 'judge') {
        return node;
      }
    }
    return null;
  }

  private finalizationInput(): ArchitectureGraphFinalizationInput {
    return {
      schema: this.options.schema,
      runContext: this.options.run.context,
      events: this.events,
      priorEvents: this.options.priorEvents ?? [],
    };
  }

  private handleRecoverableNodeError(
    node: ArchitectureSchemaNode,
    outgoingNodeIds: string[],
    error: unknown,
  ): string[] {
    const incomingNodeIds = this.incomingNodeIdsFor(node.id);
    const decision = recoverableNodeErrorDecision({
      schema: this.options.schema,
      node,
      incomingNodeIds,
      outgoingNodeIds,
      error,
      synthesizedArtifactMessage: synthesizedArtifactMessage({
        node,
        incomingEvents: this.eventsForNodeIds(incomingNodeIds),
      }),
    });
    this.push(decision.event.type, decision.event.message, decision.event.options);
    return decision.selectedNodeIds;
  }

  private async executeNode(
    node: ArchitectureSchemaNode,
    incomingNodeIds: string[],
    outgoingNodeIds: string[],
    nodesById: Map<string, ArchitectureSchemaNode>,
  ): Promise<string[]> {
    if (node.kind === 'role' && node.roleSlotId) {
      return this.executeRoleNode(node, outgoingNodeIds);
    }

    if (node.kind === 'parallel' || node.kind === 'router') {
      return this.executeRoutingNode(node, incomingNodeIds, outgoingNodeIds, nodesById);
    }

    if (node.kind === 'artifact') {
      if (node.roleSlotId && this.options.run.executionMode === 'subagent_execution') {
        return this.executeFinalizerNode(node, incomingNodeIds, outgoingNodeIds);
      }
      const projection = finalArtifactFromSynthesizedGraphOutputs({
        node,
        incomingNodeIds,
        incomingEvents: this.eventsForNodeIds(incomingNodeIds),
        rootSessionId: this.options.run.rootSessionId,
        personaId: node.roleSlotId ? this.personaForRoleSlotId(node.roleSlotId) : undefined,
      });
      this.push('final_artifact', projection.message, projection.options);
    }

    return outgoingNodeIds;
  }

  private async executeRoleNode(node: ArchitectureSchemaNode, outgoingNodeIds: string[]): Promise<string[]> {
    const slot = this.options.schema.roleSlots.find((candidate) => candidate.id === node.roleSlotId);
    if (!slot || !this.shouldExecuteSlot(slot)) {
      return outgoingNodeIds;
    }
    const branchSessionId = this.options.run.branchSessionIds?.[slot.id];
    if (!branchSessionId) {
      throw new Error(`Missing branch session for role slot ${slot.id}`);
    }
    this.push('agent_started', `${slot.label} agent started.`, {
      actionSummary: architectureActionSummaryForEvent('agent_started', 'role'),
      nodeId: node.id,
      roleSlotId: slot.id,
      data: {
        branchSessionId,
        personaId: this.options.personaForSlot(slot),
        slotType: slot.slotType,
      },
    });
    const result = await this.options.roleExecutor.execute({
      schema: this.options.schema,
      run: this.options.run,
      slot,
      branchSessionId,
      personaId: this.options.personaForSlot(slot),
      node,
      incomingEvents: this.incomingEventsForSlot(slot, this.incomingNodeIdsFor(node.id)),
      outgoingNodeIds,
      emit: this.branchEventEmit(node, slot),
    });
    const toolContract = architectureToolExecutorContract({
      slot,
      data: result.data,
      incomingEvents: this.events,
      ...this.finalizationInput(),
    });
    if (!toolContract.ok) {
      throw createWorkflowError(
        'CONTRACT_VIOLATION',
        `Architecture tool executor ${slot.id} completed without required tool evidence: ${toolContract.reason}`,
        { source: 'architecture-graph-runtime' },
      );
    }
    const incompleteReason = architectureIncompleteResultReason(result.data)
      ?? incompleteToolExecutorReason({ slot, data: result.data, incomingEvents: this.events });
    const selectedNodeIds = incompleteReason
      ? this.incompleteContinuationNodeIds(outgoingNodeIds, node.id, defaultOutgoingNodeId(this.options.schema, node.id, outgoingNodeIds))
      : selectedRoleOutgoingNodeIds({ data: result.data, outgoingNodeIds });
    const requestedRoute = routeRequest(result.data);
    const hasAgentRoute = !incompleteReason && requestedRoute !== undefined && outgoingNodeIds.includes(requestedRoute.targetNodeId);
    this.push('participant_output', result.message, {
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
        incomingNodeIds: this.incomingNodeIdsFor(node.id),
        selectedNodeIds,
      },
    });
    return selectedNodeIds;
  }

  private async executeRoutingNode(
    node: ArchitectureSchemaNode,
    incomingNodeIds: string[],
    outgoingNodeIds: string[],
    nodesById: Map<string, ArchitectureSchemaNode>,
  ): Promise<string[]> {
    if (
      node.kind === 'router'
      && node.roleSlotId
      && this.options.run.executionMode === 'subagent_execution'
    ) {
      return this.executeRouterRoleNode(node, incomingNodeIds, outgoingNodeIds, nodesById);
    }
    return this.executeRoutingNodeSync(node, incomingNodeIds, outgoingNodeIds, nodesById);
  }

  private async executeRouterRoleNode(
    node: ArchitectureSchemaNode,
    incomingNodeIds: string[],
    outgoingNodeIds: string[],
    nodesById: Map<string, ArchitectureSchemaNode>,
  ): Promise<string[]> {
    const slot = this.options.schema.roleSlots.find((candidate) => candidate.id === node.roleSlotId);
    if (!slot) {
      return this.executeRoutingFallbackNode(node, incomingNodeIds, outgoingNodeIds, nodesById);
    }
    const branchSessionId = this.options.run.branchSessionIds?.[slot.id];
    if (!branchSessionId) {
      throw new Error(`Missing branch session for role slot ${slot.id}`);
    }
    const result = await this.options.roleExecutor.execute({
      schema: this.options.schema,
      run: this.options.run,
      slot,
      branchSessionId,
      personaId: this.options.personaForSlot(slot),
      node,
      incomingEvents: this.incomingEventsForSlot(slot, incomingNodeIds),
      outgoingNodeIds,
      emit: this.branchEventEmit(node, slot),
    });
    const fallbackNodeIds = selectedOutgoingNodeIds({ schema: this.options.schema, node, outgoingNodeIds });
    const incompleteReason = architectureIncompleteResultReason(result.data);
    const requestedRoute = routeRequest(result.data);
    const canAgentRouteOverride = node.behavior?.mode !== 'fan_out_all';
    const hasAgentRoute = canAgentRouteOverride
      && !incompleteReason
      && requestedRoute !== undefined
      && outgoingNodeIds.includes(requestedRoute.targetNodeId);
    const defaultNodeId = defaultOutgoingNodeId(this.options.schema, node.id, outgoingNodeIds);
    const requestedSelectedNodeIds = incompleteReason
      ? this.incompleteContinuationNodeIds(outgoingNodeIds, node.id, defaultNodeId)
      : hasAgentRoute
      ? [requestedRoute.targetNodeId]
      : fallbackNodeIds;
    const guard = judgeArchitectureContinuationGuard({
      slot,
      node,
      schema: this.options.schema,
      requireGoalMasterLoopProof: this.options.run.context?.['requireGoalMasterLoopProof'] === true,
      incomingNodeIds,
      selectedNodeIds: requestedSelectedNodeIds,
      outgoingNodeIds,
      finalizationInput: this.finalizationInput(),
      events: this.events,
    });
    let finalSelectedNodeIds = guard.selectedNodeIds;
    let rejectedNodeIds = outgoingNodeIds.filter((nodeId) => !finalSelectedNodeIds.includes(nodeId));
    let route: ArchitectureRouteDecision = {
      source: incompleteReason || guard.applied ? 'runtime_fallback' : hasAgentRoute ? 'agent' : 'router',
      fromNodeId: node.id,
      selectedNodeIds: finalSelectedNodeIds,
      rejectedNodeIds,
      nextNodeId: finalSelectedNodeIds[0],
      convergeToNodeId: routeConvergeNodeId({ schema: this.options.schema, node, outgoingNodeIds }),
      mode: node.behavior?.mode,
      response: incompleteReason ?? guard.reason ?? requestedRoute?.response,
    };
    let routerOutput = this.toRouterOutput(
      node,
      incomingNodeIds,
      route,
      result.message,
      result.data,
    );
    const actionTargetNodeId = routerActionTargetNodeId({
      schema: this.options.schema,
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
    this.push('router_decision', result.message, {
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
        outgoingNodeIds,
        incompleteReason,
        runtimeGuard: incompleteReason ?? (guard.applied ? guard.reason : undefined),
        rejectedNodeIds,
        selectedNodeIds: finalSelectedNodeIds,
      },
    });
    this.push('router_output', routerOutput.mergedDecision, {
      actionSummary: architectureActionSummaryForEvent('router_output', 'router'),
      nodeId: node.id,
      roleSlotId: slot.id,
      route,
      routerOutput,
    });
    if (isRouterPauseAction(routerOutput.nextAction)) {
      this.pushRouterRuntimePause(node, route, routerOutput, slot.id);
      return [];
    }
    return finalSelectedNodeIds;
  }

  private executeRoutingFallbackNode(
    node: ArchitectureSchemaNode,
    incomingNodeIds: string[],
    outgoingNodeIds: string[],
    nodesById: Map<string, ArchitectureSchemaNode>,
  ): string[] {
    return this.executeRoutingNodeSync(node, incomingNodeIds, outgoingNodeIds, nodesById);
  }

  private executeRoutingNodeSync(
    node: ArchitectureSchemaNode,
    incomingNodeIds: string[],
    outgoingNodeIds: string[],
    nodesById: Map<string, ArchitectureSchemaNode>,
  ): string[] {
    const behavior = node.behavior;
    let selectedNodeIds = selectedOutgoingNodeIds({ schema: this.options.schema, node, outgoingNodeIds });
    let rejectedNodeIds = outgoingNodeIds.filter((nodeId) => !selectedNodeIds.includes(nodeId));
    let nextNodeId = selectedNodeIds[0];
    let nextLabel = nextNodeId ? nodesById.get(nextNodeId)?.label ?? nextNodeId : 'end';
    let message = routingMessage(node, nextLabel, selectedNodeIds.length);
    let route: ArchitectureRouteDecision = {
      source: node.kind === 'parallel' ? 'parallel' : 'router',
      fromNodeId: node.id,
      selectedNodeIds,
      rejectedNodeIds,
      nextNodeId,
      convergeToNodeId: routeConvergeNodeId({ schema: this.options.schema, node, outgoingNodeIds }),
      mode: behavior?.mode,
    };
    let routerOutput = node.kind === 'router'
      ? this.toRouterOutput(node, incomingNodeIds, route, message, {})
      : undefined;
    const actionTargetNodeId = routerOutput
      ? routerActionTargetNodeId({
        schema: this.options.schema,
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
        this.toRouterOutput(node, incomingNodeIds, route, message, {}),
        actionTargetNodeId,
      );
    }
    this.push('router_decision', message, {
      actionSummary: architectureActionSummaryForEvent('router_decision', node.kind),
      nodeId: node.id,
      roleSlotId: node.roleSlotId,
      route,
      routerOutput,
      data: {
        behavior: behavior ? { ...behavior } : undefined,
        branchSessionIds: this.options.run.branchSessionIds,
        convergeToNodeId: route.convergeToNodeId,
        incomingNodeIds,
        nextNodeId,
        outgoingNodeIds,
        rejectedNodeIds,
        rootSessionId: this.options.run.rootSessionId,
        selectedNodeIds,
      },
    });
    if (routerOutput) {
      this.push('router_output', routerOutput.mergedDecision, {
        actionSummary: architectureActionSummaryForEvent('router_output', node.kind),
        nodeId: node.id,
        roleSlotId: node.roleSlotId,
        route,
        routerOutput,
      });
      if (isRouterPauseAction(routerOutput.nextAction)) {
        this.pushRouterRuntimePause(node, route, routerOutput);
        return [];
      }
    }
    return selectedNodeIds;
  }

  private pushRouterRuntimePause(
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
    this.push('human_gate', routerOutput.mergedDecision || `${node.label} requested human input.`, {
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

  private async executeFinalizerNode(
    node: ArchitectureSchemaNode,
    incomingNodeIds: string[],
    outgoingNodeIds: string[],
  ): Promise<string[]> {
    const blockingReason = blockingFinalizationReason(this.finalizationInput());
    if (blockingReason) {
      throw new Error(`Architecture finalization blocked: ${blockingReason}`);
    }
    const slot = this.options.schema.roleSlots.find((candidate) => candidate.id === node.roleSlotId);
    if (!slot) {
      return outgoingNodeIds;
    }
    const branchSessionId = this.options.run.branchSessionIds?.[slot.id];
    if (!branchSessionId) {
      throw new Error(`Missing branch session for role slot ${slot.id}`);
    }
    const result = await this.options.roleExecutor.execute({
      schema: this.options.schema,
      run: this.options.run,
      slot,
      branchSessionId,
      personaId: this.options.personaForSlot(slot),
      node,
      incomingEvents: this.incomingEventsForSlot(slot, incomingNodeIds),
      outgoingNodeIds,
      emit: this.options.emit,
    });
    const projection = finalArtifactFromRoleResult({
      node,
      slot,
      branchSessionId,
      message: result.message,
      data: result.data,
      incomingNodeIds,
      outgoingNodeIds,
    });
    this.push('final_artifact', projection.message, projection.options);
    return outgoingNodeIds;
  }

  private incomingEventsForSlot(slot: ArchitectureRoleSlot, incomingNodeIds: string[]): ArchitectureExecutionEvent[] {
    if (slot.slotType !== 'judge' && slot.slotType !== 'finalizer') {
      return this.eventsForNodeIds(incomingNodeIds);
    }
    return this.events.filter((event) => (
      event.type === 'participant_output'
      || event.type === 'router_decision'
      || event.type === 'router_output'
      || event.type === 'artifact_created'
    ));
  }

  private incompleteContinuationNodeIds(
    outgoingNodeIds: string[],
    sourceNodeId: string,
    defaultNodeId: string | undefined,
  ): string[] {
    const nextNodeId = continuationOutgoingNodeId({
      schema: this.options.schema,
      sourceNodeId,
      incomingNodeIds: [],
      outgoingNodeIds,
      defaultNodeId,
    })
      ?? outgoingNodeIds[0];
    return nextNodeId ? [nextNodeId] : [];
  }

  private isRecoverableNodeError(error: unknown): boolean {
    return isWorkflowError(error, 'RATE_LIMITED')
      || isWorkflowError(error, 'TIMEOUT')
      || isWorkflowError(error, 'PROVIDER_UNAVAILABLE');
  }

  private toRouterOutput(
    node: ArchitectureSchemaNode,
    incomingNodeIds: string[],
    route: ArchitectureRouteDecision,
    message: string,
    data: Record<string, unknown>,
  ): ArchitectureRouterOutput {
    return createArchitectureRouterOutput({
      schema: this.options.schema,
      node,
      incomingNodeIds,
      route,
      message,
      data,
    });
  }

  private push(
    type: ArchitectureExecutionEvent['type'],
    message: string,
    options: EventOptions = {},
  ): void {
    this.sequence += 1;
    const actionFields = architectureActionFieldsForEvent({
      type,
      actionSummary: options.actionSummary,
      route: options.route,
      routerOutput: options.routerOutput,
      data: options.data,
    });
    const event = {
      id: `${this.options.run.id}:event:${this.sequence}`,
      runId: this.options.run.id,
      sequence: this.sequence,
      type,
      message,
      actionSummary: actionFields.actionSummary,
      action: actionFields.action,
      detail: actionFields.detail,
      nodeId: options.nodeId,
      roleSlotId: options.roleSlotId,
      route: options.route,
      routerOutput: options.routerOutput,
      lifecycle: options.lifecycle,
      status: options.status,
      reasonCode: options.reasonCode,
      errorCode: options.errorCode,
      failure: options.failure,
      evidence: options.evidence,
      runtimeDecision: options.runtimeDecision,
      data: options.data,
      createdAt: this.options.now + this.sequence,
    };
    this.events.push(event);
    this.options.onEvent?.(event);
  }

  private branchEventEmit(
    node: ArchitectureSchemaNode,
    slot: ArchitectureRoleSlot,
  ): NonNullable<ArchitectureRoleExecutionInput['emit']> {
    return (event, data) => {
      this.pushBranchStreamEvent(node, slot, event, data);
      this.options.emit?.(event, data);
    };
  }

  private pushBranchStreamEvent(
    node: ArchitectureSchemaNode,
    slot: ArchitectureRoleSlot,
    event: string,
    data: unknown,
  ): void {
    const projection = architectureBranchStreamProjection({ node, slot, event, data });
    if (projection) {
      this.push(projection.type, projection.message, projection.options);
    }
  }

  private returnToOrchestratorPauseEnabled(): boolean {
    return this.options.run.context?.['enableReturnToOrchestratorPause'] === true
      || this.isRecord(this.options.run.context?.['subAgentFlow']);
  }

  private nodeReady(nodeId: string, incoming: Map<string, string[]>): boolean {
    return isNodeReady({
      schema: this.options.schema,
      nodeId,
      fallback: incoming,
      activeNodeIds: this.activeNodeIds,
      activeIncomingNodeIds: this.activeIncomingNodeIds,
      visitCount: (incomingNodeId) => this.visitCount(incomingNodeId),
    });
  }

  private incomingNodeIdsFor(nodeId: string, fallback?: Map<string, string[]>): string[] {
    return incomingNodeIdsFor({
      schema: this.options.schema,
      nodeId,
      fallback,
      activeNodeIds: this.activeNodeIds,
      activeIncomingNodeIds: this.activeIncomingNodeIds,
    });
  }

  private visitCount(nodeId: string): number {
    return this.nodeVisitCounts.get(nodeId) ?? 0;
  }

  private maxSteps(): number {
    const configured = this.options.run.context?.['maxArchitectureSteps'];
    return typeof configured === 'number' && Number.isInteger(configured) && configured > 0
      ? configured
      : Math.max((this.options.schema.nodes.length * 8) + (this.options.schema.edges.length * 4) + 1, 16);
  }

  private maxNodeVisits(): number {
    const configured = this.options.run.context?.['maxArchitectureNodeVisits'];
    return typeof configured === 'number' && Number.isInteger(configured) && configured > 0 ? configured : 4;
  }

  private eventsForNodeIds(nodeIds: string[]): ArchitectureExecutionEvent[] {
    const nodeIdSet = new Set(nodeIds);
    return this.events.filter((event) => event.nodeId !== undefined && nodeIdSet.has(event.nodeId));
  }

  private personaForRoleSlotId(roleSlotId: string): string | undefined {
    const slot = this.options.schema.roleSlots.find((candidate) => candidate.id === roleSlotId);
    return slot ? this.options.personaForSlot(slot) : undefined;
  }

  private shouldExecuteSlot(slot: ArchitectureRoleSlot): boolean {
    return slot.slotType === 'participant'
      || slot.slotType === 'critic'
      || slot.slotType === 'tool_executor';
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }
}
