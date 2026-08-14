import type { ArchitectureExecutionEvent, ArchitectureNodeKind, ArchitectureRoleSlot, ArchitectureRun } from '@kalio/types';
import type { ArchitectureBranchStreamSnapshot } from './architecture-stream-hooks';
import { routerOutputFromStructuredOutput } from './architecture-structured-output';

export interface ArchitectureToolEvidence {
  toolCallCount: number;
  toolResultCount: number;
  toolNames: string[];
  successfulToolNames: string[];
  targetPaths: string[];
  childCliSessions?: Array<{
    childSessionId: string;
    agentId?: string;
    workdir?: string;
    status?: string;
  }>;
}

export interface ArchitectureRoleEvidenceInput {
  run: Pick<ArchitectureRun, 'context'>;
  slot: Pick<ArchitectureRoleSlot, 'id' | 'label' | 'slotType'>;
  node?: { kind?: ArchitectureNodeKind };
}

export function architectureSlotMessage(
  input: ArchitectureRoleEvidenceInput,
  rawMessage: string,
  toolEvidence: ArchitectureToolEvidence,
  boundedToolLoopExhausted = false,
  structuredOutput?: unknown,
): string {
  const routerMessage = architectureRouterStructuredMessage(input, structuredOutput);
  if (routerMessage) {
    return routerMessage;
  }

  if (
    !boundedToolLoopExhausted
    || input.slot.slotType === 'tool_executor'
    || toolEvidence.toolResultCount === 0
  ) {
    return rawMessage;
  }

  const successful = toolEvidence.successfulToolNames.length > 0
    ? toolEvidence.successfulToolNames.join(', ')
    : 'none';
  const evidencePaths = compactEvidencePaths(input, toolEvidence.targetPaths);
  const paths = evidencePaths.length > 0
    ? `Evidence paths: ${evidencePaths.slice(0, 8).join(', ')}.`
    : '';
  if (input.slot.slotType === 'router') {
    return [
      `${input.slot.label} completed a bounded evidence pass.`,
      `Evidence: ${toolEvidence.toolResultCount} tool result(s), successful=${successful}.`,
      paths,
      'Risk: the router did not produce a full narrative before the tool budget ended.',
      'Next step: synthesize from collected evidence and continue to the selected node.',
    ].filter((part) => part.length > 0).join(' ');
  }

  return [
    `${input.slot.label} completed a bounded evidence pass.`,
    `Recommendation: ${boundedRecommendationForSlot(input.slot)}.`,
    `Evidence: ${toolEvidence.toolResultCount} tool result(s), successful=${successful}.`,
    paths,
    'Risk: the slot did not produce a full narrative before the tool budget ended.',
    'Next step: pass this evidence to the router/finalizer; rerun this slot with a larger iteration budget only if its independent reasoning is required.',
  ].filter((part) => part.length > 0).join(' ');
}

function architectureRouterStructuredMessage(
  input: ArchitectureRoleEvidenceInput,
  structuredOutput: unknown,
): string | undefined {
  if (input.slot.slotType !== 'router' && input.slot.slotType !== 'judge' && input.node?.kind !== 'router') {
    return undefined;
  }
  const routerOutput = routerOutputFromStructuredOutput(structuredOutput);
  if (!routerOutput) {
    return undefined;
  }

  const target = routerOutput.nextAction === 'route_to' && routerOutput.targetNodeId
    ? routerOutput.targetNodeId
    : routerOutput.nextAction;
  const decision = routerOutput.mergedDecision.trim();
  const response = routerOutput.response?.trim();
  const confidence = Number.isFinite(routerOutput.confidence)
    ? ` Confidence: ${Math.round(routerOutput.confidence * 100)}%.`
    : '';
  const evidence = `Accepted inputs: ${routerOutput.acceptedInputs.length}; rejected inputs: ${routerOutput.rejectedInputs.length}.`;
  const details = [
    decision.length > 0 ? `Decision: ${decision}` : '',
    response && response !== decision ? `Handoff: ${response}` : '',
  ].filter((part) => part.length > 0).join(' ');
  const suffix = details.length > 0 ? ` ${details}` : '';
  return `${input.slot.label} handed off to ${target}.${confidence} ${evidence}${suffix}`.trim();
}

export function architectureRecoverableErrorMessage(
  input: ArchitectureRoleEvidenceInput,
  error: unknown,
  toolEvidence: ArchitectureToolEvidence,
): string {
  const errorMessage = error instanceof Error ? error.message : String(error);
  const successful = toolEvidence.successfulToolNames.length > 0
    ? toolEvidence.successfulToolNames.join(', ')
    : 'none';
  const evidencePaths = compactEvidencePaths(input, toolEvidence.targetPaths);
  const paths = evidencePaths.length > 0
    ? `Evidence paths: ${evidencePaths.slice(0, 8).join(', ')}.`
    : '';
  return [
    `${input.slot.label} hit a recoverable branch error: ${errorMessage}.`,
    `Partial tool evidence: ${toolEvidence.toolResultCount} result(s), ${toolEvidence.toolCallCount} call(s), successful=${successful}.`,
    paths,
    'Conclusion: continue the architecture with explicit verification of the visible worktree instead of discarding the child-agent work.',
  ].filter((part) => part.length > 0).join(' ');
}

