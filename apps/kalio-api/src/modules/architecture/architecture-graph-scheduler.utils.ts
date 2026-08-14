export type SchedulableNode = {
  id: string;
};

type PartitionReadyNodesByVisitLimitInput<TNode extends SchedulableNode> = {
  nodes: TNode[];
  maxNodeVisits: number;
  visitCount: (nodeId: string) => number;
};

export type RuntimeLimitDecisionReasonCode = 'max_steps' | 'max_node_visits';

type RuntimeLimitDecisionInput = {
  readyNodeIds: string[];
  maxVisitBlockedNodeIds: string[];
  maxSteps: number;
  maxNodeVisits: number;
  visitCounts: Record<string, number>;
};

type RuntimeLimitDecision = {
  reasonCode: RuntimeLimitDecisionReasonCode;
  message: string;
  pendingNodeIds: string[];
  data: {
    reasonCode: RuntimeLimitDecisionReasonCode;
    maxNodeVisits: number;
    maxSteps: number;
    pendingNodeIds: string[];
    visitCounts: Record<string, number>;
  };
};

export function partitionReadyNodesByVisitLimit<TNode extends SchedulableNode>(
  input: PartitionReadyNodesByVisitLimitInput<TNode>,
): { executableNodes: TNode[]; blockedNodeIds: string[] } {
  const executableNodes: TNode[] = [];
  const blockedNodeIds: string[] = [];
  for (const node of input.nodes) {
    if (input.visitCount(node.id) < input.maxNodeVisits) {
      executableNodes.push(node);
    } else {
      blockedNodeIds.push(node.id);
    }
  }
  return { executableNodes, blockedNodeIds };
}

export function runtimeLimitDecisionForPendingNodes(
  input: RuntimeLimitDecisionInput,
): RuntimeLimitDecision | null {
  const pendingNodeIds = input.readyNodeIds.length > 0
    ? input.readyNodeIds
    : input.maxVisitBlockedNodeIds;
  if (pendingNodeIds.length === 0) {
    return null;
  }
  const reasonCode: RuntimeLimitDecisionReasonCode = input.readyNodeIds.length > 0
    ? 'max_steps'
    : 'max_node_visits';
  const message = reasonCode === 'max_steps'
    ? `Runtime stopped after ${input.maxSteps} graph steps.`
    : 'Runtime stopped after reaching max node visits.';
  return {
    reasonCode,
    message,
    pendingNodeIds,
    data: {
      reasonCode,
      maxNodeVisits: input.maxNodeVisits,
      maxSteps: input.maxSteps,
      pendingNodeIds,
      visitCounts: input.visitCounts,
    },
  };
}
