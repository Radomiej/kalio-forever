import type {
  ArchitectureEventAction,
  ArchitectureExecutionEvent,
  ArchitectureExecutionEventType,
  ArchitectureExecutionMode,
  ArchitectureNodeBehaviorMode,
  ArchitectureRouteDecision,
  ArchitectureRouterOutput,
  ArchitectureRun,
  WorkflowErrorCode,
  WorkflowEvidence,
  WorkflowEvidenceKind,
  WorkflowEvidenceStatus,
  WorkflowFailure,
  WorkflowReasonCode,
  WorkflowRuntimeDecision,
} from '@kalio/types';

export interface ArchitectureAuditEventSummary {
  type: string;
  reasonCode?: WorkflowReasonCode;
  status?: ArchitectureExecutionEvent['status'];
}

export function statusFromArchitectureEvents(
  events: ArchitectureExecutionEvent[],
): ArchitectureRun['status'] {
  if (events.some((event) => event.type === 'final_artifact')) {
    return 'completed';
  }
  return statusFromArchitectureAuditEventSummary(events.map((event) => ({
    type: event.type,
    reasonCode: architectureAuditReasonCodeForEvent(event),
    status: event.status,
  })));
}

export function statusFromArchitectureAuditEventSummary(
  events: ArchitectureAuditEventSummary[],
): ArchitectureRun['status'] {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event?.status === 'failed' || event?.status === 'blocked') {
      return 'failed';
    }
    if (event?.status === 'cancelled') {
      return 'cancelled';
    }
    if (event?.type === 'run_stopped') {
      return 'cancelled';
    }
    if (event?.type === 'node_failed') {
      return 'failed';
    }
    if (
      event?.type === 'router_decision'
      && (event.reasonCode === 'max_steps' || event.reasonCode === 'max_node_visits')
    ) {
      return 'failed';
    }
    if (event) {
      return 'running';
    }
  }
  return 'running';
}

export function architectureAuditPromptFromRecords(
  records: Array<Record<string, unknown>>,
): string | undefined {
  const created = records.find((record) => record.eventType === 'run_created');
  const prompt = created ? architectureAuditStringField(created, 'prompt') : undefined;
  if (prompt) {
    return prompt;
  }
  const message = created ? architectureAuditStringField(created, 'messagePreview') : undefined;
  const prefix = 'Architecture run created for: ';
  if (!message) {
    return undefined;
  }
  // TODO: legacy fallback - older audit rows only persisted messagePreview; prompt is now a structured audit field.
  return message.slice(0, prefix.length) === prefix ? message.slice(prefix.length) : message;
}

export function architectureAuditExecutionMode(record: Record<string, unknown>): ArchitectureExecutionMode {
  const value = record.executionMode;
  return isArchitectureExecutionMode(value) ? value : 'session_branches';
}

export function architectureAuditStringRecordField(
  record: Record<string, unknown>,
  key: string,
): Record<string, string> | undefined {
  const value = record[key];
  return isStringRecord(value) ? value : undefined;
}

