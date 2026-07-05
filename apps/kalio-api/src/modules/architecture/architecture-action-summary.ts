import type { ArchitectureEventAction, ArchitectureExecutionEvent, ArchitectureNodeKind, ArchitectureRouterOutput } from '@kalio/types';

export function architectureCompletedActionSummaryForNodeKind(nodeKind: ArchitectureNodeKind): string {
  if (nodeKind === 'artifact') {
    return 'Final answer produced from the routed graph outputs.';
  }
  if (nodeKind === 'router' || nodeKind === 'parallel') {
    return 'Router completed synthesis for the next graph node.';
  }
  return 'Branch completed its role-specific response.';
}

export function architectureRunningActionSummaryForNodeKind(nodeKind: ArchitectureNodeKind): string {
  if (nodeKind === 'artifact') {
    return 'Finalizer is producing the final answer.';
  }
  if (nodeKind === 'router' || nodeKind === 'parallel') {
    return 'Router is synthesizing the next graph node.';
  }
  return 'Branch is producing its role-specific response.';
}

export function architectureFailedActionSummaryForNodeKind(nodeKind: ArchitectureNodeKind): string {
  if (nodeKind === 'artifact') {
    return 'Finalizer failed to produce the final answer.';
  }
  if (nodeKind === 'router' || nodeKind === 'parallel') {
    return 'Router failed to synthesize the next graph node.';
  }
  return 'Branch failed to produce its role-specific response.';
}

export function architectureCancelledActionSummaryForNodeKind(nodeKind: ArchitectureNodeKind): string {
  if (nodeKind === 'artifact') {
    return 'Finalizer was cancelled before producing the final answer.';
  }
  if (nodeKind === 'router' || nodeKind === 'parallel') {
    return 'Router was cancelled before selecting the next graph node.';
  }
  return 'Branch was cancelled before producing its role-specific response.';
}

export function architectureActionSummaryForEvent(
  type: ArchitectureExecutionEvent['type'],
  nodeKind?: ArchitectureNodeKind,
): string | undefined {
  switch (type) {
    case 'participant_output':
      return architectureCompletedActionSummaryForNodeKind('role');
    case 'router_decision':
    case 'router_output':
      return architectureCompletedActionSummaryForNodeKind(nodeKind ?? 'router');
    case 'final_artifact':
    case 'artifact_created':
      return architectureCompletedActionSummaryForNodeKind('artifact');
    case 'agent_started':
    case 'node_started':
    case 'tool_call':
    case 'human_gate':
      return architectureRunningActionSummaryForNodeKind(nodeKind ?? 'role');
    case 'node_failed':
      return architectureFailedActionSummaryForNodeKind(nodeKind ?? 'role');
    case 'run_stopped':
      return 'Workflow run stopped.';
    case 'run_created':
      return 'Workflow run created.';
    default:
      return undefined;
  }
}

type ArchitectureActionFields = Pick<ArchitectureExecutionEvent, 'actionSummary' | 'action' | 'detail'>;

type ArchitectureEventLike = Pick<ArchitectureExecutionEvent, 'type' | 'route' | 'routerOutput' | 'data' | 'failure' | 'errorCode'>
  & Partial<Pick<ArchitectureExecutionEvent, 'actionSummary' | 'action' | 'detail'>>;

export function architectureActionFieldsForEvent(
  event: ArchitectureEventLike,
  nodeKind?: ArchitectureNodeKind,
): ArchitectureActionFields {
  const computed = computedActionFieldsForEvent(event, nodeKind);
  return {
    actionSummary: event.actionSummary ?? computed.actionSummary,
    action: isArchitectureEventAction(event.action) ? event.action : computed.action,
    detail: nonEmptyString(event.detail) ?? computed.detail,
  };
}

