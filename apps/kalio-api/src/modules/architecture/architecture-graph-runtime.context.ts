import type {
  ArchitectureExecutionEvent,
  ArchitectureRoleSlot,
  ArchitectureRouteDecision,
  ArchitectureRouterOutput,
  ArchitectureRun,
  ArchitectureSchema,
  ArchitectureSchemaNode,
  HostRuntimeReceiptObserver,
} from '@kalio/types';
import type { ArchitectureRuntimeResumeCursor } from './architecture-runtime-auto-routing-recovery.utils';
import type { ArchitectureAutoRoutingChoice, ArchitectureAutoRoutingInput } from './architecture-auto-routing.service';
import type { ArchitectureRoleExecutionInput, ArchitectureRoleExecutor } from './architecture-role-executor';
import { architectureActionFieldsForEvent, architectureActionSummaryForEvent } from './architecture-action-summary';
import { externalQualityGateAcceptanceReason, type ArchitectureGraphFinalizationInput } from './architecture-graph-finalization.utils';
import { architectureBranchStreamProjection } from './architecture-graph-branch-events.utils';
import { continuationOutgoingNodeId } from './architecture-graph-routing.utils';
import { incomingNodeIdsFor, isNodeReady, markActiveIncoming, selectedNodeIdsFromEvent } from './architecture-graph-topology.utils';
import { createArchitectureRouterOutput } from './architecture-router-output';
import { isWorkflowError } from '../../common/utils/workflow-error.util';
import type { GoalBatchDirective, GraphGoalProtocolAdapter } from './architecture-graph-goal-nodes';
import type { GoalCompletionAuthorized } from './architecture-graph-goal-nodes';
import type { GoalVisitInput } from './architecture-graph-goal-visits';

export type GraphRuntimeOptions = {
  signal?: AbortSignal;
  goalProtocol?: GraphGoalProtocolAdapter;
  /** Required durable host ACK for goal visits; ordinary graphs remain unchanged. */
  persistGoalVisit?: (input: GoalVisitInput) => Promise<void>;
  /** Host-only capability factory. Required for actual goal work, never proposal
   * or ordinary roles. Host owns abort cleanup, BUILD/verifier and durable seal. */
  openGoalWorkerAttempt?: (input: { run: ArchitectureRun; nodeId: string; branchSessionId: string;
    signal?: AbortSignal }) => Promise<{ observer: HostRuntimeReceiptObserver; finish: () => Promise<void> }>;
  /** Host MUST invoke publish synchronously inside its stop/finalization barrier,
   * after durably tying completedVisit to its terminal checkpoint and validating
   * current V2 receipt + full provenance. ACK arguments alone are not storage proof. */
  commitGoalTerminal?: (input: { run: ArchitectureRun; nodeId: string; authorization: GoalCompletionAuthorized;
    completedVisit: GoalVisitInput; signal?: AbortSignal;
    publish: (ack: { completedVisitCheckpointId: string; event: ArchitectureExecutionEvent }) => void }) => Promise<void>;
  schema: ArchitectureSchema;
  run: ArchitectureRun;
  now: number;
  roleExecutor: ArchitectureRoleExecutor;
  personaForSlot: (slot: ArchitectureRoleSlot) => string;
  priorEvents?: ArchitectureExecutionEvent[];
  resumeFrom?: ArchitectureRuntimeResumeCursor;
  emit?: ArchitectureRoleExecutionInput['emit'];
  onEvent?: (event: ArchitectureExecutionEvent) => void;
  isStopped?: () => boolean;
  chooseAutoRoute?: (input: ArchitectureAutoRoutingInput) => Promise<ArchitectureAutoRoutingChoice>;
  /** Required at runtime for auto_router nodes; ordinary graphs need no route store. */
  persistAutoRouteDecision?: (event: ArchitectureExecutionEvent, checkpointId: string) => Promise<void>;
};

