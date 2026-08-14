import type {
  ArchitectureExecutionEvent,
  ArchitectureRun,
  ArchitectureSchema,
  WorkflowFailure,
  WorkflowReasonCode,
} from '@kalio/types';
import type { RuntimeAuditEventInput } from '../chat/runtime-audit-logger.service';

export function architectureRuntimeAuditEventInput(
  schema: ArchitectureSchema,
  run: ArchitectureRun,
  event: ArchitectureExecutionEvent,
  sessionId: string,
): RuntimeAuditEventInput | null {
  const eventName = workflowRuntimeEventName(event);
  if (!eventName) {
    return null;
  }

  return {
    eventName,
    sessionId,
    runId: run.id,
    nodeId: event.nodeId,
    status: workflowRuntimeEventStatus(event),
    reasonCode: event.reasonCode,
    errorCode: event.errorCode,
    data: {
      schemaId: schema.id,
      executionMode: run.executionMode,
      eventId: event.id,
      eventType: event.type,
      sequence: event.sequence,
      roleSlotId: event.roleSlotId,
      routeSource: event.route?.source,
      nextNodeId: event.route?.nextNodeId,
      selectedNodeIds: event.route?.selectedNodeIds,
      failure: event.failure ? {
        code: event.failure.code,
        source: event.failure.source,
        retryable: event.failure.retryable,
      } : undefined,
    },
  };
}

export function architectureFailureRuntimeAuditEventInput(
  schema: ArchitectureSchema,
  run: ArchitectureRun,
  failure: WorkflowFailure,
  sessionId: string,
): RuntimeAuditEventInput {
  return {
    eventName: 'workflow.run.failed',
    sessionId,
    runId: run.id,
    status: 'failed',
    errorCode: failure.code,
    data: {
      schemaId: schema.id,
      executionMode: run.executionMode,
      rootSessionId: run.rootSessionId,
      branchSessionCount: Object.keys(run.branchSessionIds ?? {}).length,
      failure: {
        code: failure.code,
        source: failure.source,
        retryable: failure.retryable,
      },
    },
  };
}

function workflowRuntimeEventName(event: ArchitectureExecutionEvent): RuntimeAuditEventInput['eventName'] | null {
  if (event.type === 'run_created') return 'workflow.run.started';
  if (event.type === 'run_stopped') return 'workflow.run.cancelled';
  if (event.type === 'node_started') return 'workflow.node.started';
  if (event.type === 'agent_started') return 'workflow.agent.started';
  if (event.type === 'node_completed') return 'workflow.node.completed';
  if (event.type === 'node_failed') return 'workflow.node.failed';
  if (event.type === 'participant_output') return 'workflow.node.output';
  if (event.type === 'router_decision') {
    const reasonCode = reasonCodeForEvent(event);
    return reasonCode === 'max_steps' || reasonCode === 'max_node_visits'
      ? 'workflow.run.failed'
      : 'workflow.router.decision';
  }
  if (event.type === 'router_output') return 'workflow.router.output';
  if (event.type === 'final_artifact') return 'workflow.run.completed';
  return null;
}

function workflowRuntimeEventStatus(event: ArchitectureExecutionEvent): RuntimeAuditEventInput['status'] {
  const reasonCode = reasonCodeForEvent(event);
  if (event.type === 'run_created' || event.type === 'node_started' || event.type === 'agent_started') {
    return 'started';
  }
  if (event.type === 'run_stopped' || event.status === 'cancelled') {
    return 'cancelled';
  }
  if (
    event.type === 'node_failed'
    || event.status === 'failed'
    || event.status === 'blocked'
    || reasonCode === 'max_steps'
    || reasonCode === 'max_node_visits'
  ) {
    return 'failed';
  }
  if (event.type === 'final_artifact' || event.type === 'node_completed') {
    return 'completed';
  }
  return 'running';
}

function reasonCodeForEvent(event: ArchitectureExecutionEvent): WorkflowReasonCode | undefined {
  if (event.reasonCode) {
    return event.reasonCode;
  }
  const value = event.data?.['reasonCode'];
  return typeof value === 'string' ? value as WorkflowReasonCode : undefined;
}