export function compactStreamSnapshot(snapshot: ArchitectureBranchStreamSnapshot): Record<string, unknown> {
  return {
    streamGroupId: snapshot.streamGroupId,
    runId: snapshot.runId,
    nodeId: snapshot.nodeId,
    roleSlotId: snapshot.roleSlotId,
    branchSessionId: snapshot.branchSessionId,
    personaId: snapshot.personaId,
    status: snapshot.status,
    chunkCount: snapshot.chunkCount,
    toolCallCount: snapshot.events.filter((event) => event.event === 'tool:start').length,
    toolResultCount: snapshot.events.filter((event) => event.event === 'tool:result').length,
  };
}

export function summarizeToolEvidence(snapshot: ArchitectureBranchStreamSnapshot): ArchitectureToolEvidence {
  const toolNames = uniqueStrings(snapshot.events
    .filter((event) => event.event === 'tool:start' && event.toolName)
    .map((event) => event.toolName));
  const successfulToolNames = uniqueStrings(snapshot.events
    .filter((event) => event.event === 'tool:result' && event.toolName && isSuccessfulToolResultEvent(event))
    .map((event) => event.toolName));
  const targetPaths = uniqueStrings(snapshot.events
    .filter((event) => event.event === 'tool:start' && event.toolPath)
    .map((event) => event.toolPath));
  const childCliSessions = summarizeChildCliSessions(snapshot);
  return {
    toolCallCount: snapshot.events.filter((event) => event.event === 'tool:start').length,
    toolResultCount: snapshot.events.filter((event) => event.event === 'tool:result').length,
    toolNames,
    successfulToolNames,
    targetPaths,
    ...(childCliSessions.length > 0 ? { childCliSessions } : {}),
  };
}

export function incomingEventEvidenceSummary(event: ArchitectureExecutionEvent): string {
  const data = isRecord(event.data) ? event.data : {};
  const eventRecord: Record<string, unknown> = isRecord(event) ? event : {};
  const parts: string[] = [];
  const incompleteReason = typeof data['incompleteReason'] === 'string'
    ? data['incompleteReason']
    : typeof eventRecord['incompleteReason'] === 'string'
      ? eventRecord['incompleteReason']
      : undefined;
  const toolEvidence = isToolEvidence(data['toolEvidence']) ? data['toolEvidence'] : undefined;

  if (toolEvidence) {
    const successful = toolEvidence.successfulToolNames.length > 0
      ? toolEvidence.successfulToolNames.join(', ')
      : 'none';
    const targetPathList = Array.isArray(toolEvidence.targetPaths) ? toolEvidence.targetPaths : [];
    const targetPaths = targetPathList.length > 0
      ? `, paths=${targetPathList.slice(0, 6).join(', ')}`
      : '';
    const childCliSessions = Array.isArray(toolEvidence.childCliSessions)
      ? toolEvidence.childCliSessions.filter((item): item is NonNullable<ArchitectureToolEvidence['childCliSessions']>[number] => isRecord(item) && typeof item['childSessionId'] === 'string')
      : [];
    const childCliSummary = childCliSessions.length > 0
      ? `, childCliSessions=${childCliSessions
        .slice(0, 3)
        .map((session) => `${session.childSessionId}${session.status ? `:${session.status}` : ''}${session.workdir ? `@${session.workdir}` : ''}`)
        .join(', ')}`
      : '';
    parts.push(`toolEvidence=${toolEvidence.toolResultCount} result(s), successful=${successful}${targetPaths}${childCliSummary}`);
  }
  if (incompleteReason) {
    parts.push(`incomplete=${incompleteReason}`);
  }

  return parts.length > 0 ? ` [${parts.join('; ')}]` : '';
}

const USER_RECOMMENDATION_SLOT_IDS = new Set(['user_advocate', 'ux_researcher']);
const CRITIC_RECOMMENDATION_SLOT_IDS = new Set(['shadow', 'devil_advocate', 'research_critic', 'critic', 'reviewer', 'qa_quality']);
const INNOVATOR_RECOMMENDATION_SLOT_IDS = new Set(['innovator']);
const ANALYST_RECOMMENDATION_SLOT_IDS = new Set(['analyst', 'technical_researcher', 'repo_researcher']);