export function architectureAuditStringField(
  record: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = record[key];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

export function architectureAuditNumberField(
  record: Record<string, unknown>,
  key: string,
): number | undefined {
  const value = record[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

export function architectureAuditRecordField(
  record: Record<string, unknown> | undefined,
  key: string,
): Record<string, unknown> | undefined {
  if (!record) return undefined;
  const value = record[key];
  return isPlainRecord(value) ? value : undefined;
}

export function architectureAuditWorkflowReasonCodeField(
  record: Record<string, unknown> | undefined,
  key: string,
): WorkflowReasonCode | undefined {
  const value = record?.[key];
  return typeof value === 'string' && isWorkflowReasonCode(value) ? value : undefined;
}

export function architectureAuditWorkflowErrorCodeField(
  record: Record<string, unknown>,
  key: string,
): WorkflowErrorCode | undefined {
  const value = record[key];
  return typeof value === 'string' && isWorkflowErrorCode(value) ? value : undefined;
}

export function architectureAuditWorkflowFailureField(
  record: Record<string, unknown>,
  key: string,
): WorkflowFailure | undefined {
  const value = record[key];
  if (!isPlainRecord(value)) return undefined;
  const code = architectureAuditWorkflowErrorCodeField(value, 'code');
  const message = architectureAuditStringField(value, 'message');
  const retryable = value['retryable'];
  if (!code || !message || typeof retryable !== 'boolean') return undefined;
  const source = architectureAuditStringField(value, 'source');
  return { code, message, retryable, ...(source ? { source } : {}) };
}

export function architectureAuditWorkflowEvidenceArrayField(
  record: Record<string, unknown>,
  key: string,
): WorkflowEvidence[] | undefined {
  const value = record[key];
  if (!Array.isArray(value)) return undefined;
  const evidence = value
    .map((item) => architectureAuditWorkflowEvidenceField(item))
    .filter((item): item is WorkflowEvidence => item !== undefined);
  return evidence.length > 0 ? evidence : undefined;
}

export function architectureAuditWorkflowEvidenceField(value: unknown): WorkflowEvidence | undefined {
  if (!isPlainRecord(value)) return undefined;
  const kind = value['kind'];
  const status = value['status'];
  if (!isWorkflowEvidenceKind(kind) || !isWorkflowEvidenceStatus(status)) return undefined;
  const source = architectureAuditStringField(value, 'source');
  const data = architectureAuditRecordField(value, 'data');
  return { kind, status, ...(source ? { source } : {}), ...(data ? { data } : {}) };
}

export function architectureAuditWorkflowRuntimeDecisionField(
  record: Record<string, unknown>,
  key: string,
): WorkflowRuntimeDecision | undefined {
  const value = record[key];
  if (!isPlainRecord(value)) return undefined;
  const status = value['status'];
  if (
    status !== 'queued'
    && status !== 'running'
    && status !== 'waiting_on_orchestrator'
    && status !== 'done'
    && status !== 'failed'
    && status !== 'cancelled'
    && status !== 'blocked'
  ) {
    return undefined;
  }
  const reasonCode = architectureAuditWorkflowReasonCodeField(value, 'reasonCode');
  const nextNodeId = architectureAuditStringField(value, 'nextNodeId');
  const message = architectureAuditStringField(value, 'message');
  const accepted = value['accepted'];
  return {
    status,
    ...(reasonCode ? { reasonCode } : {}),
    ...(typeof accepted === 'boolean' ? { accepted } : {}),
    ...(nextNodeId ? { nextNodeId } : {}),
    ...(message ? { message } : {}),
  };
}

export function architectureAuditReasonCodeForEvent(
  event: ArchitectureExecutionEvent,
): WorkflowReasonCode | undefined {
  return event.reasonCode ?? architectureAuditWorkflowReasonCodeField(event.data, 'reasonCode');
}

export function architectureAuditRouteDecisionField(
  record: Record<string, unknown>,
  key: string,
): ArchitectureRouteDecision | undefined {
  const value = record[key];
  return isArchitectureRouteDecision(value) ? value : undefined;
}

export function architectureAuditRouterOutputField(
  record: Record<string, unknown>,
  key: string,
): ArchitectureRouterOutput | undefined {
  const value = record[key];
  return isArchitectureRouterOutput(value) ? value : undefined;
}

export function architectureAuditEventActionField(
  record: Record<string, unknown>,
  key: string,
): ArchitectureEventAction | undefined {
  const value = record[key];
  return value === 'run_created'
    || value === 'run_stopped'
    || value === 'node_failed'
    || value === 'participant_completed'
    || value === 'participant_incomplete'
    || value === 'router_selected'
    || value === 'router_returned_to_orchestrator'
    || value === 'router_incomplete'
    || value === 'router_synthesized'
    || value === 'finalizer_completed'
    ? value
    : undefined;
}

export function isArchitectureExecutionEventType(value: unknown): value is ArchitectureExecutionEventType {
  return value === 'run_created'
    || value === 'node_started'
    || value === 'agent_started'
    || value === 'participant_output'
    || value === 'router_decision'
    || value === 'router_output'
    || value === 'tool_call'
    || value === 'human_gate'
    || value === 'artifact_created'
    || value === 'memory_persisted'
    || value === 'final_artifact'
    || value === 'node_failed'
    || value === 'node_completed'
    || value === 'run_stopped';
}

function isWorkflowReasonCode(value: string): value is WorkflowReasonCode {
  return value === 'user_stop'
    || value === 'system_stop'
    || value === 'max_steps'
    || value === 'max_node_visits'
    || value === 'return_to_orchestrator'
    || value === 'runtime_pause'
    || value === 'runtime_missing'
    || value === 'runtime_stalled'
    || value === 'unresolved_cli_children'
    || value === 'return_to_orchestrator_cap_exceeded'
    || value === 'resume_failed'
    || value === 'missing_final_artifact'
    || value === 'finalization_missing'
    || value === 'final_artifact_blocker'
    || value === 'final_artifact_accepted'
    || value === 'external_quality_gate_passed'
    || value === 'external_quality_gate_failed';
}

function isWorkflowErrorCode(value: string): value is WorkflowErrorCode {
  return value === 'RATE_LIMITED'
    || value === 'TIMEOUT'
    || value === 'PROVIDER_UNAVAILABLE'
    || value === 'PROVIDER_UNAUTHORIZED'
    || value === 'INVALID_ARGUMENT'
    || value === 'CONTRACT_VIOLATION'
    || value === 'CLI_AGENT_AUTH_REQUIRED'
    || value === 'CLI_AGENT_ERROR'
    || value === 'CLI_AGENT_SESSION_METADATA_MISSING'
    || value === 'CLI_AGENT_STOPPED'
    || value === 'SUBAGENT_TIMEOUT'
    || value === 'RAAPP_RELEASE_NOT_FOUND'
    || value === 'UNKNOWN';
}

function isWorkflowEvidenceKind(value: unknown): value is WorkflowEvidenceKind {
  return value === 'BUILD_RESULT'
    || value === 'GIT_STATUS'
    || value === 'FINAL_ARTIFACT'
    || value === 'QUALITY_GATE'
    || value === 'TOOL_RESULT'
    || value === 'CLI_CHILD'
    || value === 'VFS_WRITE'
    || value === 'VFS_READ';
}

function isWorkflowEvidenceStatus(value: unknown): value is WorkflowEvidenceStatus {
  return value === 'passed'
    || value === 'failed'
    || value === 'blocked'
    || value === 'unknown';
}

function isArchitectureRouteDecision(value: unknown): value is ArchitectureRouteDecision {
  return isPlainRecord(value)
    && (value.source === 'agent' || value.source === 'router' || value.source === 'parallel' || value.source === 'runtime_fallback')
    && isNonEmptyString(value.fromNodeId)
    && Array.isArray(value.selectedNodeIds)
    && value.selectedNodeIds.every((nodeId) => typeof nodeId === 'string')
    && (value.rejectedNodeIds === undefined || (Array.isArray(value.rejectedNodeIds) && value.rejectedNodeIds.every((nodeId) => typeof nodeId === 'string')))
    && (value.nextNodeId === undefined || typeof value.nextNodeId === 'string')
    && (value.convergeToNodeId === undefined || typeof value.convergeToNodeId === 'string')
    && (value.mode === undefined || isNodeBehaviorMode(value.mode))
    && (value.response === undefined || typeof value.response === 'string');
}

function isArchitectureRouterOutput(value: unknown): value is ArchitectureRouterOutput {
  return isPlainRecord(value)
    && typeof value.selectedStrategy === 'string'
    && typeof value.mergedDecision === 'string'
    && Array.isArray(value.acceptedInputs)
    && Array.isArray(value.rejectedInputs)
    && Array.isArray(value.unresolvedConflicts)
    && Array.isArray(value.risks)
    && typeof value.confidence === 'number'
    && Number.isFinite(value.confidence)
    && (
      value.nextAction === 'finalize'
      || value.nextAction === 'ask_human'
      || value.nextAction === 'route_to'
      || value.nextAction === 'run_more_research'
      || value.nextAction === 'rerun_with_different_personas'
    )
    && (
      value.nextAction !== 'route_to'
      || typeof value.targetNodeId === 'string'
    )
    && (
      value.targetNodeId === undefined
      || typeof value.targetNodeId === 'string'
    )
    && (
      value.response === undefined
      || typeof value.response === 'string'
    );
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return isPlainRecord(value)
    && Object.values(value).every((entry) => typeof entry === 'string' && entry.length > 0);
}

function isArchitectureExecutionMode(value: unknown): value is ArchitectureExecutionMode {
  return value === 'session_branches' || value === 'subagent_execution';
}

function isNodeBehaviorMode(value: unknown): value is ArchitectureNodeBehaviorMode {
  return value === 'fan_out_all'
    || value === 'choose_one'
    || value === 'rank_then_merge'
    || value === 'merge_inputs'
    || value === 'finalize';
}
