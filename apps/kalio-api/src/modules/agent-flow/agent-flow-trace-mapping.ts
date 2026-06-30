import type { AgentFlowLifecycleEvent, AgentFlowRunStatus, ArchitectureExecutionEvent, WorkflowRuntimeDecision } from '@kalio/types';

type FinalArtifactStatus = 'accepted' | 'blocked' | 'rejected' | 'incomplete';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function eventDataString(event: ArchitectureExecutionEvent, key: string): string | undefined {
  const value = event.data?.[key];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function eventReasonCode(event: ArchitectureExecutionEvent): string | undefined {
  return event.reasonCode ?? eventDataString(event, 'reasonCode');
}

function eventStringArray(event: ArchitectureExecutionEvent, key: string): string[] {
  const value = event.data?.[key];
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.length > 0)
    : [];
}

function isWorkflowRuntimeDecision(value: unknown): value is WorkflowRuntimeDecision {
  return isRecord(value)
    && (
      value['status'] === 'queued'
      || value['status'] === 'running'
      || value['status'] === 'waiting_on_orchestrator'
      || value['status'] === 'done'
      || value['status'] === 'failed'
      || value['status'] === 'cancelled'
      || value['status'] === 'blocked'
    );
}

function eventRuntimeDecision(event: ArchitectureExecutionEvent): WorkflowRuntimeDecision | undefined {
  const dataDecision = isWorkflowRuntimeDecision(event.data?.runtimeDecision)
    ? event.data.runtimeDecision
    : undefined;
  return event.runtimeDecision ?? dataDecision;
}

function isWorkflowEvidence(value: unknown): value is NonNullable<ArchitectureExecutionEvent['evidence']>[number] {
  return isRecord(value)
    && (
      value['kind'] === 'BUILD_RESULT'
      || value['kind'] === 'GIT_STATUS'
      || value['kind'] === 'FINAL_ARTIFACT'
      || value['kind'] === 'QUALITY_GATE'
      || value['kind'] === 'TOOL_RESULT'
      || value['kind'] === 'CLI_CHILD'
      || value['kind'] === 'VFS_WRITE'
      || value['kind'] === 'VFS_READ'
    )
    && (
      value['status'] === 'passed'
      || value['status'] === 'failed'
      || value['status'] === 'blocked'
      || value['status'] === 'unknown'
    );
}

function eventEvidence(event: ArchitectureExecutionEvent): NonNullable<ArchitectureExecutionEvent['evidence']> {
  const dataEvidence = Array.isArray(event.data?.evidence)
    ? event.data.evidence.filter(isWorkflowEvidence)
    : [];
  return [
    ...(event.evidence ?? []),
    ...dataEvidence,
  ];
}

function finalArtifactStatusFromEvent(event: ArchitectureExecutionEvent): FinalArtifactStatus | undefined {
  const status = eventDataString(event, 'finalArtifactStatus') ?? eventDataString(event, 'acceptanceStatus');
  if (status === 'accepted' || status === 'blocked' || status === 'rejected' || status === 'incomplete') {
    return status;
  }
  const finalArtifactEvidence = eventEvidence(event).find((item) => item.kind === 'FINAL_ARTIFACT');
  if (finalArtifactEvidence?.status === 'passed') return 'accepted';
  if (finalArtifactEvidence?.status === 'blocked') return 'blocked';
  if (finalArtifactEvidence?.status === 'failed') return 'rejected';
  if (finalArtifactEvidence?.status === 'unknown') return 'incomplete';
  return undefined;
}

function isGuardRouterEvent(event: ArchitectureExecutionEvent): boolean {
  const decision = eventRuntimeDecision(event);
  if (event.data?.returnToOrchestrator === true) return true;
  if (eventDataString(event, 'slotType') === 'judge') return true;
  if (decision?.reasonCode === 'final_artifact_accepted') return true;
  if (event.reasonCode === 'final_artifact_accepted') return true;
  // TODO: legacy fallback - older durable events did not persist role slot type.
  return event.roleSlotId === 'goal_master' || event.nodeId === 'goal-master';
}

export function normalizeFlowStatus(event: ArchitectureExecutionEvent): AgentFlowRunStatus | undefined {
  if (
    event.type === 'run_stopped'
    && eventReasonCode(event) === 'max_steps'
    && eventStringArray(event, 'pendingNodeIds').length > 0
  ) {
    return 'waiting_on_orchestrator';
  }
  if (event.type === 'final_artifact') {
    const finalArtifactStatus = finalArtifactStatusFromEvent(event);
    if (finalArtifactStatus === 'accepted') return 'done';
    if (finalArtifactStatus === 'blocked' || finalArtifactStatus === 'rejected' || finalArtifactStatus === 'incomplete') {
      return 'blocked';
    }
    return 'done';
  }
  return event.status ?? eventRuntimeDecision(event)?.status;
}

export function normalizeFlowEventType(event: ArchitectureExecutionEvent): string {
  if (event.type === 'run_stopped') return 'flow:stopped';
  if (event.type === 'node_started') return 'flow:node_start';
  if (event.type === 'node_completed' || event.type === 'participant_output') {
    return 'flow:node_result';
  }
  if (event.type === 'router_decision' || event.type === 'router_output') {
    return isGuardRouterEvent(event)
      ? 'flow:guard_result'
      : 'flow:edge_taken';
  }
  if (event.type === 'final_artifact') return 'flow:final_artifact';
  return `flow:${event.type}`;
}

export function normalizeFlowLifecycle(event: ArchitectureExecutionEvent): AgentFlowLifecycleEvent | undefined {
  if (event.type === 'run_created') return 'started';
  if (event.type === 'run_stopped') {
    return normalizeFlowStatus(event) === 'waiting_on_orchestrator'
      ? 'waiting_on_orchestrator'
      : 'cancelled';
  }
  if (event.type === 'node_started') return 'node_started';
  if (event.type === 'node_completed' || event.type === 'participant_output') return 'node_completed';
  if (event.type === 'tool_call') return 'tool_called';
  if (event.type === 'router_decision' || event.type === 'router_output') {
    if (event.data?.returnToOrchestrator === true) return 'return_to_orchestrator';
    if (isGuardRouterEvent(event)) return 'guard_result';
    return 'edge_taken';
  }
  if (event.type === 'final_artifact') {
    const status = normalizeFlowStatus(event);
    if (status === 'blocked') return 'blocked';
    if (status === 'failed') return 'failed';
    return 'done';
  }
  return undefined;
}
