import type { ArchitectureExecutionEvent, ArchitectureRoleSlot, ArchitectureSchema } from '@kalio/types';
import { isCompletedCliChildStatus } from './architecture-cli-child-status';

export type ArchitectureGraphFinalizationInput = {
  schema: ArchitectureSchema;
  runContext: Record<string, unknown> | undefined;
  events: ArchitectureExecutionEvent[];
  priorEvents?: ArchitectureExecutionEvent[];
};

type ToolEvidence = {
  toolResultCount: number;
  successfulToolNames: string[];
  targetPaths: string[];
  childCliSessions: Array<{ status?: string }>;
};

type ToolExecutorContractInput = ArchitectureGraphFinalizationInput & {
  slot: ArchitectureRoleSlot;
  data: Record<string, unknown>;
  incomingEvents: ArchitectureExecutionEvent[];
};

type IncompleteToolExecutorReasonInput = {
  slot: ArchitectureRoleSlot;
  data: Record<string, unknown>;
  incomingEvents: ArchitectureExecutionEvent[];
};

export function blockingFinalizationReason(input: ArchitectureGraphFinalizationInput): string | undefined {
  const externalBlocker = blockingExternalQualityGateReason(input.runContext);
  if (externalBlocker) {
    return externalBlocker;
  }
  if (externalQualityGateAcceptanceReason(input) && hasVisibleWorkflowToolProof(input)) {
    return undefined;
  }
  return blockingIncompleteMaterializationReason(input);
}