function boundedRecommendationForSlot(slot: Pick<ArchitectureRoleSlot, 'id' | 'slotType'>): string {
  if (USER_RECOMMENDATION_SLOT_IDS.has(slot.id)) {
    return 'prioritize the user-visible improvement with the clearest evidence and lowest onboarding friction';
  }
  if (CRITIC_RECOMMENDATION_SLOT_IDS.has(slot.id) || slot.slotType === 'critic') {
    return 'prefer the option with the smallest regression surface and explicit fallback behavior';
  }
  if (INNOVATOR_RECOMMENDATION_SLOT_IDS.has(slot.id)) {
    return 'choose the improvement that makes the demo feel more intentional without touching core runtime logic';
  }
  if (ANALYST_RECOMMENDATION_SLOT_IDS.has(slot.id)) {
    return 'choose the improvement supported by the most direct file evidence and easiest verification path';
  }
  return 'choose the lowest-risk improvement supported by the collected project evidence';
}

function compactEvidencePaths(input: ArchitectureRoleEvidenceInput, paths: string[]): string[] {
  const root = localProjectPathFromContext(input.run.context);
  if (!root) {
    return paths;
  }
  const normalizedRoot = trimTrailingSlash(root).toLowerCase();
  return paths.map((path) => {
    const normalizedPath = path.toLowerCase();
    if (normalizedPath === normalizedRoot) {
      return '.';
    }
    const prefix = `${normalizedRoot}\\`;
    if (normalizedPath.startsWith(prefix)) {
      return path.slice(prefix.length).replace(/\\/g, '/');
    }
    return path.replace(/\\/g, '/');
  });
}

function localProjectPathFromContext(context: Record<string, unknown> | undefined): string | undefined {
  const projectPath = context?.['projectPath'];
  if (typeof projectPath === 'string' && projectPath.trim().length > 0) {
    return projectPath.trim();
  }
  const executionCwd = context?.['executionCwd'];
  if (typeof executionCwd === 'string' && executionCwd.trim().length > 0) {
    return executionCwd.trim();
  }
  return undefined;
}

function trimTrailingSlash(value: string): string {
  return value.replace(/[\\/]+$/, '');
}

function isSuccessfulToolResultEvent(event: ArchitectureBranchStreamSnapshot['events'][number]): boolean {
  if (event.status === 'success') {
    return true;
  }
  return event.status !== 'failed' && event.status !== 'error';
}

function summarizeChildCliSessions(
  snapshot: ArchitectureBranchStreamSnapshot,
): NonNullable<ArchitectureToolEvidence['childCliSessions']> {
  const sessions = new Map<string, NonNullable<ArchitectureToolEvidence['childCliSessions']>[number]>();
  for (const event of snapshot.events) {
    if (!event.childSessionId || !isCliAgentStreamToolName(event.toolName)) {
      continue;
    }
    if (
      event.toolName === 'get_cli_agent_status'
      && !event.childStatus
      && !event.agentId
      && !event.workdir
    ) {
      continue;
    }
    const previous = sessions.get(event.childSessionId) ?? { childSessionId: event.childSessionId };
    sessions.set(event.childSessionId, {
      ...previous,
      agentId: event.agentId ?? previous.agentId,
      workdir: event.workdir ?? event.toolPath ?? previous.workdir,
      status: event.status ?? previous.status,
      ...(event.childStatus ? { status: event.childStatus } : {}),
    });
  }
  return [...sessions.values()];
}

function isCliAgentStreamToolName(toolName: string | undefined): boolean {
  return toolName === 'run_cli_agent'
    || toolName === 'spawn_cli_agent'
    || toolName === 'message_cli_agent'
    || toolName === 'get_cli_agent_status'
    || toolName === 'stop_cli_agent';
}

function isToolEvidence(value: unknown): value is ArchitectureToolEvidence {
  if (!isRecord(value)) {
    return false;
  }
  return typeof value['toolCallCount'] === 'number'
    && typeof value['toolResultCount'] === 'number'
    && Array.isArray(value['toolNames'])
    && Array.isArray(value['successfulToolNames'])
    && value['toolNames'].every((item) => typeof item === 'string')
    && value['successfulToolNames'].every((item) => typeof item === 'string')
    && (
      value['targetPaths'] === undefined
      || (Array.isArray(value['targetPaths']) && value['targetPaths'].every((item) => typeof item === 'string'))
    )
    && (
      value['childCliSessions'] === undefined
      || (Array.isArray(value['childCliSessions']) && value['childCliSessions'].every((item) => (
        isRecord(item)
        && typeof item['childSessionId'] === 'string'
        && (item['agentId'] === undefined || typeof item['agentId'] === 'string')
        && (item['workdir'] === undefined || typeof item['workdir'] === 'string')
        && (item['status'] === undefined || typeof item['status'] === 'string')
      )))
    );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function uniqueStrings(values: Array<string | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => typeof value === 'string' && value.length > 0))];
}