export type EventOptions = {
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

export class ArchitectureGraphContext {
  readonly events: ArchitectureExecutionEvent[] = [];
  readonly activeNodeIds = new Set<string>();
  readonly nodeVisitCounts = new Map<string, number>();
  readonly activeIncomingNodeIds = new Map<string, Set<string>>();
  private sequence = 0;
  goalDirective?: GoalBatchDirective;
  goalPaused = false;
  goalTerminalPublished = false;

  constructor(readonly options: GraphRuntimeOptions) {}

  isStopped(): boolean {
    return this.options.signal?.aborted === true || this.options.isStopped?.() === true || this.options.run.status === 'cancelled';
  }

  resumesIncompleteNode(nodeId: string): boolean {
    const resume = this.options.resumeFrom;
    const recoveringStartedNode = resume?.reason === 'runtime_recovery'
      && resume.resumeStartedNodeIds?.includes(nodeId) === true;
    if (!recoveringStartedNode && (resume?.reason !== 'runtime_pause' || resume.waitingNodeId !== nodeId)) return false;
    let lastStarted = -1;
    let lastCompleted = -1;
    for (let index = 0; index < this.events.length; index += 1) {
      const event = this.events[index];
      if (event?.nodeId !== nodeId) continue;
      if (event.type === 'node_started') lastStarted = index;
      if (event.type === 'node_completed') lastCompleted = index;
    }
    return lastStarted >= 0 && lastCompleted < lastStarted;
  }

  seedPriorEvents(): void {
    const priorEvents = this.options.priorEvents ?? [];
    this.events.push(...priorEvents);
    this.sequence = Math.max(...priorEvents.map((event) => event.sequence), 0);
    for (const event of priorEvents) {
      if (event.type === 'node_completed' && event.nodeId) {
        this.nodeVisitCounts.set(event.nodeId, this.visitCount(event.nodeId) + 1);
      }
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
        this.nodeVisitCounts.set(nodeId, Math.max(this.visitCount(nodeId), count));
      }
    }
  }

  readyNodesFromCursor(
    nodesById: Map<string, ArchitectureSchemaNode>,
  ): ArchitectureSchemaNode[] | null {
    if (this.options.resumeFrom?.reason === 'runtime_recovery') {
      return Array.from(new Set(this.options.resumeFrom.pendingNodeIds))
        .map((nodeId) => nodesById.get(nodeId))
        .filter((node): node is ArchitectureSchemaNode => node !== undefined);
    }
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

  acceptanceResumeNode(
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

  lastCompletedJudgeNode(
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

  finalizationInput(): ArchitectureGraphFinalizationInput {
    return {
      schema: this.options.schema,
      runContext: this.options.run.context,
      events: this.events,
      priorEvents: this.options.priorEvents ?? [],
    };
  }

  incomingEventsForSlot(slot: ArchitectureRoleSlot, incomingNodeIds: string[]): ArchitectureExecutionEvent[] {
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

  incompleteContinuationNodeIds(
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

  isRecoverableNodeError(error: unknown): boolean {
    return isWorkflowError(error, 'RATE_LIMITED')
      || isWorkflowError(error, 'TIMEOUT')
      || isWorkflowError(error, 'PROVIDER_UNAVAILABLE');
  }

  toRouterOutput(
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

  push(
    type: ArchitectureExecutionEvent['type'],
    message: string,
    options: EventOptions = {},
  ): void {
    this.appendEvent(this.createEvent(type, message, options));
  }

  createEvent(
    type: ArchitectureExecutionEvent['type'],
    message: string,
    options: EventOptions = {},
  ): ArchitectureExecutionEvent {
    this.sequence += 1;
    const actionFields = architectureActionFieldsForEvent({
      type,
      actionSummary: options.actionSummary,
      route: options.route,
      routerOutput: options.routerOutput,
      data: options.data,
    });
    return {
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
  }

  appendEvent(event: ArchitectureExecutionEvent): void {
    this.events.push(event);
    this.options.onEvent?.(event);
  }

  branchEventEmit(
    node: ArchitectureSchemaNode,
    slot: ArchitectureRoleSlot,
  ): NonNullable<ArchitectureRoleExecutionInput['emit']> {
    return (event, data) => {
      this.pushBranchStreamEvent(node, slot, event, data);
      if (event === 'tool:confirmation_required' || event === 'agent:budget_required') {
        const payload: Record<string, unknown> = this.isRecord(data)
          ? data as Record<string, unknown>
          : {};
        const parentExecution = this.isRecord(payload['architectureParentExecution'])
          ? payload['architectureParentExecution'] as Record<string, unknown>
          : {};
        const requestId = typeof payload['requestId'] === 'string' ? payload['requestId'] : undefined;
        const childSessionId = typeof parentExecution['childSessionId'] === 'string'
          ? parentExecution['childSessionId']
          : typeof payload['sessionId'] === 'string' ? payload['sessionId'] : undefined;
        const childTurnId = typeof parentExecution['childTurnId'] === 'string'
          ? parentExecution['childTurnId']
          : typeof payload['turnId'] === 'string' ? payload['turnId'] : undefined;
        const promptMessageId = typeof parentExecution['promptMessageId'] === 'string'
          ? parentExecution['promptMessageId']
          : typeof payload['promptMessageId'] === 'string' ? payload['promptMessageId'] : undefined;
        this.push('router_decision', `${slot.label} paused for human input.`, {
          actionSummary: architectureActionSummaryForEvent('router_decision', node.kind),
          lifecycle: 'waiting_on_orchestrator',
          status: 'waiting_on_orchestrator',
          nodeId: node.id,
          roleSlotId: slot.id,
          reasonCode: 'runtime_pause',
          data: {
            reasonCode: 'runtime_pause',
            pendingNodeIds: [node.id],
            visitCounts: Object.fromEntries(this.nodeVisitCounts.entries()),
            waitEvent: event,
            waitIdentity: requestId && childSessionId && childTurnId
              ? { requestId, childSessionId, childTurnId, promptMessageId }
              : undefined,
          },
        });
      }
      this.options.emit?.(event, data);
    };
  }

  pushBranchStreamEvent(
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

  returnToOrchestratorPauseEnabled(): boolean {
    return this.options.run.context?.['enableReturnToOrchestratorPause'] === true
      || this.isRecord(this.options.run.context?.['subAgentFlow']);
  }

  nodeReady(nodeId: string, incoming: Map<string, string[]>): boolean {
    return isNodeReady({
      schema: this.options.schema,
      nodeId,
      fallback: incoming,
      activeNodeIds: this.activeNodeIds,
      activeIncomingNodeIds: this.activeIncomingNodeIds,
      visitCount: (incomingNodeId) => this.visitCount(incomingNodeId),
    });
  }

  incomingNodeIdsFor(nodeId: string, fallback?: Map<string, string[]>): string[] {
    return incomingNodeIdsFor({
      schema: this.options.schema,
      nodeId,
      fallback,
      activeNodeIds: this.activeNodeIds,
      activeIncomingNodeIds: this.activeIncomingNodeIds,
    });
  }

  visitCount(nodeId: string): number {
    return this.nodeVisitCounts.get(nodeId) ?? 0;
  }

  maxSteps(): number {
    const configured = this.options.run.context?.['maxArchitectureSteps'];
    return typeof configured === 'number' && Number.isInteger(configured) && configured > 0
      ? configured
      : Math.max((this.options.schema.nodes.length * 8) + (this.options.schema.edges.length * 4) + 1, 16);
  }

  maxNodeVisits(): number {
    const configured = this.options.run.context?.['maxArchitectureNodeVisits'];
    return typeof configured === 'number' && Number.isInteger(configured) && configured > 0 ? configured : 4;
  }

  eventsForNodeIds(nodeIds: string[]): ArchitectureExecutionEvent[] {
    const nodeIdSet = new Set(nodeIds);
    return this.events.filter((event) => event.nodeId !== undefined && nodeIdSet.has(event.nodeId));
  }

  personaForRoleSlotId(roleSlotId: string): string | undefined {
    const slot = this.options.schema.roleSlots.find((candidate) => candidate.id === roleSlotId);
    return slot ? this.options.personaForSlot(slot) : undefined;
  }

  shouldExecuteSlot(slot: ArchitectureRoleSlot): boolean {
    return slot.slotType === 'participant'
      || slot.slotType === 'critic'
      || slot.slotType === 'tool_executor';
  }

  isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }
}