export function externalQualityGateAcceptanceReason(input: Pick<ArchitectureGraphFinalizationInput, 'runContext'>): string | undefined {
  for (const gate of externalQualityGates(input.runContext)) {
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

export function hasVisibleWorkflowToolProof(input: Pick<ArchitectureGraphFinalizationInput, 'schema' | 'events'>): boolean {
  const workflowToolSlotIds = new Set(
    input.schema.roleSlots
      .filter((slot) => slot.slotType === 'participant' || slot.slotType === 'router' || slot.slotType === 'tool_executor')
      .map((slot) => slot.id),
  );
  return input.events.some((event) => (
    event.type === 'participant_output'
    && event.roleSlotId !== undefined
    && workflowToolSlotIds.has(event.roleSlotId)
    && architectureIncompleteResultReason(event.data) === undefined
    && hasSuccessfulToolExecutorEvidence(event.data)
  ));
}

export function architectureToolExecutorContract(input: ToolExecutorContractInput): { ok: true } | { ok: false; reason: string } {
  const independentHostVerificationEvidence = hasIndependentHostVerificationEvidence(input);
  if (isGoalGuardProofImplementer(input.slot, input.runContext)) {
    const evidence = toolEvidence(input.data);
    if (!hasOwnMaterializationEvidence(evidence)) {
      if (independentHostVerificationEvidence) {
        return { ok: true };
      }
      if (hasIncompleteCliDelegationEvidence(evidence)) {
        return { ok: true };
      }
      return { ok: false, reason: 'implementer did not produce a successful write result' };
    }
    return { ok: true };
  }
  if (input.slot.slotType !== 'tool_executor') {
    return { ok: true };
  }
  const evidence = toolEvidence(input.data);
  if (evidence.toolResultCount < 1) {
    if (isImplementationProofSlot(input.slot) && independentHostVerificationEvidence) {
      return { ok: true };
    }
    return { ok: false, reason: 'no tool result was observed' };
  }
  if (
    isImplementationProofSlot(input.slot)
    && !hasMaterializationEvidence(evidence, input.incomingEvents)
    && !hasIncompleteCliDelegationEvidence(evidence)
    && !independentHostVerificationEvidence
  ) {
    return { ok: false, reason: `${input.slot.id} did not produce a successful write result` };
  }
  if (isVerifierSlot(input.slot) && !evidence.successfulToolNames.some((name) => (
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

export function incompleteToolExecutorReason(input: IncompleteToolExecutorReasonInput): string | undefined {
  if (input.slot.slotType !== 'tool_executor' || !isImplementationProofSlot(input.slot)) {
    return undefined;
  }
  const evidence = toolEvidence(input.data);
  if (hasMaterializationEvidence(evidence, input.incomingEvents)) {
    return undefined;
  }
  return incompleteCliDelegationReason(evidence);
}

export function architectureIncompleteResultReason(data: ArchitectureExecutionEvent['data'] | undefined): string | undefined {
  if (!isRecord(data)) return undefined;
  const displayReason = typeof data['incompleteReason'] === 'string' && data['incompleteReason'].trim().length > 0
    ? data['incompleteReason']
    : undefined;
  const failure = isRecord(data['failure']) ? data['failure'] : undefined;
  if (failure?.['retryable'] === true || isRecoverableWorkflowErrorCode(data['errorCode'])) {
    return displayReason ?? 'Recoverable runtime error prevented this node from producing a final answer.';
  }
  if (data['boundedToolLoopExhausted'] === true || data['reasonCode'] === 'max_steps') {
    return displayReason ?? 'Subagent exhausted its tool loop without producing a final answer.';
  }
  return undefined;
}

export function workflowEvidenceArray(data: Record<string, unknown>): ArchitectureExecutionEvent['evidence'] {
  const value = data['evidence'];
  if (!Array.isArray(value)) {
    return undefined;
  }
  const evidence = value
    .filter((item): item is NonNullable<ArchitectureExecutionEvent['evidence']>[number] => {
      if (!isRecord(item)) {
        return false;
      }
      return isWorkflowEvidenceKind(item['kind'])
        && isWorkflowEvidenceStatus(item['status']);
    })
    .map((item) => ({
      kind: item.kind,
      status: item.status,
      ...(typeof item.source === 'string' ? { source: item.source } : {}),
      ...(isRecord(item.data) ? { data: item.data } : {}),
    }));
  return evidence.length > 0 ? evidence : undefined;
}

function blockingExternalQualityGateReason(runContext: Record<string, unknown> | undefined): string | undefined {
  for (const gate of externalQualityGates(runContext)) {
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

function externalQualityGates(runContext: Record<string, unknown> | undefined): Array<Record<string, unknown>> {
  if (!isRecord(runContext)) {
    return [];
  }
  return [
    ...qualityGatesFromRecord(runContext),
    ...(isRecord(runContext['resumeContext']) ? qualityGatesFromRecord(runContext['resumeContext']) : []),
  ];
}

function qualityGatesFromRecord(record: Record<string, unknown>): Array<Record<string, unknown>> {
  const single = isRecord(record['externalQualityGate']) ? [record['externalQualityGate']] : [];
  const multiple = Array.isArray(record['externalQualityGates'])
    ? record['externalQualityGates'].filter((value): value is Record<string, unknown> => isRecord(value))
    : [];
  return [...single, ...multiple];
}

function hasSuccessfulToolExecutorEvidence(data: Record<string, unknown> | undefined): boolean {
  if (!isRecord(data)) {
    return false;
  }
  const evidence = toolEvidence(data);
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

function blockingIncompleteMaterializationReason(input: ArchitectureGraphFinalizationInput): string | undefined {
  const implementationProofSlotIds = new Set(
    input.schema.roleSlots
      .filter((slot) => isImplementationProofSlot(slot))
      .map((slot) => slot.id),
  );
  for (const event of [...input.events].reverse()) {
    if (
      event.type !== 'participant_output'
      || event.roleSlotId === undefined
      || !implementationProofSlotIds.has(event.roleSlotId)
    ) {
      continue;
    }
    const evidence = isRecord(event.data) ? toolEvidence(event.data) : null;
    if (!evidence) {
      continue;
    }
    if (hasIndependentHostVerificationEvidence(input)) {
      return undefined;
    }
    const unresolvedReason = unresolvedCliChildReason(evidence);
    if (unresolvedReason) {
      return unresolvedReason;
    }
    if (hasMaterializationEvidence(evidence, input.events)) {
      return undefined;
    }
    const reason = incompleteCliDelegationReason(evidence);
    if (reason) {
      return reason;
    }
  }
  return undefined;
}

function hasIndependentHostVerificationEvidence(input: ArchitectureGraphFinalizationInput): boolean {
  return [
    ...(input.priorEvents ?? []),
    ...input.events,
  ].some((event) => {
    if (event.type !== 'participant_output' && event.type !== 'router_decision') {
      return false;
    }
    if (!isRecord(event.data)) {
      return false;
    }
    const evidence = toolEvidence(event.data);
    const hasReadEvidence = evidence.successfulToolNames.some((name) => (
      name === 'fs_list'
      || name === 'fs_read'
      || name === 'vfs_list'
      || name === 'vfs_read'
    ));
    return hasReadEvidence && hasPassedBuildResultEvidence(event);
  });
}

function hasPassedBuildResultEvidence(event: ArchitectureExecutionEvent): boolean {
  return workflowEvidenceForEvent(event).some((evidence) => {
    if (evidence.kind !== 'BUILD_RESULT' || evidence.status !== 'passed' || !isRecord(evidence.data)) {
      return false;
    }
    return numberField(evidence.data, 'exitCode') === 0;
  });
}

function workflowEvidenceForEvent(event: ArchitectureExecutionEvent): NonNullable<ArchitectureExecutionEvent['evidence']> {
  if (event.evidence && event.evidence.length > 0) {
    return event.evidence;
  }
  return isRecord(event.data) ? workflowEvidenceArray(event.data) ?? [] : [];
}

function unresolvedCliChildReason(evidence: Pick<ToolEvidence, 'childCliSessions'>): string | undefined {
  const unresolved = evidence.childCliSessions.find((session) => !isCompletedCliChildStatus(session.status));
  return unresolved
    ? `CLI child implementation is incomplete: child status is ${unresolved.status ?? 'unknown'}.`
    : undefined;
}

function hasMaterializationEvidence(evidence: ToolEvidence, incomingEvents: ArchitectureExecutionEvent[]): boolean {
  if (hasOwnMaterializationEvidence(evidence)) {
    return true;
  }
  if (hasCliMaterializationEvidence(evidence)) {
    return true;
  }
  return incomingEvents.some((event) => (
    architectureIncompleteResultReason(event.data) === undefined
    && isRecord(event.data)
    && hasCliMaterializationEvidence(toolEvidence(event.data))
  ));
}

function hasOwnMaterializationEvidence(evidence: ToolEvidence): boolean {
  return evidence.successfulToolNames.some((name) => name === 'vfs_write' || name === 'fs_write')
    || hasCliMaterializationEvidence(evidence);
}

function hasCliMaterializationEvidence(evidence: ToolEvidence): boolean {
  if (evidence.childCliSessions.some((session) => !isCompletedCliChildStatus(session.status))) {
    return false;
  }
  return evidence.successfulToolNames.some((name) => (
    name === 'run_cli_agent'
    || name === 'spawn_cli_agent'
    || name === 'message_cli_agent'
  )) && evidence.targetPaths.length > 0;
}

function hasIncompleteCliDelegationEvidence(evidence: ToolEvidence): boolean {
  return evidence.childCliSessions.length > 0
    && evidence.targetPaths.length > 0
    && evidence.successfulToolNames.some((name) => (
      name === 'spawn_cli_agent'
      || name === 'message_cli_agent'
      || name === 'run_cli_agent'
    ));
}

function incompleteCliDelegationReason(evidence: ToolEvidence): string | undefined {
  if (!hasIncompleteCliDelegationEvidence(evidence) || hasCliMaterializationEvidence(evidence)) {
    return undefined;
  }
  return unresolvedCliChildReason(evidence) ?? 'CLI child implementation is incomplete.';
}

function toolEvidence(data: Record<string, unknown>): ToolEvidence {
  const evidence = data['toolEvidence'];
  if (!isRecord(evidence)) {
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
      .filter((value): value is Record<string, unknown> => isRecord(value))
      .map((value) => ({
        status: typeof value['status'] === 'string' ? value['status'] : undefined,
      }))
    : [];
  return { toolResultCount, successfulToolNames, targetPaths, childCliSessions };
}

function isGoalGuardProofImplementer(slot: ArchitectureRoleSlot, runContext: Record<string, unknown> | undefined): boolean {
  return slot.id === 'implementer'
    && slot.slotType === 'tool_executor'
    && (
      runContext?.['requireGoalMasterLoopProof'] === true
      || runContext?.['requireImplementerWriteProof'] === true
    );
}

function isImplementationProofSlot(slot: ArchitectureRoleSlot): boolean {
  return slot.id === 'implementer';
}

function isVerifierSlot(slot: ArchitectureRoleSlot): boolean {
  return /\bverifier\b/i.test(`${slot.id} ${slot.label}`);
}

function isWorkflowEvidenceKind(value: unknown): value is NonNullable<ArchitectureExecutionEvent['evidence']>[number]['kind'] {
  return value === 'BUILD_RESULT'
    || value === 'GIT_STATUS'
    || value === 'FINAL_ARTIFACT'
    || value === 'QUALITY_GATE'
    || value === 'TOOL_RESULT'
    || value === 'CLI_CHILD'
    || value === 'VFS_WRITE'
    || value === 'VFS_READ';
}

function isWorkflowEvidenceStatus(value: unknown): value is NonNullable<ArchitectureExecutionEvent['evidence']>[number]['status'] {
  return value === 'passed'
    || value === 'failed'
    || value === 'blocked'
    || value === 'unknown';
}

function isRecoverableWorkflowErrorCode(value: unknown): boolean {
  return value === 'RATE_LIMITED'
    || value === 'TIMEOUT'
    || value === 'PROVIDER_UNAVAILABLE'
    || value === 'SUBAGENT_TIMEOUT';
}

function numberField(payload: Record<string, unknown>, key: string): number | undefined {
  const value = payload[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
