import type { ArchitectureExecutionEvent, ArchitectureRoleSlot, ArchitectureSchema, ArchitectureSchemaNode } from '@kalio/types';
import {
  blockingFinalizationReason,
  externalQualityGateAcceptanceReason,
  hasVisibleWorkflowToolProof,
  type ArchitectureGraphFinalizationInput,
} from './architecture-graph-finalization.utils';
import {
  continuationOutgoingNodeId,
  defaultOutgoingNodeId,
} from './architecture-graph-routing.utils';

type JudgeContinuationGuardInput = {
  slot: ArchitectureRoleSlot;
  node: ArchitectureSchemaNode;
  schema: ArchitectureSchema;
  requireGoalMasterLoopProof: boolean;
  incomingNodeIds: string[];
  selectedNodeIds: string[];
  outgoingNodeIds: string[];
  finalizationInput: ArchitectureGraphFinalizationInput;
  events: ArchitectureExecutionEvent[];
};

type JudgeContinuationGuardResult = {
  selectedNodeIds: string[];
  applied: boolean;
  reason?: string;
};

export function judgeArchitectureContinuationGuard(input: JudgeContinuationGuardInput): JudgeContinuationGuardResult {
  const {
    slot,
    node,
    schema,
    requireGoalMasterLoopProof,
    incomingNodeIds,
    selectedNodeIds,
    outgoingNodeIds,
    finalizationInput,
    events,
  } = input;

  if (slot.slotType !== 'judge' || !requireGoalMasterLoopProof) {
    return { selectedNodeIds, applied: false };
  }
  const finalNodeId = defaultOutgoingNodeId(schema, node.id, outgoingNodeIds);
  if (!finalNodeId) {
    return { selectedNodeIds, applied: false };
  }
  const blockingReason = blockingFinalizationReason(finalizationInput);
  if (blockingReason) {
    const continuationNodeId = continuationOutgoingNodeId({
      schema,
      sourceNodeId: node.id,
      incomingNodeIds,
      outgoingNodeIds,
      defaultNodeId: finalNodeId,
    });
    if (!continuationNodeId) {
      return { selectedNodeIds, applied: false };
    }
    return {
      selectedNodeIds: [continuationNodeId],
      applied: true,
      reason: blockingReason,
    };
  }
  const acceptanceReason = externalQualityGateAcceptanceReason(finalizationInput);
  if (acceptanceReason && hasVisibleWorkflowToolProof(finalizationInput) && outgoingNodeIds.includes(finalNodeId)) {
    return {
      selectedNodeIds: [finalNodeId],
      applied: !selectedNodeIds.includes(finalNodeId),
      reason: acceptanceReason,
    };
  }
  if (!selectedNodeIds.includes(finalNodeId)) {
    return { selectedNodeIds, applied: false };
  }
  if (hasVisibleWorkflowToolProof(finalizationInput)) {
    return { selectedNodeIds, applied: false };
  }
  const previousContinuation = events.some((event) =>
    event.nodeId === node.id
    && event.type === 'router_decision'
    && event.route?.selectedNodeIds.some((id) => id !== finalNodeId));
  if (previousContinuation) {
    return { selectedNodeIds, applied: false };
  }
  const continuationNodeId = continuationOutgoingNodeId({
    schema,
    sourceNodeId: node.id,
    incomingNodeIds,
    outgoingNodeIds,
    defaultNodeId: finalNodeId,
  });
  if (!continuationNodeId) {
    return { selectedNodeIds, applied: false };
  }
  return {
    selectedNodeIds: [continuationNodeId],
    applied: true,
    reason: `Runtime Goal Master guard required one visible continuation through ${continuationNodeId} before finalization.`,
  };
}
