import type {
  ArchitectureExecutionEvent,
  ArchitectureRouteDecision,
  ArchitectureSchema,
  ArchitectureSchemaNode,
  WorkflowFailure,
} from '@kalio/types';
import { architectureActionSummaryForEvent } from './architecture-action-summary';
import {
  continuationOutgoingNodeId,
  defaultOutgoingNodeId,
} from './architecture-graph-routing.utils';
import { workflowFailureFromError } from '../../common/utils/workflow-error.util';

type RecoverableNodeErrorInput = {
  schema: ArchitectureSchema;
  node: ArchitectureSchemaNode;
  incomingNodeIds: string[];
  outgoingNodeIds: string[];
  error: unknown;
  synthesizedArtifactMessage: string;
};

type RecoverableNodeErrorEventOptions = {
  actionSummary?: string;
  nodeId: string;
  roleSlotId?: string;
  errorCode: WorkflowFailure['code'];
  failure: WorkflowFailure;
  route?: ArchitectureRouteDecision;
  data: Record<string, unknown>;
};

type RecoverableNodeErrorEvent = {
  type: ArchitectureExecutionEvent['type'];
  message: string;
  options: RecoverableNodeErrorEventOptions;
};

export type RecoverableNodeErrorDecision = {
  selectedNodeIds: string[];
  event: RecoverableNodeErrorEvent;
};

const INCOMPLETE_REASON = 'Recoverable runtime error prevented this node from producing a final answer.';

export function recoverableNodeErrorDecision(input: RecoverableNodeErrorInput): RecoverableNodeErrorDecision {
  const failure = workflowFailureFromError(input.error);
  const errorMessage = input.error instanceof Error ? input.error.message : String(input.error);
  const selectedNodeIds = incompleteContinuationNodeIds({
    schema: input.schema,
    outgoingNodeIds: input.outgoingNodeIds,
    sourceNodeId: input.node.id,
  });
  const message = `${input.node.label} degraded after recoverable runtime error: ${errorMessage}`;
  const data = {
    runtimeGuard: 'recoverable_node_error',
    errorCode: failure.code,
    failure,
    errorMessage,
    incomingNodeIds: input.incomingNodeIds,
    outgoingNodeIds: input.outgoingNodeIds,
    selectedNodeIds,
    incompleteReason: INCOMPLETE_REASON,
  };

  if (input.node.kind === 'artifact') {
    return {
      selectedNodeIds,
      event: {
        type: 'final_artifact',
        message: `${message}\n\n${input.synthesizedArtifactMessage}`,
        options: {
          actionSummary: architectureActionSummaryForEvent('final_artifact', 'artifact'),
          nodeId: input.node.id,
          roleSlotId: input.node.roleSlotId,
          errorCode: failure.code,
          failure,
          data,
        },
      },
    };
  }

  const route = runtimeFallbackRoute(input.node.id, input.outgoingNodeIds, selectedNodeIds);
  if (input.node.kind === 'role') {
    return {
      selectedNodeIds,
      event: {
        type: 'participant_output',
        message,
        options: {
          actionSummary: architectureActionSummaryForEvent('participant_output', 'role'),
          nodeId: input.node.id,
          roleSlotId: input.node.roleSlotId,
          errorCode: failure.code,
          failure,
          route,
          data,
        },
      },
    };
  }

  return {
    selectedNodeIds,
    event: {
      type: 'router_decision',
      message,
      options: {
        actionSummary: architectureActionSummaryForEvent('router_decision', input.node.kind),
        nodeId: input.node.id,
        roleSlotId: input.node.roleSlotId,
        errorCode: failure.code,
        failure,
        route,
        data,
      },
    },
  };
}

function incompleteContinuationNodeIds(input: {
  schema: ArchitectureSchema;
  outgoingNodeIds: string[];
  sourceNodeId: string;
}): string[] {
  const defaultNodeId = defaultOutgoingNodeId(input.schema, input.sourceNodeId, input.outgoingNodeIds);
  const nextNodeId = continuationOutgoingNodeId({
    schema: input.schema,
    sourceNodeId: input.sourceNodeId,
    incomingNodeIds: [],
    outgoingNodeIds: input.outgoingNodeIds,
    defaultNodeId,
  }) ?? input.outgoingNodeIds[0];
  return nextNodeId ? [nextNodeId] : [];
}

function runtimeFallbackRoute(
  fromNodeId: string,
  outgoingNodeIds: string[],
  selectedNodeIds: string[],
): ArchitectureRouteDecision {
  return {
    source: 'runtime_fallback',
    fromNodeId,
    selectedNodeIds,
    rejectedNodeIds: outgoingNodeIds.filter((nodeId) => !selectedNodeIds.includes(nodeId)),
    nextNodeId: selectedNodeIds[0],
    response: INCOMPLETE_REASON,
  };
}