function computedActionFieldsForEvent(
  event: ArchitectureEventLike,
  nodeKind?: ArchitectureNodeKind,
): ArchitectureActionFields {
  const actionSummary = architectureActionSummaryForEvent(event.type, nodeKind);
  const incompleteReason = incompleteReasonFrom(event.data);

  switch (event.type) {
    case 'run_created':
      return { actionSummary, action: 'run_created', detail: 'Run created.' };
    case 'run_stopped':
      return { actionSummary, action: 'run_stopped', detail: runStoppedDetail(event.data) };
    case 'node_failed':
      return { actionSummary, action: 'node_failed', detail: nodeFailedDetail(event) };
    case 'participant_output':
      if (incompleteReason) {
        return { actionSummary, action: 'participant_incomplete', detail: incompleteReason };
      }
      return {
        actionSummary,
        action: 'participant_completed',
        detail: event.route?.nextNodeId ? `Ready for ${event.route.nextNodeId}.` : 'Output recorded.',
      };
    case 'router_decision':
      if (event.data?.['returnToOrchestrator'] === true) {
        return {
          actionSummary,
          action: 'router_returned_to_orchestrator',
          detail: 'Returned control to orchestrator.',
        };
      }
      if (incompleteReason) {
        return { actionSummary, action: 'router_incomplete', detail: incompleteReason };
      }
      return {
        actionSummary,
        action: 'router_selected',
        detail: selectedRouteDetail(event.route),
      };
    case 'router_output':
      return {
        actionSummary,
        action: 'router_synthesized',
        detail: routerOutputDetail(event.routerOutput, event.route?.nextNodeId),
      };
    case 'final_artifact':
    case 'artifact_created':
      return { actionSummary, action: 'finalizer_completed', detail: 'Final answer ready.' };
    default:
      return { actionSummary };
  }
}

function selectedRouteDetail(route: ArchitectureExecutionEvent['route']): string {
  if (route?.nextNodeId) {
    return `Selected ${route.nextNodeId}.`;
  }
  if ((route?.selectedNodeIds?.length ?? 0) > 1) {
    return `Selected ${route?.selectedNodeIds.length} next nodes.`;
  }
  return 'Routing decision recorded.';
}

function routerOutputDetail(
  routerOutput: ArchitectureRouterOutput | undefined,
  nextNodeId: string | undefined,
): string {
  if (routerOutput?.nextAction) {
    return `Next action: ${routerOutput.nextAction}.`;
  }
  if (nextNodeId) {
    return `Prepared ${nextNodeId}.`;
  }
  return 'Synthesis recorded.';
}

function runStoppedDetail(data: Record<string, unknown> | undefined): string {
  const reasonCode = nonEmptyString(data?.['reasonCode']);
  if (reasonCode) {
    return `Stopped: ${reasonCode}.`;
  }
  return 'Run stopped.';
}

function nodeFailedDetail(event: ArchitectureEventLike): string {
  const message = event.failure?.message ?? failureMessageFromData(event.data);
  if (message) {
    return message;
  }
  const errorCode = event.errorCode ?? nonEmptyString(event.data?.['errorCode']);
  return errorCode ? `Failed: ${errorCode}.` : 'Node failed.';
}

function failureMessageFromData(data: Record<string, unknown> | undefined): string | undefined {
  const failure = data?.['failure'];
  if (typeof failure === 'object' && failure !== null && !Array.isArray(failure)) {
    return nonEmptyString((failure as Record<string, unknown>)['message']);
  }
  return undefined;
}

function incompleteReasonFrom(data: Record<string, unknown> | undefined): string | undefined {
  return nonEmptyString(data?.['incompleteReason']);
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function isArchitectureEventAction(value: unknown): value is ArchitectureEventAction {
  return value === 'run_created'
    || value === 'run_stopped'
    || value === 'node_failed'
    || value === 'participant_completed'
    || value === 'participant_incomplete'
    || value === 'router_selected'
    || value === 'router_returned_to_orchestrator'
    || value === 'router_incomplete'
    || value === 'router_synthesized'
    || value === 'finalizer_completed';
}
