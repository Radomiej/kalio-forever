import type { AgentFlowContinuationCursor, ArchitectureExecutionEvent, ArchitectureNodeBehaviorMode, ArchitectureRoleSlot, ArchitectureRouteDecision, ArchitectureRouterOutput, ArchitectureRun, ArchitectureSchema, ArchitectureSchemaEdge, ArchitectureSchemaNode } from '@kalio/types';
import type { ArchitectureRoleExecutionInput, ArchitectureRoleExecutor } from './architecture-role-executor';
import { architectureActionFieldsForEvent, architectureActionSummaryForEvent } from './architecture-action-summary';
import { isCompletedCliChildStatus } from './architecture-cli-child-status';
import { createArchitectureRouterOutput } from './architecture-router-output';

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
  nodeId?: string;
  roleSlotId?: string;
  route?: ArchitectureRouteDecision;
  routerOutput?: ArchitectureRouterOutput;
  data?: Record<string, unknown>;
};

type AgentRouteRequest = {
  targetNodeId: string;
  response?: string;
};

const SUBAGENT_INCOMPLETE_MARKER = 'without producing a final answer';
const RECOVERABLE_RUNTIME_ERROR_MARKER = 'recoverable runtime error';
const RECOVERABLE_BRANCH_ERROR_MARKER = 'recoverable branch error';
const DEGRADED_MARKER = 'degraded after recoverable';

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
          data: {
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
      const reason = ready.length > 0
        ? `Runtime stopped after ${maxSteps} graph steps.`
        : `Runtime stopped after reaching max node visits.`;
      this.push('router_decision', reason, {
        actionSummary: architectureActionSummaryForEvent('router_decision'),
        data: {
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
    const message = `${node.label} degraded after recoverable runtime error: ${this.errorMessage(error)}`;
    const selectedNodeIds = this.incompleteContinuationNodeIds(outgoingNodeIds, node.behavior?.convergeToNodeId);
    const data = {
      runtimeGuard: 'recoverable_node_error',
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
        data,
      });
      return selectedNodeIds;
    }

    this.push('router_decision', message, {
      actionSummary: architectureActionSummaryForEvent('router_decision', node.kind),
      nodeId: node.id,
      roleSlotId: node.roleSlotId,
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
        nodeId: node.id,
        roleSlotId: node.roleSlotId,
        data: {
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
    const incompleteReason = this.incompleteResultReason(result.message)
      ?? this.incompleteToolExecutorReason(slot, result.data, this.events);
    const selectedNodeIds = incompleteReason
      ? this.incompleteContinuationNodeIds(outgoingNodeIds)
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
    const fallbackNodeIds = this.selectedOutgoingNodeIds(
      node.behavior?.mode,
      node.behavior?.convergeToNodeId,
      outgoingNodeIds,
    );
    const incompleteReason = this.incompleteResultReason(result.message);
    const routeRequest = this.routeRequest(result.data);
    const canAgentRouteOverride = node.behavior?.mode !== 'fan_out_all';
    const hasAgentRoute = canAgentRouteOverride
      && !incompleteReason
      && routeRequest !== undefined
      && outgoingNodeIds.includes(routeRequest.targetNodeId);
    const requestedSelectedNodeIds = incompleteReason
      ? this.incompleteContinuationNodeIds(outgoingNodeIds, node.behavior?.convergeToNodeId)
      : hasAgentRoute
      ? [routeRequest.targetNodeId]
      : fallbackNodeIds;
    const guard = this.judgeContinuationGuard(slot, node, incomingNodeIds, requestedSelectedNodeIds, outgoingNodeIds);
    const finalSelectedNodeIds = guard.selectedNodeIds;
    const route: ArchitectureRouteDecision = {
      source: incompleteReason || guard.applied ? 'runtime_fallback' : hasAgentRoute ? 'agent' : 'router',
      fromNodeId: node.id,
      selectedNodeIds: finalSelectedNodeIds,
      rejectedNodeIds: outgoingNodeIds.filter((nodeId) => !finalSelectedNodeIds.includes(nodeId)),
      nextNodeId: finalSelectedNodeIds[0],
      convergeToNodeId: node.behavior?.convergeToNodeId,
      mode: node.behavior?.mode,
      response: incompleteReason ?? guard.reason ?? routeRequest?.response,
    };
    const routerOutput = this.toRouterOutput(
      node,
      incomingNodeIds,
      route,
      result.message,
      result.data,
    );
    this.push('router_decision', result.message, {
      actionSummary: architectureActionSummaryForEvent('router_decision', 'router'),
      nodeId: node.id,
      roleSlotId: slot.id,
      route,
      routerOutput,
      data: {
        ...result.data,
        behavior: node.behavior ? { ...node.behavior } : undefined,
        incomingNodeIds,
        nextNodeId: finalSelectedNodeIds[0],
        outgoingNodeIds,
        incompleteReason,
        runtimeGuard: incompleteReason ?? (guard.applied ? guard.reason : undefined),
        rejectedNodeIds: outgoingNodeIds.filter((nodeId) => !finalSelectedNodeIds.includes(nodeId)),
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
    const selectedNodeIds = this.selectedOutgoingNodeIds(behavior?.mode, behavior?.convergeToNodeId, outgoingNodeIds);
    const rejectedNodeIds = outgoingNodeIds.filter((nodeId) => !selectedNodeIds.includes(nodeId));
    const nextNodeId = selectedNodeIds[0];
    const nextLabel = nextNodeId ? nodesById.get(nextNodeId)?.label ?? nextNodeId : 'end';
    const message = this.routingMessage(node, nextLabel, selectedNodeIds.length);
    const route: ArchitectureRouteDecision = {
      source: node.kind === 'parallel' ? 'parallel' : 'router',
      fromNodeId: node.id,
      selectedNodeIds,
      rejectedNodeIds,
      nextNodeId,
      convergeToNodeId: behavior?.convergeToNodeId,
      mode: behavior?.mode,
    };
    const routerOutput = node.kind === 'router'
      ? this.toRouterOutput(node, incomingNodeIds, route, message, {})
      : undefined;
    this.push('router_decision', message, {
      actionSummary: architectureActionSummaryForEvent('router_decision', node.kind),
      nodeId: node.id,
      roleSlotId: node.roleSlotId,
      route,
      routerOutput,
      data: {
        behavior: behavior ? { ...behavior } : undefined,
        branchSessionIds: this.options.run.branchSessionIds,
        convergeToNodeId: behavior?.convergeToNodeId,
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
    }
    return selectedNodeIds;
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
      nodeId: node.id,
      roleSlotId: slot.id,
      data: {
        ...result.data,
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

  private selectedOutgoingNodeIds(
    mode: ArchitectureNodeBehaviorMode | undefined,
    convergeToNodeId: string | undefined,
    outgoingNodeIds: string[],
  ): string[] {
    if (outgoingNodeIds.length === 0) {
      return [];
    }
    if (mode === 'choose_one') {
      return [convergeToNodeId && outgoingNodeIds.includes(convergeToNodeId) ? convergeToNodeId : outgoingNodeIds[0]];
    }
    if ((mode === 'rank_then_merge' || mode === 'merge_inputs') && convergeToNodeId && outgoingNodeIds.includes(convergeToNodeId)) {
      return [convergeToNodeId];
    }
    if (mode === 'rank_then_merge' || mode === 'merge_inputs') {
      return outgoingNodeIds.slice(0, 1);
    }
    return outgoingNodeIds;
  }

  private selectedRoleOutgoingNodeIds(data: Record<string, unknown>, outgoingNodeIds: string[]): string[] {
    const routeRequest = this.routeRequest(data);
    if (routeRequest && outgoingNodeIds.includes(routeRequest.targetNodeId)) {
      return [routeRequest.targetNodeId];
    }
    return outgoingNodeIds;
  }

  private incompleteResultReason(message: string): string | undefined {
    const normalized = message.trim().toLowerCase();
    if (
      normalized.startsWith('sub-agent stopped')
      || normalized.startsWith('subagent stopped')
      || normalized.startsWith('sub-agent exhausted')
      || normalized.startsWith('subagent exhausted')
      || normalized.startsWith(SUBAGENT_INCOMPLETE_MARKER)
    ) {
      return 'Subagent exhausted its tool loop without producing a final answer.';
    }
    if (
      normalized.includes(RECOVERABLE_RUNTIME_ERROR_MARKER)
      || normalized.includes(RECOVERABLE_BRANCH_ERROR_MARKER)
      || normalized.includes(DEGRADED_MARKER)
    ) {
      return 'Recoverable runtime error prevented this node from producing a final answer.';
    }
    return undefined;
  }

  private incompleteContinuationNodeIds(outgoingNodeIds: string[], avoidNodeId?: string): string[] {
    const nextNodeId = outgoingNodeIds.find((nodeId) => nodeId !== avoidNodeId) ?? outgoingNodeIds[0];
    return nextNodeId ? [nextNodeId] : [];
  }

  private isRecoverableNodeError(error: unknown): boolean {
    const message = this.errorMessage(error).toLowerCase();
    return message.includes('429')
      || message.includes('too many requests')
      || message.includes('rate limit')
      || message.includes('timeout');
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }

  private routeRequest(data: Record<string, unknown>): AgentRouteRequest | undefined {
    const directRoute = data['routeToNodeId'] ?? data['targetNodeId'];
    if (typeof directRoute === 'string' && directRoute.length > 0) {
      return { targetNodeId: directRoute, response: this.routeResponse(data) };
    }

    const snakeRoute = data['route_to'];
    if (typeof snakeRoute === 'string' && snakeRoute.length > 0) {
      return { targetNodeId: snakeRoute, response: this.routeResponse(data) };
    }
    if (this.isRecord(snakeRoute)) {
      const target = snakeRoute['targetNodeId'] ?? snakeRoute['nodeId'];
      const response = snakeRoute['response'];
      return typeof target === 'string' && target.length > 0
        ? { targetNodeId: target, response: typeof response === 'string' ? response : this.routeResponse(data) }
        : undefined;
    }
    return undefined;
  }

  private routeResponse(data: Record<string, unknown>): string | undefined {
    const response = data['response'];
    return typeof response === 'string' && response.length > 0 ? response : undefined;
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
    const finalNodeId = node.behavior?.convergeToNodeId;
    if (!finalNodeId) {
      return { selectedNodeIds, applied: false };
    }
    const blockingReason = this.blockingFinalizationReason();
    if (blockingReason) {
      const continuationNodeId = outgoingNodeIds.find((id) => id !== finalNodeId && incomingNodeIds.includes(id))
        ?? outgoingNodeIds.find((id) => id !== finalNodeId);
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
    const continuationNodeId = outgoingNodeIds.find((id) => id !== finalNodeId && incomingNodeIds.includes(id))
      ?? outgoingNodeIds.find((id) => id !== finalNodeId);
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
      const hasBuildEvidence = evidence.successfulToolNames.some((name) => (
        name === 'terminal_output'
        || name === 'terminal_spawn'
      ));
      const hasArtifactPath = evidence.targetPaths.some((path) => (
        path.includes('\\dist')
        || path.includes('/dist')
        || path.endsWith('dist')
      ));
      return hasReadEvidence && (hasBuildEvidence || hasArtifactPath);
    });
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
    return this.incompleteResultReason(event.message) !== undefined
      || (this.isRecord(event.data) && typeof event.data['incompleteReason'] === 'string');
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
