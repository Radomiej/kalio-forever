import type { AgentFlowContinuationCursor, ArchitectureExecutionEvent, ArchitectureNodeBehaviorMode, ArchitectureRoleSlot, ArchitectureRouteDecision, ArchitectureRouterOutput, ArchitectureRun, ArchitectureSchema, ArchitectureSchemaEdge, ArchitectureSchemaNode } from '@kalio/types';
import type { ArchitectureRoleExecutionInput, ArchitectureRoleExecutor } from './architecture-role-executor';
import { architectureActionFieldsForEvent, architectureActionSummaryForEvent } from './architecture-action-summary';
import { isCompletedCliChildStatus } from './architecture-cli-child-status';
import { createArchitectureRouterOutput } from './architecture-router-output';
import { structuredRouteToCall } from './architecture-structured-output';
import { isWorkflowError, workflowFailureFromError } from '../../common/utils/workflow-error.util';

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

type AgentRouteRequest = {
  targetNodeId: string;
  response?: string;
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
    const incoming = this.groupEdges('toNodeId');
    const outgoing = this.groupEdges('fromNodeId');
    const ready = this.readyNodesFromCursor(nodesById) ?? this.rootNodes(incoming);
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
      const executableBatch = batch.filter((node) => this.visitCount(node.id) < maxNodeVisits);
      if (executableBatch.length === 0) {
        continue;
      }
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
          this.markActiveIncoming(nextNodeId, node.id);
          this.activeNodeIds.add(nextNodeId);
        }
      }

      const orchestratorHandoff = batchResults
        .map(({ node, selectedNodeIds }) => ({
          node,
          pendingNodeIds: this.returnToOrchestratorNodeIds(node.id, selectedNodeIds),
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

    if (ready.length > 0 || maxVisitBlockedNodeIds.size > 0) {
      const pendingNodeIds = ready.length > 0
        ? ready.map((node) => node.id)
        : Array.from(maxVisitBlockedNodeIds);
      const reasonCode = ready.length > 0 ? 'max_steps' : 'max_node_visits';
      const reason = ready.length > 0
        ? `Runtime stopped after ${maxSteps} graph steps.`
        : `Runtime stopped after reaching max node visits.`;
      this.push('router_decision', reason, {
        actionSummary: architectureActionSummaryForEvent('router_decision'),
        reasonCode,
        data: {
          reasonCode,
          maxNodeVisits,
          maxSteps,
          pendingNodeIds,
          visitCounts: Object.fromEntries(this.nodeVisitCounts.entries()),
        },
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
      const selectedNodeIds = this.selectedNodeIdsFromEvent(event);
      if (!event.nodeId || selectedNodeIds.length === 0) {
        continue;
      }
      for (const selectedNodeId of selectedNodeIds) {
        this.markActiveIncoming(selectedNodeId, event.nodeId);
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
    if (!this.externalQualityGateAcceptanceReason()) {
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

  private selectedNodeIdsFromEvent(event: ArchitectureExecutionEvent): string[] {
    const selected = event.route?.selectedNodeIds ?? event.data?.['selectedNodeIds'];
    return Array.isArray(selected)
      ? selected.filter((nodeId): nodeId is string => typeof nodeId === 'string' && nodeId.length > 0)
      : [];
  }

  private handleRecoverableNodeError(
    node: ArchitectureSchemaNode,
    outgoingNodeIds: string[],
    error: unknown,
  ): string[] {
    const failure = workflowFailureFromError(error);
    const message = `${node.label} degraded after recoverable runtime error: ${this.errorMessage(error)}`;
    const selectedNodeIds = this.incompleteContinuationNodeIds(
      outgoingNodeIds,
      node.id,
      this.defaultOutgoingNodeId(node.id, outgoingNodeIds),
    );
    const data = {
      runtimeGuard: 'recoverable_node_error',
      errorCode: failure.code,
      failure,
      errorMessage: this.errorMessage(error),
      incomingNodeIds: this.incomingNodeIdsFor(node.id),
      outgoingNodeIds,
      selectedNodeIds,
      incompleteReason: 'Recoverable runtime error prevented this node from producing a final answer.',
    };

    if (node.kind === 'role') {
      this.push('participant_output', message, {
        actionSummary: architectureActionSummaryForEvent('participant_output', 'role'),
        nodeId: node.id,
        roleSlotId: node.roleSlotId,
        errorCode: failure.code,
        failure,
        route: {
          source: 'runtime_fallback',
          fromNodeId: node.id,
          selectedNodeIds,
          rejectedNodeIds: outgoingNodeIds.filter((nodeId) => !selectedNodeIds.includes(nodeId)),
          nextNodeId: selectedNodeIds[0],
          response: data.incompleteReason,
        },
        data,
      });
      return selectedNodeIds;
    }

    if (node.kind === 'artifact') {
      const synthesized = this.synthesizedArtifactMessage(node, this.incomingNodeIdsFor(node.id));
      this.push('final_artifact', `${message}\n\n${synthesized}`, {
        actionSummary: architectureActionSummaryForEvent('final_artifact', 'artifact'),
        nodeId: node.id,
        roleSlotId: node.roleSlotId,
        errorCode: failure.code,
        failure,
        data,
      });
      return selectedNodeIds;
    }

    this.push('router_decision', message, {
      actionSummary: architectureActionSummaryForEvent('router_decision', node.kind),
      nodeId: node.id,
      roleSlotId: node.roleSlotId,
      errorCode: failure.code,
      failure,
      route: {
        source: 'runtime_fallback',
        fromNodeId: node.id,
        selectedNodeIds,
        rejectedNodeIds: outgoingNodeIds.filter((nodeId) => !selectedNodeIds.includes(nodeId)),
        nextNodeId: selectedNodeIds[0],
        response: data.incompleteReason,
      },
      data,
    });
    return selectedNodeIds;
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
      this.push('final_artifact', this.synthesizedArtifactMessage(node, incomingNodeIds), {
        actionSummary: architectureActionSummaryForEvent('final_artifact', 'artifact'),
        lifecycle: 'done',
        status: 'done',
        nodeId: node.id,
        roleSlotId: node.roleSlotId,
        reasonCode: 'final_artifact_accepted',
        evidence: [{
          kind: 'FINAL_ARTIFACT',
          source: node.roleSlotId ?? node.id,
          status: 'passed',
          data: {
            nodeId: node.id,
            roleSlotId: node.roleSlotId,
            rootSessionId: this.options.run.rootSessionId,
          },
        }],
        runtimeDecision: {
          status: 'done',
          accepted: true,
          reasonCode: 'final_artifact_accepted',
        },
        data: {
          reasonCode: 'final_artifact_accepted',
          runtimeDecision: {
            status: 'done',
            accepted: true,
            reasonCode: 'final_artifact_accepted',
          },
          rootSessionId: this.options.run.rootSessionId,
          personaId: node.roleSlotId ? this.personaForRoleSlotId(node.roleSlotId) : undefined,
          incomingNodeIds,
        },
      });
    }

    return outgoingNodeIds;
  }

  private synthesizedArtifactMessage(node: ArchitectureSchemaNode, incomingNodeIds: string[]): string {
    const incomingEvents = this.eventsForNodeIds(incomingNodeIds)
      .filter((event) => (
        event.type === 'participant_output'
        || event.type === 'router_decision'
        || event.type === 'router_output'
      ));
    if (incomingEvents.length === 0) {
      return `${node.label} synthesized from graph execution.`;
    }
    const sections = incomingEvents.map((event) => {
      const label = event.roleSlotId ?? event.nodeId ?? event.type;
      return `From ${label}:\n${event.message}`;
    });
    return `${node.label}\n\n${sections.join('\n\n')}`;
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
    const toolContract = this.toolExecutorContract(
      slot,
      result.data,
      this.events,
    );
    if (!toolContract.ok) {
      throw new Error(`Architecture tool executor ${slot.id} completed without required tool evidence: ${toolContract.reason}`);
    }
    const incompleteReason = this.incompleteResultReason(result.data)
      ?? this.incompleteToolExecutorReason(slot, result.data, this.events);
    const selectedNodeIds = incompleteReason
      ? this.incompleteContinuationNodeIds(outgoingNodeIds, node.id, this.defaultOutgoingNodeId(node.id, outgoingNodeIds))
      : this.selectedRoleOutgoingNodeIds(result.data, outgoingNodeIds);
    const routeRequest = this.routeRequest(result.data);
    const hasAgentRoute = !incompleteReason && routeRequest !== undefined && outgoingNodeIds.includes(routeRequest.targetNodeId);
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
        response: incompleteReason ?? (hasAgentRoute ? routeRequest.response : undefined),
      },
      evidence: this.workflowEvidenceArray(result.data),
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
    const fallbackNodeIds = this.selectedOutgoingNodeIds(node, outgoingNodeIds);
    const incompleteReason = this.incompleteResultReason(result.data);
    const routeRequest = this.routeRequest(result.data);
    const canAgentRouteOverride = node.behavior?.mode !== 'fan_out_all';
    const hasAgentRoute = canAgentRouteOverride
      && !incompleteReason
      && routeRequest !== undefined
      && outgoingNodeIds.includes(routeRequest.targetNodeId);
    const defaultNodeId = this.defaultOutgoingNodeId(node.id, outgoingNodeIds);
    const requestedSelectedNodeIds = incompleteReason
      ? this.incompleteContinuationNodeIds(outgoingNodeIds, node.id, defaultNodeId)
      : hasAgentRoute
      ? [routeRequest.targetNodeId]
      : fallbackNodeIds;
    const guard = this.judgeContinuationGuard(slot, node, incomingNodeIds, requestedSelectedNodeIds, outgoingNodeIds);
    let finalSelectedNodeIds = guard.selectedNodeIds;
    let rejectedNodeIds = outgoingNodeIds.filter((nodeId) => !finalSelectedNodeIds.includes(nodeId));
    let route: ArchitectureRouteDecision = {
      source: incompleteReason || guard.applied ? 'runtime_fallback' : hasAgentRoute ? 'agent' : 'router',
      fromNodeId: node.id,
      selectedNodeIds: finalSelectedNodeIds,
      rejectedNodeIds,
      nextNodeId: finalSelectedNodeIds[0],
      convergeToNodeId: this.routeConvergeNodeId(node, outgoingNodeIds),
      mode: node.behavior?.mode,
      response: incompleteReason ?? guard.reason ?? routeRequest?.response,
    };
    let routerOutput = this.toRouterOutput(
      node,
      incomingNodeIds,
      route,
      result.message,
      result.data,
    );
    const actionTargetNodeId = this.routerOutputActionTargetNodeId(routerOutput, node.id, outgoingNodeIds);
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
      routerOutput = this.withRouterActionTarget(routerOutput, actionTargetNodeId);
    }
    this.push('router_decision', result.message, {
      actionSummary: architectureActionSummaryForEvent('router_decision', 'router'),
      nodeId: node.id,
      roleSlotId: slot.id,
      route,
      routerOutput,
      evidence: this.workflowEvidenceArray(result.data),
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
    if (this.isRouterPauseAction(routerOutput.nextAction)) {
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
    let selectedNodeIds = this.selectedOutgoingNodeIds(node, outgoingNodeIds);
    let rejectedNodeIds = outgoingNodeIds.filter((nodeId) => !selectedNodeIds.includes(nodeId));
    let nextNodeId = selectedNodeIds[0];
    let nextLabel = nextNodeId ? nodesById.get(nextNodeId)?.label ?? nextNodeId : 'end';
    let message = this.routingMessage(node, nextLabel, selectedNodeIds.length);
    let route: ArchitectureRouteDecision = {
      source: node.kind === 'parallel' ? 'parallel' : 'router',
      fromNodeId: node.id,
      selectedNodeIds,
      rejectedNodeIds,
      nextNodeId,
      convergeToNodeId: this.routeConvergeNodeId(node, outgoingNodeIds),
      mode: behavior?.mode,
    };
    let routerOutput = node.kind === 'router'
      ? this.toRouterOutput(node, incomingNodeIds, route, message, {})
      : undefined;
    const actionTargetNodeId = routerOutput
      ? this.routerOutputActionTargetNodeId(routerOutput, node.id, outgoingNodeIds)
      : undefined;
    if (routerOutput && actionTargetNodeId) {
      selectedNodeIds = [actionTargetNodeId];
      rejectedNodeIds = outgoingNodeIds.filter((nodeId) => nodeId !== actionTargetNodeId);
      nextNodeId = actionTargetNodeId;
      nextLabel = nodesById.get(nextNodeId)?.label ?? nextNodeId;
      message = this.routingMessage(node, nextLabel, selectedNodeIds.length);
      route = {
        ...route,
        selectedNodeIds,
        rejectedNodeIds,
        nextNodeId,
        response: routerOutput.response ?? routerOutput.mergedDecision,
      };
      routerOutput = {
        ...this.toRouterOutput(node, incomingNodeIds, route, message, {}),
        targetNodeId: actionTargetNodeId,
      };
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
      if (this.isRouterPauseAction(routerOutput.nextAction)) {
        this.pushRouterRuntimePause(node, route, routerOutput);
        return [];
      }
    }
    return selectedNodeIds;
  }

  private isRouterPauseAction(nextAction: ArchitectureRouterOutput['nextAction']): boolean {
    return nextAction === 'ask_human' || nextAction === 'rerun_with_different_personas';
  }

  private routerOutputActionTargetNodeId(
    routerOutput: ArchitectureRouterOutput,
    sourceNodeId: string,
    outgoingNodeIds: string[],
  ): string | undefined {
    if (routerOutput.nextAction !== 'run_more_research') {
      return undefined;
    }
    if (routerOutput.targetNodeId && outgoingNodeIds.includes(routerOutput.targetNodeId)) {
      return routerOutput.targetNodeId;
    }
    return this.outgoingNodeIdForSelection(sourceNodeId, outgoingNodeIds, 'continuation');
  }

  private withRouterActionTarget(
    routerOutput: ArchitectureRouterOutput,
    targetNodeId: string,
  ): ArchitectureRouterOutput {
    return {
      ...routerOutput,
      selectedStrategy: targetNodeId,
      targetNodeId,
    };
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
      actionSummary: this.routerPauseActionSummary(routerOutput.nextAction),
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

  private routerPauseActionSummary(nextAction: ArchitectureRouterOutput['nextAction']): string {
    return nextAction === 'rerun_with_different_personas'
      ? 'Waiting for orchestrator persona rerun decision.'
      : 'Waiting for human routing decision.';
  }

  private async executeFinalizerNode(
    node: ArchitectureSchemaNode,
    incomingNodeIds: string[],
    outgoingNodeIds: string[],
  ): Promise<string[]> {
    const blockingReason = this.blockingFinalizationReason();
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
    this.push('final_artifact', result.message, {
      actionSummary: architectureActionSummaryForEvent('final_artifact', 'artifact'),
      lifecycle: 'done',
      status: 'done',
      nodeId: node.id,
      roleSlotId: slot.id,
      reasonCode: 'final_artifact_accepted',
      evidence: [{
        kind: 'FINAL_ARTIFACT',
        source: slot.id,
        status: 'passed',
        data: {
          ...result.data,
          nodeId: node.id,
          roleSlotId: slot.id,
          branchSessionId,
        },
      }],
      runtimeDecision: {
        status: 'done',
        accepted: true,
        reasonCode: 'final_artifact_accepted',
      },
      data: {
        ...result.data,
        reasonCode: 'final_artifact_accepted',
        runtimeDecision: {
          status: 'done',
          accepted: true,
          reasonCode: 'final_artifact_accepted',
        },
        incomingNodeIds,
        outgoingNodeIds,
      },
    });
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

  private selectedOutgoingNodeIds(node: ArchitectureSchemaNode, outgoingNodeIds: string[]): string[] {
    if (outgoingNodeIds.length === 0) {
      return [];
    }
    const mode = node.behavior?.mode;
    const explicitSelection = this.selectedOutgoingNodeIdsFromEdges(node.id, mode, outgoingNodeIds);
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

  private selectedOutgoingNodeIdsFromEdges(
    sourceNodeId: string,
    mode: ArchitectureNodeBehaviorMode | undefined,
    outgoingNodeIds: string[],
  ): string[] | undefined {
    const outgoingEdges = this.options.schema.edges.filter((edge) =>
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

  private outgoingNodeIdForSelection(
    sourceNodeId: string,
    outgoingNodeIds: string[],
    selection: NonNullable<ArchitectureSchemaEdge['selection']>,
  ): string | undefined {
    return this.options.schema.edges.find((edge) =>
      edge.fromNodeId === sourceNodeId
      && outgoingNodeIds.includes(edge.toNodeId)
      && edge.selection === selection)?.toNodeId;
  }

  private defaultOutgoingNodeId(sourceNodeId: string, outgoingNodeIds: string[]): string | undefined {
    const defaultEdge = this.options.schema.edges.find((edge) =>
      edge.fromNodeId === sourceNodeId
      && edge.selection === 'default'
      && outgoingNodeIds.includes(edge.toNodeId));
    return defaultEdge?.toNodeId;
  }

  private routeConvergeNodeId(node: ArchitectureSchemaNode, outgoingNodeIds: string[]): string | undefined {
    const convergeEdge = this.options.schema.edges.find((edge) =>
      edge.fromNodeId === node.id
      && edge.selection === 'converge'
      && outgoingNodeIds.includes(edge.toNodeId));
    if (convergeEdge) {
      return convergeEdge.toNodeId;
    }
    if (node.kind !== 'parallel' && node.behavior?.mode !== 'fan_out_all') {
      return undefined;
    }
    const branchConvergeTargets = new Set(
      this.options.schema.edges
        .filter((edge) => outgoingNodeIds.includes(edge.fromNodeId) && edge.selection === 'converge')
        .map((edge) => edge.toNodeId),
    );
    return branchConvergeTargets.size === 1
      ? [...branchConvergeTargets][0]
      : undefined;
  }

  private continuationOutgoingNodeId(
    sourceNodeId: string,
    incomingNodeIds: string[],
    outgoingNodeIds: string[],
    defaultNodeId: string | undefined,
  ): string | undefined {
    const continuationEdge = this.options.schema.edges.find((edge) =>
      edge.fromNodeId === sourceNodeId
      && edge.selection === 'continuation'
      && outgoingNodeIds.includes(edge.toNodeId));
    if (continuationEdge) {
      return continuationEdge.toNodeId;
    }
    const nonDefaultNodeIds = outgoingNodeIds.filter((nodeId) => nodeId !== defaultNodeId);
    return nonDefaultNodeIds.find((nodeId) => incomingNodeIds.includes(nodeId)) ?? nonDefaultNodeIds[0];
  }

  private selectedRoleOutgoingNodeIds(data: Record<string, unknown>, outgoingNodeIds: string[]): string[] {
    const routeRequest = this.routeRequest(data);
    if (routeRequest && outgoingNodeIds.includes(routeRequest.targetNodeId)) {
      return [routeRequest.targetNodeId];
    }
    return outgoingNodeIds;
  }

  private incompleteResultReason(data: Record<string, unknown> | undefined): string | undefined {
    if (!this.isRecord(data)) return undefined;
    const displayReason = typeof data['incompleteReason'] === 'string' && data['incompleteReason'].trim().length > 0
      ? data['incompleteReason']
      : undefined;
    const failure = this.isRecord(data['failure']) ? data['failure'] : undefined;
    if (failure?.['retryable'] === true || this.isRecoverableWorkflowErrorCode(data['errorCode'])) {
      return displayReason ?? 'Recoverable runtime error prevented this node from producing a final answer.';
    }
    if (data['boundedToolLoopExhausted'] === true || data['reasonCode'] === 'max_steps') {
      return displayReason ?? 'Subagent exhausted its tool loop without producing a final answer.';
    }
    return undefined;
  }

  private incompleteContinuationNodeIds(
    outgoingNodeIds: string[],
    sourceNodeId: string,
    defaultNodeId: string | undefined,
  ): string[] {
    const nextNodeId = this.continuationOutgoingNodeId(sourceNodeId, [], outgoingNodeIds, defaultNodeId)
      ?? outgoingNodeIds[0];
    return nextNodeId ? [nextNodeId] : [];
  }

  private isRecoverableNodeError(error: unknown): boolean {
    return isWorkflowError(error, 'RATE_LIMITED')
      || isWorkflowError(error, 'TIMEOUT')
      || isWorkflowError(error, 'PROVIDER_UNAVAILABLE');
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }

  private routeRequest(data: Record<string, unknown>): AgentRouteRequest | undefined {
    const structuredRoute = structuredRouteToCall(data['routerOutput']);
    return structuredRoute
      ? { targetNodeId: structuredRoute.targetNodeId, response: structuredRoute.response }
      : undefined;
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

  private judgeContinuationGuard(
    slot: ArchitectureRoleSlot,
    node: ArchitectureSchemaNode,
    incomingNodeIds: string[],
    selectedNodeIds: string[],
    outgoingNodeIds: string[],
  ): { selectedNodeIds: string[]; applied: boolean; reason?: string } {
    if (slot.slotType !== 'judge' || this.options.run.context?.['requireGoalMasterLoopProof'] !== true) {
      return { selectedNodeIds, applied: false };
    }
    const finalNodeId = this.defaultOutgoingNodeId(node.id, outgoingNodeIds);
    if (!finalNodeId) {
      return { selectedNodeIds, applied: false };
    }
    const blockingReason = this.blockingFinalizationReason();
    if (blockingReason) {
      const continuationNodeId = this.continuationOutgoingNodeId(node.id, incomingNodeIds, outgoingNodeIds, finalNodeId);
      if (!continuationNodeId) {
        return { selectedNodeIds, applied: false };
      }
      return {
        selectedNodeIds: [continuationNodeId],
        applied: true,
        reason: blockingReason,
      };
    }
    const acceptanceReason = this.externalQualityGateAcceptanceReason();
    if (acceptanceReason && this.hasVisibleWorkflowToolProof() && outgoingNodeIds.includes(finalNodeId)) {
      return {
        selectedNodeIds: [finalNodeId],
        applied: !selectedNodeIds.includes(finalNodeId),
        reason: acceptanceReason,
      };
    }
    if (!selectedNodeIds.includes(finalNodeId)) {
      return { selectedNodeIds, applied: false };
    }
    if (this.hasVisibleWorkflowToolProof()) {
      return { selectedNodeIds, applied: false };
    }
    const previousContinuation = this.events.some((event) =>
      event.nodeId === node.id
      && event.type === 'router_decision'
      && event.route?.selectedNodeIds.some((id) => id !== finalNodeId));
    if (previousContinuation) {
      return { selectedNodeIds, applied: false };
    }
    const continuationNodeId = this.continuationOutgoingNodeId(node.id, incomingNodeIds, outgoingNodeIds, finalNodeId);
    if (!continuationNodeId) {
      return { selectedNodeIds, applied: false };
    }
    return {
      selectedNodeIds: [continuationNodeId],
      applied: true,
      reason: `Runtime Goal Master guard required one visible continuation through ${continuationNodeId} before finalization.`,
    };
  }

  private blockingFinalizationReason(): string | undefined {
    const externalBlocker = this.blockingExternalQualityGateReason();
    if (externalBlocker) {
      return externalBlocker;
    }
    if (this.externalQualityGateAcceptanceReason() && this.hasVisibleWorkflowToolProof()) {
      return undefined;
    }
    return this.blockingIncompleteMaterializationReason();
  }

  private blockingExternalQualityGateReason(): string | undefined {
    for (const gate of this.externalQualityGates()) {
      const status = typeof gate['status'] === 'string' ? gate['status'].toLowerCase() : undefined;
      const highFindings = typeof gate['highFindings'] === 'number' ? gate['highFindings'] : 0;
      const blocking = gate['blocking'] === true;
      if (status === 'failed' || status === 'error' || blocking || highFindings > 0) {
        const source = typeof gate['source'] === 'string' ? gate['source'] : 'external QA';
        const summary = typeof gate['summary'] === 'string' && gate['summary'].trim().length > 0
          ? ` ${gate['summary'].trim()}`
          : '';
        return `${source} quality gate failed${highFindings > 0 ? ` with ${highFindings} high finding(s)` : ''}.${summary}`;
      }
    }
    return undefined;
  }

  private externalQualityGateAcceptanceReason(): string | undefined {
    for (const gate of this.externalQualityGates()) {
      const status = typeof gate['status'] === 'string' ? gate['status'].toLowerCase() : undefined;
      const highFindings = typeof gate['highFindings'] === 'number' ? gate['highFindings'] : 0;
      const blocking = gate['blocking'] === true;
      if ((status === 'passed' || status === 'pass' || status === 'ok') && highFindings === 0 && !blocking) {
        const source = typeof gate['source'] === 'string' ? gate['source'] : 'external QA';
        const summary = typeof gate['summary'] === 'string' && gate['summary'].trim().length > 0
          ? ` ${gate['summary'].trim()}`
          : '';
        return `${source} quality gate passed.${summary}`;
      }
    }
    return undefined;
  }

  private externalQualityGates(): Array<Record<string, unknown>> {
    const context = this.options.run.context;
    if (!this.isRecord(context)) {
      return [];
    }
    return [
      ...this.qualityGatesFromRecord(context),
      ...(this.isRecord(context['resumeContext']) ? this.qualityGatesFromRecord(context['resumeContext']) : []),
    ];
  }

  private qualityGatesFromRecord(record: Record<string, unknown>): Array<Record<string, unknown>> {
    const single = this.isRecord(record['externalQualityGate']) ? [record['externalQualityGate']] : [];
    const multiple = Array.isArray(record['externalQualityGates'])
      ? record['externalQualityGates'].filter((value): value is Record<string, unknown> => this.isRecord(value))
      : [];
    return [...single, ...multiple];
  }

  private hasVisibleWorkflowToolProof(): boolean {
    const workflowToolSlotIds = new Set(
      this.options.schema.roleSlots
        .filter((slot) => slot.slotType === 'participant' || slot.slotType === 'router' || slot.slotType === 'tool_executor')
        .map((slot) => slot.id),
    );
    return this.events.some((event) => (
      event.type === 'participant_output'
      && event.roleSlotId !== undefined
      && workflowToolSlotIds.has(event.roleSlotId)
      && !this.isIncompleteEvent(event)
      && this.hasSuccessfulToolExecutorEvidence(event.data)
    ));
  }

  private hasSuccessfulToolExecutorEvidence(data: Record<string, unknown> | undefined): boolean {
    if (!this.isRecord(data)) {
      return false;
    }
    const evidence = this.toolEvidence(data);
    return evidence.successfulToolNames.some((name) => (
      name === 'vfs_list'
      || name === 'vfs_read'
      || name === 'vfs_write'
      || name === 'fs_list'
      || name === 'fs_read'
      || name === 'fs_write'
      || name === 'terminal_output'
      || name === 'terminal_spawn'
      || name === 'run_cli_agent'
      || name === 'spawn_cli_agent'
      || name === 'message_cli_agent'
    ));
  }

  private blockingIncompleteMaterializationReason(): string | undefined {
    const implementationProofSlotIds = new Set(
      this.options.schema.roleSlots
        .filter((slot) => this.isImplementationProofSlot(slot))
        .map((slot) => slot.id),
    );
    for (const event of [...this.events].reverse()) {
      if (
        event.type !== 'participant_output'
        || event.roleSlotId === undefined
        || !implementationProofSlotIds.has(event.roleSlotId)
      ) {
        continue;
      }
      const evidence = this.isRecord(event.data) ? this.toolEvidence(event.data) : null;
      if (!evidence) {
        continue;
      }
      if (this.hasIndependentHostVerificationEvidence()) {
        return undefined;
      }
      const unresolvedReason = this.unresolvedCliChildReason(evidence);
      if (unresolvedReason) {
        return unresolvedReason;
      }
      if (this.hasMaterializationEvidence(evidence, this.events)) {
        return undefined;
      }
      const reason = this.incompleteCliDelegationReason(evidence);
      if (reason) {
        return reason;
      }
    }
    return undefined;
  }

  private hasIndependentHostVerificationEvidence(): boolean {
    return [
      ...(this.options.priorEvents ?? []),
      ...this.events,
    ].some((event) => {
      if (event.type !== 'participant_output' && event.type !== 'router_decision') {
        return false;
      }
      if (!this.isRecord(event.data)) {
        return false;
      }
      const evidence = this.toolEvidence(event.data);
      const hasReadEvidence = evidence.successfulToolNames.some((name) => (
        name === 'fs_list'
        || name === 'fs_read'
        || name === 'vfs_list'
        || name === 'vfs_read'
      ));
      return hasReadEvidence && this.hasPassedBuildResultEvidence(event);
    });
  }

  private hasPassedBuildResultEvidence(event: ArchitectureExecutionEvent): boolean {
    return this.workflowEvidenceForEvent(event).some((evidence) => {
      if (evidence.kind !== 'BUILD_RESULT' || evidence.status !== 'passed' || !this.isRecord(evidence.data)) {
        return false;
      }
      return this.numberField(evidence.data, 'exitCode') === 0;
    });
  }

  private workflowEvidenceForEvent(event: ArchitectureExecutionEvent): NonNullable<ArchitectureExecutionEvent['evidence']> {
    if (event.evidence && event.evidence.length > 0) {
      return event.evidence;
    }
    return this.isRecord(event.data) ? this.workflowEvidenceArray(event.data) ?? [] : [];
  }

  private workflowEvidenceArray(data: Record<string, unknown>): ArchitectureExecutionEvent['evidence'] {
    const value = data['evidence'];
    if (!Array.isArray(value)) {
      return undefined;
    }
    const evidence = value
      .filter((item): item is NonNullable<ArchitectureExecutionEvent['evidence']>[number] => {
        if (!this.isRecord(item)) {
          return false;
        }
        return this.isWorkflowEvidenceKind(item['kind'])
          && this.isWorkflowEvidenceStatus(item['status']);
      })
      .map((item) => ({
        kind: item.kind,
        status: item.status,
        ...(typeof item.source === 'string' ? { source: item.source } : {}),
        ...(this.isRecord(item.data) ? { data: item.data } : {}),
      }));
    return evidence.length > 0 ? evidence : undefined;
  }

  private isWorkflowEvidenceKind(value: unknown): value is NonNullable<ArchitectureExecutionEvent['evidence']>[number]['kind'] {
    return value === 'BUILD_RESULT'
      || value === 'GIT_STATUS'
      || value === 'FINAL_ARTIFACT'
      || value === 'QUALITY_GATE'
      || value === 'TOOL_RESULT'
      || value === 'CLI_CHILD'
      || value === 'VFS_WRITE'
      || value === 'VFS_READ';
  }

  private isWorkflowEvidenceStatus(value: unknown): value is NonNullable<ArchitectureExecutionEvent['evidence']>[number]['status'] {
    return value === 'passed'
      || value === 'failed'
      || value === 'blocked'
      || value === 'unknown';
  }

  private unresolvedCliChildReason(evidence: {
    childCliSessions: Array<{ status?: string }>;
  }): string | undefined {
    const unresolved = evidence.childCliSessions.find((session) => !isCompletedCliChildStatus(session.status));
    return unresolved
      ? `CLI child implementation is incomplete: child status is ${unresolved.status ?? 'unknown'}.`
      : undefined;
  }

  private isIncompleteEvent(event: ArchitectureExecutionEvent): boolean {
    return this.incompleteResultReason(event.data) !== undefined;
  }

  private isRecoverableWorkflowErrorCode(value: unknown): boolean {
    return value === 'RATE_LIMITED'
      || value === 'TIMEOUT'
      || value === 'PROVIDER_UNAVAILABLE'
      || value === 'SUBAGENT_TIMEOUT';
  }

  private toolExecutorContract(
    slot: ArchitectureRoleSlot,
    data: Record<string, unknown>,
    incomingEvents: ArchitectureExecutionEvent[],
  ): { ok: true } | { ok: false; reason: string } {
    if (this.isGoalGuardProofImplementer(slot)) {
      const evidence = this.toolEvidence(data);
      if (!this.hasOwnMaterializationEvidence(evidence)) {
        if (this.hasIndependentHostVerificationEvidence()) {
          return { ok: true };
        }
        if (this.hasIncompleteCliDelegationEvidence(evidence)) {
          return { ok: true };
        }
        return { ok: false, reason: 'implementer did not produce a successful write result' };
      }
      return { ok: true };
    }
    if (slot.slotType !== 'tool_executor') {
      return { ok: true };
    }
    const evidence = this.toolEvidence(data);
    if (evidence.toolResultCount < 1) {
      if (this.isImplementationProofSlot(slot) && this.hasIndependentHostVerificationEvidence()) {
        return { ok: true };
      }
      return { ok: false, reason: 'no tool result was observed' };
    }
    if (
      this.isImplementationProofSlot(slot)
      && !this.hasMaterializationEvidence(evidence, incomingEvents)
      && !this.hasIncompleteCliDelegationEvidence(evidence)
      && !this.hasIndependentHostVerificationEvidence()
    ) {
      return { ok: false, reason: `${slot.id} did not produce a successful write result` };
    }
    if (this.isVerifierSlot(slot) && !evidence.successfulToolNames.some((name) => (
      name === 'vfs_read'
      || name === 'vfs_list'
      || name === 'vfs_grep_search'
      || name === 'fs_read'
      || name === 'fs_list'
      || name === 'terminal_spawn'
      || name === 'terminal_output'
    ))) {
      return { ok: false, reason: 'verifier did not produce a successful read or terminal evidence result' };
    }
    return { ok: true };
  }

  private incompleteToolExecutorReason(
    slot: ArchitectureRoleSlot,
    data: Record<string, unknown>,
    incomingEvents: ArchitectureExecutionEvent[],
  ): string | undefined {
    if (slot.slotType !== 'tool_executor' || !this.isImplementationProofSlot(slot)) {
      return undefined;
    }
    const evidence = this.toolEvidence(data);
    if (this.hasMaterializationEvidence(evidence, incomingEvents)) {
      return undefined;
    }
    return this.incompleteCliDelegationReason(evidence);
  }

  private isGoalGuardProofImplementer(slot: ArchitectureRoleSlot): boolean {
    return slot.id === 'implementer'
      && slot.slotType === 'tool_executor'
      && (
        this.options.run.context?.['requireGoalMasterLoopProof'] === true
        || this.options.run.context?.['requireImplementerWriteProof'] === true
      );
  }

  private hasMaterializationEvidence(
    evidence: {
      successfulToolNames: string[];
      targetPaths: string[];
      childCliSessions: Array<{ status?: string }>;
    },
    incomingEvents: ArchitectureExecutionEvent[],
  ): boolean {
    if (this.hasOwnMaterializationEvidence(evidence)) {
      return true;
    }
    if (this.hasCliMaterializationEvidence(evidence)) {
      return true;
    }
    return incomingEvents.some((event) => (
      !this.isIncompleteEvent(event)
      && this.isRecord(event.data)
      && this.hasCliMaterializationEvidence(this.toolEvidence(event.data))
    ));
  }

  private hasOwnMaterializationEvidence(evidence: {
    successfulToolNames: string[];
    targetPaths: string[];
    childCliSessions: Array<{ status?: string }>;
  }): boolean {
    return evidence.successfulToolNames.some((name) => name === 'vfs_write' || name === 'fs_write')
      || this.hasCliMaterializationEvidence(evidence);
  }

  private hasCliMaterializationEvidence(evidence: {
    successfulToolNames: string[];
    targetPaths: string[];
    childCliSessions: Array<{ status?: string }>;
  }): boolean {
    if (evidence.childCliSessions.some((session) => !isCompletedCliChildStatus(session.status))) {
      return false;
    }
    return evidence.successfulToolNames.some((name) => (
      name === 'run_cli_agent'
      || name === 'spawn_cli_agent'
      || name === 'message_cli_agent'
    )) && evidence.targetPaths.length > 0;
  }

  private hasIncompleteCliDelegationEvidence(evidence: {
    successfulToolNames: string[];
    targetPaths: string[];
    childCliSessions: Array<{ status?: string }>;
  }): boolean {
    return evidence.childCliSessions.length > 0
      && evidence.targetPaths.length > 0
      && evidence.successfulToolNames.some((name) => (
        name === 'spawn_cli_agent'
        || name === 'message_cli_agent'
        || name === 'run_cli_agent'
      ));
  }

  private incompleteCliDelegationReason(evidence: {
    successfulToolNames: string[];
    targetPaths: string[];
    childCliSessions: Array<{ status?: string }>;
  }): string | undefined {
    if (!this.hasIncompleteCliDelegationEvidence(evidence) || this.hasCliMaterializationEvidence(evidence)) {
      return undefined;
    }
    return this.unresolvedCliChildReason(evidence) ?? 'CLI child implementation is incomplete.';
  }

  private toolEvidence(data: Record<string, unknown>): {
    toolResultCount: number;
    successfulToolNames: string[];
    targetPaths: string[];
    childCliSessions: Array<{ status?: string }>;
  } {
    const evidence = data['toolEvidence'];
    if (!this.isRecord(evidence)) {
      return { toolResultCount: 0, successfulToolNames: [], targetPaths: [], childCliSessions: [] };
    }
    const toolResultCount = typeof evidence['toolResultCount'] === 'number' ? evidence['toolResultCount'] : 0;
    const successfulToolNames = Array.isArray(evidence['successfulToolNames'])
      ? evidence['successfulToolNames'].filter((value): value is string => typeof value === 'string')
      : [];
    const targetPaths = Array.isArray(evidence['targetPaths'])
      ? evidence['targetPaths'].filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
      : [];
    const childCliSessions = Array.isArray(evidence['childCliSessions'])
      ? evidence['childCliSessions']
        .filter((value): value is Record<string, unknown> => this.isRecord(value))
        .map((value) => ({
          status: typeof value['status'] === 'string' ? value['status'] : undefined,
        }))
      : [];
    return { toolResultCount, successfulToolNames, targetPaths, childCliSessions };
  }

  private isImplementationProofSlot(slot: ArchitectureRoleSlot): boolean {
    return slot.id === 'implementer';
  }

  private isVerifierSlot(slot: ArchitectureRoleSlot): boolean {
    return /\bverifier\b/i.test(`${slot.id} ${slot.label}`);
  }

  private routingMessage(node: ArchitectureSchemaNode, nextLabel: string, selectedCount: number): string {
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
    if (event === 'chat:chunk' || event === 'chat:complete' || event === 'agent:done' || event === 'session:created') {
      return;
    }
    const payload = this.isRecord(data) ? data : {};
    if (event === 'agent:start') {
      this.push('agent_started', `${slot.label} child agent started.`, {
        actionSummary: architectureActionSummaryForEvent('agent_started', 'role'),
        nodeId: node.id,
        roleSlotId: slot.id,
        data: this.branchStreamEventData(event, payload),
      });
      return;
    }
    if (event === 'tool:confirmation_required') {
      this.push('human_gate', `${slot.label} requested HITL approval for ${this.toolName(payload)}.`, {
        actionSummary: 'Waiting for tool confirmation.',
        nodeId: node.id,
        roleSlotId: slot.id,
        data: this.branchStreamEventData(event, payload),
      });
      return;
    }
    if (event === 'agent:budget_required') {
      const usedIterations = this.numberField(payload, 'usedIterations');
      const currentLimit = this.numberField(payload, 'currentLimit');
      const usage = usedIterations !== undefined && currentLimit !== undefined
        ? ` (${usedIterations}/${currentLimit})`
        : '';
      this.push('human_gate', `${slot.label} requested more tool budget${usage}.`, {
        actionSummary: 'Waiting for budget approval.',
        nodeId: node.id,
        roleSlotId: slot.id,
        data: this.branchStreamEventData(event, payload),
      });
      return;
    }
    if (event === 'tool:start') {
      this.push('tool_call', `${slot.label} started ${this.toolName(payload)}.`, {
        actionSummary: architectureActionSummaryForEvent('tool_call', 'role'),
        nodeId: node.id,
        roleSlotId: slot.id,
        data: this.branchStreamEventData(event, payload),
      });
      return;
    }
    if (event === 'tool:result') {
      const status = typeof payload['status'] === 'string' ? payload['status'] : 'unknown';
      this.push('tool_call', `${slot.label} ${this.toolName(payload)} ${status}.`, {
        actionSummary: architectureActionSummaryForEvent('tool_call', 'role'),
        nodeId: node.id,
        roleSlotId: slot.id,
        data: this.branchStreamEventData(event, payload),
      });
      return;
    }
    if (event === 'chat:error') {
      this.push('tool_call', `${slot.label} branch error: ${this.errorMessageFromPayload(payload)}.`, {
        actionSummary: architectureActionSummaryForEvent('tool_call', 'role'),
        nodeId: node.id,
        roleSlotId: slot.id,
        data: this.branchStreamEventData(event, payload),
      });
    }
  }

  private branchStreamEventData(event: string, payload: Record<string, unknown>): Record<string, unknown> {
    const args = this.isRecord(payload['args']) ? payload['args'] : undefined;
    return {
      kind: 'branch_stream',
      event,
      sessionId: this.stringField(payload, 'sessionId'),
      callId: this.stringField(payload, 'callId'),
      toolName: this.stringField(payload, 'toolName'),
      status: this.stringField(payload, 'status'),
      errorMessage: this.stringField(payload, 'message') ?? this.stringField(payload, 'errorMessage'),
      usedIterations: this.numberField(payload, 'usedIterations'),
      currentLimit: this.numberField(payload, 'currentLimit'),
      suggestedNextLimit: this.numberField(payload, 'suggestedNextLimit'),
      requestedBy: this.stringField(payload, 'requestedBy'),
      toolPath: args ? this.firstStringField(args, ['path', 'filePath', 'targetPath', 'workdir']) : undefined,
    };
  }

  private toolName(payload: Record<string, unknown>): string {
    return this.stringField(payload, 'toolName') ?? 'tool';
  }

  private errorMessageFromPayload(payload: Record<string, unknown>): string {
    return this.stringField(payload, 'message') ?? this.stringField(payload, 'errorMessage') ?? 'unknown error';
  }

  private stringField(payload: Record<string, unknown>, key: string): string | undefined {
    const value = payload[key];
    return typeof value === 'string' && value.length > 0 ? value : undefined;
  }

  private numberField(payload: Record<string, unknown>, key: string): number | undefined {
    const value = payload[key];
    return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
  }

  private firstStringField(payload: Record<string, unknown>, keys: string[]): string | undefined {
    for (const key of keys) {
      const value = payload[key];
      if (typeof value === 'string' && value.length > 0) {
        return value;
      }
    }
    return undefined;
  }

  private rootNodes(incoming: Map<string, string[]>): ArchitectureSchemaNode[] {
    const roots = this.options.schema.nodes.filter((node) => (incoming.get(node.id) ?? []).length === 0);
    return roots.length > 0 ? roots : this.options.schema.nodes.slice(0, 1);
  }

  private groupEdges(key: 'fromNodeId' | 'toNodeId'): Map<string, string[]> {
    const groups = new Map<string, string[]>();
    for (const edge of this.options.schema.edges) {
      const source = edge[key];
      const target = key === 'fromNodeId' ? edge.toNodeId : edge.fromNodeId;
      groups.set(source, [...(groups.get(source) ?? []), target]);
    }
    return groups;
  }

  private returnToOrchestratorNodeIds(fromNodeId: string, selectedNodeIds: string[]): string[] {
    if (selectedNodeIds.length === 0 || !this.returnToOrchestratorPauseEnabled()) {
      return [];
    }
    const selected = new Set(selectedNodeIds);
    return this.options.schema.edges
      .filter((edge): edge is ArchitectureSchemaEdge & { returnToOrchestrator: true } =>
        edge.fromNodeId === fromNodeId
        && selected.has(edge.toNodeId)
        && edge.returnToOrchestrator === true)
      .map((edge) => edge.toNodeId);
  }

  private returnToOrchestratorPauseEnabled(): boolean {
    return this.options.run.context?.['enableReturnToOrchestratorPause'] === true
      || this.isRecord(this.options.run.context?.['subAgentFlow']);
  }

  private nodeReady(nodeId: string, incoming: Map<string, string[]>): boolean {
    const incomingNodeIds = this.incomingNodeIdsFor(nodeId, incoming);
    return incomingNodeIds.length === 0 || incomingNodeIds.every((incomingNodeId) => this.visitCount(incomingNodeId) > 0);
  }

  private incomingNodeIdsFor(nodeId: string, fallback?: Map<string, string[]>): string[] {
    const staticIncoming = fallback?.get(nodeId) ?? this.options.schema.edges
      .filter((edge) => edge.toNodeId === nodeId)
      .map((edge) => edge.fromNodeId);
    const activeIncoming = staticIncoming.filter((incomingNodeId) => this.activeNodeIds.has(incomingNodeId));
    if (activeIncoming.length > 0) {
      return activeIncoming;
    }
    const explicitIncoming = this.activeIncomingNodeIds.get(nodeId);
    return explicitIncoming ? Array.from(explicitIncoming) : staticIncoming;
  }

  private markActiveIncoming(nodeId: string, fromNodeId: string): void {
    const incoming = this.activeIncomingNodeIds.get(nodeId) ?? new Set<string>();
    incoming.add(fromNodeId);
    this.activeIncomingNodeIds.set(nodeId, incoming);
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
