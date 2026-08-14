import { Injectable } from '@nestjs/common';
import type {
  AgentFlowContinuationCursor,
  AgentFlowReturnMode,
  ArchitectureExecutionEvent,
  ArchitectureRun,
  AgentFlowRun,
  AgentFlowRunSnapshot,
  AgentFlowTraceItem,
  CreateArchitectureRunDto,
  ResumeAgentFlowRunDto,
  RunSubAgentFlowArgs,
  SubAgentFlowResult,
  WorkflowEvidence,
  WorkflowRuntimeDecision,
} from '@kalio/types';
import { ArchitectureRuntimeService } from '../architecture/architecture-runtime.service';
import { isCompletedCliChildStatus } from '../architecture/architecture-cli-child-status';
import type { AgentFlowRuntimePort } from './agent-flow-runtime.port';
import type { ArchitectureFinalArtifactStatus } from './architecture-final-artifact-status';
import {
  finalArtifactStatusFromData,
} from './architecture-final-artifact-status';
import { normalizeFlowEventType, normalizeFlowLifecycle, normalizeFlowStatus } from './agent-flow-trace-mapping';

const FLOW_SCHEMA_ALIASES: Record<string, string> = {
  goal_guard_delivery_loop: 'goal-master-delivery-loop',
};
const DEFAULT_LIVE_IDLE_TIMEOUT_MS = 5 * 60 * 1000;

function schemaIdForFlow(flowId: string): string {
  return FLOW_SCHEMA_ALIASES[flowId] ?? flowId;
}

function normalizeStatus(status: ArchitectureRun['status']): SubAgentFlowResult['status'] {
  if (status === 'completed') return 'done';
  if (status === 'failed') return 'failed';
  if (status === 'cancelled') return 'cancelled';
  return status;
}

function normalizeAgentFlowStatus(status: ArchitectureRun['status']): AgentFlowRun['status'] {
  if (status === 'completed') return 'done';
  if (status === 'failed') return 'failed';
  if (status === 'cancelled') return 'cancelled';
  if (status === 'queued') return 'queued';
  return 'running';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringField(record: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = record?.[key];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.length > 0)
    : [];
}

function numberRecord(value: unknown): Record<string, number> {
  if (!isRecord(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter((entry): entry is [string, number] => typeof entry[1] === 'number'),
  );
}

function normalizeReturnMode(returnMode: RunSubAgentFlowArgs['returnMode']): AgentFlowReturnMode {
  return returnMode ?? 'summary';
}

function normalizeContext(args: RunSubAgentFlowArgs): Record<string, unknown> | undefined {
  const base = typeof args.context === 'string'
    ? { subAgentFlowContext: args.context }
    : args.context;
  return {
    ...(base ?? {}),
    parentSessionId: args.parentSessionId,
    ...(args.parentToolCallId ? { parentToolCallId: args.parentToolCallId } : {}),
    subAgentFlow: {
      flowId: args.flowId,
      vfsMode: args.vfsMode ?? 'isolated',
      copyBack: args.copyBack ?? false,
      returnMode: normalizeReturnMode(args.returnMode),
      ...(args.maxSteps !== undefined ? { maxSteps: args.maxSteps } : {}),
    },
  };
}

function liveIdleTimeoutMs(args: RunSubAgentFlowArgs): number {
  const context = isRecord(args.context) ? args.context : undefined;
  const configured = context?.['maxArchitectureIdleMs'];
  return typeof configured === 'number' && Number.isFinite(configured) && configured > 0
    ? configured
    : DEFAULT_LIVE_IDLE_TIMEOUT_MS;
}

function normalizeResumeContext(args: RunSubAgentFlowArgs, dto: ResumeAgentFlowRunDto): Record<string, unknown> | undefined {
  const base = normalizeContext(args) ?? {};
  return {
    ...base,
    ...(dto.context ? { resumeContext: dto.context } : {}),
    ...(dto.input ? { resumeInput: dto.input } : {}),
    ...(args.continuation ? { subAgentFlowContinuation: args.continuation } : {}),
    ...(dto.maxSteps !== undefined ? { maxArchitectureSteps: dto.maxSteps } : {}),
    subAgentFlow: {
      ...(isRecord(base.subAgentFlow) ? base.subAgentFlow : {}),
      ...(dto.maxSteps !== undefined ? { maxSteps: dto.maxSteps } : {}),
      resume: true,
    },
  };
}

function toCreateRunDto(args: RunSubAgentFlowArgs): CreateArchitectureRunDto {
  return {
    schemaId: schemaIdForFlow(args.flowId),
    prompt: args.goal,
    executionMode: 'subagent_execution',
    context: normalizeContext(args),
  };
}

type ContinuableArchitectureRuntime = ArchitectureRuntimeService & {
  resumeRun?: (
    runId: string,
    dto: {
      input?: string;
      context?: Record<string, unknown>;
      maxSteps?: number;
      continuation?: AgentFlowContinuationCursor;
    },
  ) => Promise<ArchitectureRun>;
};

type LiveArchitectureRuntimeLookup = ArchitectureRuntimeService & {
  findRun?: (id: string) => ArchitectureRun | null;
};

function toFlowRunWithContinuation(
  args: RunSubAgentFlowArgs,
  architectureRun: ArchitectureRun,
  continuation: AgentFlowContinuationCursor | undefined,
  statusOverride?: AgentFlowRun['status'],
  summaryOverride?: string,
): AgentFlowRun {
  const status = statusOverride ?? normalizeAgentFlowStatus(architectureRun.status);
  const effectiveContinuation = continuation ?? (status === 'running' ? args.continuation : undefined);
  const effectiveStatus = (status === 'running' || status === 'failed') && effectiveContinuation
    ? 'waiting_on_orchestrator'
    : status;
  return {
    id: architectureRun.id,
    parentSessionId: args.parentSessionId,
    parentToolCallId: args.parentToolCallId,
    childSessionId: architectureRun.rootSessionId ?? `arch-${architectureRun.id}-root`,
    openChatSessionId: architectureRun.rootSessionId ?? `arch-${architectureRun.id}-root`,
    openGraphRunId: architectureRun.id,
    flowDefinitionId: args.flowId,
    status: effectiveStatus,
    startMode: args.startMode ?? 'durable',
    returnMode: normalizeReturnMode(args.returnMode),
    activeNodeIds: continuation?.pendingNodeIds,
    nodeVisitCounts: continuation?.visitCounts,
    waitingForNodeId: continuation?.waitingNodeId,
    summary: summaryOverride,
    checkpoint: {
      goal: args.goal,
      context: args.context,
      vfsMode: args.vfsMode,
      copyBack: args.copyBack,
      maxSteps: args.maxSteps,
      continuation: effectiveContinuation,
    },
    createdAt: architectureRun.createdAt,
    updatedAt: architectureRun.updatedAt,
  };
}

function mapTraceEvents(events: ArchitectureExecutionEvent[]): AgentFlowTraceItem[] {
  return events.map((event) => ({
    id: event.id,
    sequence: event.sequence,
    type: normalizeFlowEventType(event),
    lifecycle: normalizeFlowLifecycle(event),
    message: event.message,
    reasonCode: event.reasonCode,
    errorCode: event.errorCode,
    failure: event.failure,
    evidence: event.evidence,
    runtimeDecision: event.runtimeDecision,
    nodeId: event.nodeId,
    roleSlotId: event.roleSlotId,
    route: event.route,
    data: {
      ...(isRecord(event.data) ? event.data : {}),
      sourceEventType: event.type,
    },
    status: normalizeFlowStatus(event),
    createdAt: event.createdAt,
  }));
}

function traceProjection(
  returnMode: AgentFlowReturnMode,
  events: ArchitectureExecutionEvent[],
): SubAgentFlowResult['tracePreview'] {
  if (returnMode === 'artifacts_only') return undefined;
  const mapped = mapTraceEvents(events);
  return returnMode === 'full_trace' ? mapped : mapped.slice(-20);
}

function extractDecisions(events: ArchitectureExecutionEvent[]): string[] {
  return events
    .filter((event) => event.type === 'router_decision' || event.type === 'router_output')
    .map((event) => event.message)
    .filter((message) => message.trim().length > 0)
    .slice(-5);
}

function extractNextActions(
  status: SubAgentFlowResult['status'],
  events: ArchitectureExecutionEvent[],
  args?: RunSubAgentFlowArgs,
): string[] {
  if (status === 'blocked' && hasUnresolvedCliChildren(events, args)) {
    return ['Wait for linked CLI child agents to complete before accepting the AgentFlow result.'];
  }
  if (status === 'blocked' && hasBlockingFinalArtifact(events)) {
    return ['Resolve the blocker described in the final artifact before accepting the AgentFlow result.'];
  }
  if (status === 'done') return [];
  const lastMessage = events.at(-1)?.message;
  return lastMessage ? [lastMessage] : ['Inspect the child AgentFlow trace before retrying.'];
}

function isLegacyEmptyOutputPlaceholder(message: string | undefined): boolean {
  const normalized = message?.trim().toLowerCase();
  return !normalized
    || normalized === 'sub-agent completed with no output.'
    || normalized === 'sub-agent completed with no output';
}

function finalArtifactSummary(event: ArchitectureExecutionEvent): string | undefined {
  const structuredAnswer = stringField(event.data, 'finalArtifactAnswer');
  if (structuredAnswer) return structuredAnswer;
  // TODO: legacy fallback - older finalizer events sometimes persisted a display placeholder as message.
  return isLegacyEmptyOutputPlaceholder(event.message) ? undefined : event.message;
}

function findFinalArtifact(events: ArchitectureExecutionEvent[]): string | undefined {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event?.type === 'final_artifact') {
      return finalArtifactSummary(event);
    }
  }
  return undefined;
}

function findFinalArtifactEvent(events: ArchitectureExecutionEvent[]): ArchitectureExecutionEvent | undefined {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event?.type === 'final_artifact') {
      return event;
    }
  }
  return undefined;
}

function hasFinalArtifact(events: ArchitectureExecutionEvent[]): boolean {
  return events.some((event) => event.type === 'final_artifact');
}

function completedWithoutFinalArtifact(run: ArchitectureRun, events: ArchitectureExecutionEvent[]): boolean {
  return run.status === 'completed' && !hasFinalArtifact(events);
}

function latestAttemptEvents(events: ArchitectureExecutionEvent[]): ArchitectureExecutionEvent[] {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    if (events[index]?.type === 'run_created') {
      return events.slice(index);
    }
  }
  return events;
}

function hasBlockingFinalArtifact(events: ArchitectureExecutionEvent[]): boolean {
  const finalArtifact = findFinalArtifactEvent(events);
  const status = finalArtifactStatusFromData(finalArtifact?.data)
    ?? finalArtifactStatusFromEvidence(finalArtifact);
  return status === 'blocked' || status === 'rejected' || status === 'incomplete';
}

function finalArtifactStatusFromEvidence(
  event: ArchitectureExecutionEvent | undefined,
): ArchitectureFinalArtifactStatus | undefined {
  if (!event) return undefined;
  const evidence = eventEvidence(event).find((item) => item.kind === 'FINAL_ARTIFACT');
  if (!evidence) return undefined;
  if (evidence.status === 'passed') return 'accepted';
  if (evidence.status === 'blocked') return 'blocked';
  if (evidence.status === 'failed') return 'rejected';
  return 'incomplete';
}

function hasPassedExternalQualityGate(args: RunSubAgentFlowArgs | undefined): boolean {
  const context = isRecord(args?.context) ? args.context : undefined;
  const gate = isRecord(context?.['externalQualityGate']) ? context['externalQualityGate'] : undefined;
  return gate?.['status'] === 'passed';
}

function unresolvedCliChildSessions(events: ArchitectureExecutionEvent[], args?: RunSubAgentFlowArgs): string[] {
  const hasExternalGate = hasPassedExternalQualityGate(args);
  const unresolved: string[] = [];
  for (const [index, event] of events.entries()) {
    const toolEvidence = isRecord(event.data?.toolEvidence) ? event.data.toolEvidence : undefined;
    const childCliSessions = Array.isArray(toolEvidence?.['childCliSessions'])
      ? toolEvidence['childCliSessions']
      : [];
    for (const child of childCliSessions) {
      if (!isRecord(child)) continue;
      const childSessionId = typeof child['childSessionId'] === 'string'
        ? child['childSessionId']
        : 'unknown-cli-child';
      const status = typeof child['status'] === 'string' ? child['status'] : undefined;
      if (!isCompletedCliChildStatus(status)) {
        if (hasExternalGate || hasLaterIndependentHostVerification(events.slice(index + 1))) {
          continue;
        }
        unresolved.push(childSessionId);
      }
    }
  }
  return Array.from(new Set(unresolved));
}

function hasLaterIndependentHostVerification(events: ArchitectureExecutionEvent[]): boolean {
  let hasHostWrite = false;
  let hasBuildEvidence = false;

  for (const event of events) {
    hasHostWrite ||= hasTypedHostWriteEvidence(event);
    hasBuildEvidence ||= hasTypedBuildEvidence(event);
    if (hasTypedBuildAndGitEvidence(event)) return true;
    if (hasHostWrite && hasBuildEvidence) return true;

    if (
      event.type !== 'participant_output'
      && event.type !== 'router_decision'
      && event.type !== 'router_output'
      && event.type !== 'final_artifact'
    ) {
      const eventData = isRecord(event.data) ? event.data : undefined;
      const eventToolName = typeof eventData?.['toolName'] === 'string' ? eventData['toolName'] : undefined;
      const eventStatus = typeof eventData?.['status'] === 'string' ? eventData['status'] : undefined;
      if (event.type === 'tool_call' && eventStatus === 'success') {
        // TODO: legacy fallback - older events only persisted raw tool names, not WorkflowEvidence.
        hasHostWrite ||= eventToolName === 'fs_write'
          || eventToolName === 'vfs_write';
        hasBuildEvidence ||= eventToolName === 'terminal_spawn'
          || eventToolName === 'terminal_output';
      }
      if (hasHostWrite && hasBuildEvidence) return true;
      continue;
    }
    const toolEvidence = isRecord(event.data?.toolEvidence) ? event.data.toolEvidence : undefined;
    if (!toolEvidence) {
      continue;
    }
    const successfulToolNames = Array.isArray(toolEvidence['successfulToolNames'])
      ? toolEvidence['successfulToolNames'].filter((value): value is string => typeof value === 'string')
      : [];
    // TODO: legacy fallback - prefer WorkflowEvidence VFS_WRITE/BUILD_RESULT for new runtime events.
    hasHostWrite ||= successfulToolNames.some((name) => (
      name === 'fs_write'
      || name === 'vfs_write'
    ));
    hasBuildEvidence ||= successfulToolNames.some((name) => (
      name === 'terminal_spawn'
      || name === 'terminal_output'
    ));
    if (hasHostWrite && hasBuildEvidence) return true;
  }

  return false;
}

function eventEvidence(event: ArchitectureExecutionEvent): WorkflowEvidence[] {
  const dataEvidence = Array.isArray(event.data?.evidence)
    ? event.data.evidence.filter(isWorkflowEvidence)
    : [];
  return [
    ...(event.evidence ?? []),
    ...dataEvidence,
  ];
}

function eventRuntimeDecision(event: ArchitectureExecutionEvent): WorkflowRuntimeDecision | undefined {
  const dataDecision = isWorkflowRuntimeDecision(event.data?.runtimeDecision)
    ? event.data.runtimeDecision
    : undefined;
  return event.runtimeDecision ?? dataDecision;
}

function hasTypedBuildAndGitEvidence(event: ArchitectureExecutionEvent): boolean {
  return hasTypedBuildEvidence(event) && hasTypedGitEvidence(event);
}

function hasTypedBuildEvidence(event: ArchitectureExecutionEvent): boolean {
  return eventEvidence(event).some((item) => (
    item.kind === 'BUILD_RESULT'
    && item.status === 'passed'
    && (
      !isRecord(item.data)
      || item.data['exitCode'] === undefined
      || item.data['exitCode'] === 0
    )
  ));
}

function hasTypedGitEvidence(event: ArchitectureExecutionEvent): boolean {
  return eventEvidence(event).some((item) => item.kind === 'GIT_STATUS' && item.status === 'passed');
}

function hasTypedHostWriteEvidence(event: ArchitectureExecutionEvent): boolean {
  return eventEvidence(event).some((item) => item.kind === 'VFS_WRITE' && item.status === 'passed');
}

function hasTypedFinalizationAcceptance(event: ArchitectureExecutionEvent): boolean {
  if (
    event.type !== 'router_decision'
    && event.type !== 'router_output'
  ) {
    return false;
  }
  const decision = eventRuntimeDecision(event);
  const acceptsFinalArtifact = decision?.accepted === true
    && decision.reasonCode === 'final_artifact_accepted';
  return acceptsFinalArtifact && hasTypedBuildAndGitEvidence(event);
}

function isWorkflowEvidence(value: unknown): value is WorkflowEvidence {
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

function hasFinalizationMissingBlocker(
  events: ArchitectureExecutionEvent[],
  continuation: AgentFlowContinuationCursor | undefined,
): boolean {
  if (!continuation || hasFinalArtifact(events)) {
    return false;
  }
  const lastRuntimeFallback = [...events].reverse().find((event) => (
    event.route?.source === 'runtime_fallback'
  ));
  if (!lastRuntimeFallback) return false;
  return events.some((event) => event.createdAt <= lastRuntimeFallback.createdAt && hasTypedFinalizationAcceptance(event));
}

function hasUnresolvedCliChildren(events: ArchitectureExecutionEvent[], args?: RunSubAgentFlowArgs): boolean {
  return unresolvedCliChildSessions(events, args).length > 0;
}

function effectiveResultStatus(
  run: ArchitectureRun,
  events: ArchitectureExecutionEvent[],
  continuation: AgentFlowContinuationCursor | undefined,
  args?: RunSubAgentFlowArgs,
): SubAgentFlowResult['status'] {
  if (run.status === 'cancelled') return 'cancelled';
  if (hasFinalizationMissingBlocker(events, continuation)) return 'blocked';
  if ((hasFinalArtifact(events) || run.status === 'completed' || run.status === 'failed') && hasUnresolvedCliChildren(events, args)) return 'blocked';
  if (hasBlockingFinalArtifact(events)) return 'blocked';
  if (completedWithoutFinalArtifact(run, events)) return 'blocked';
  if (!continuation && hasFinalArtifact(events)) return 'done';
  const status = normalizeStatus(run.status);
  return status !== 'done' && continuation ? 'waiting_on_orchestrator' : status;
}

function effectiveRunStatus(
  run: ArchitectureRun,
  events: ArchitectureExecutionEvent[],
  continuation: AgentFlowContinuationCursor | undefined,
  args?: RunSubAgentFlowArgs,
): AgentFlowRun['status'] {
  if (run.status === 'cancelled') return 'cancelled';
  if (hasFinalizationMissingBlocker(events, continuation)) return 'blocked';
  if ((hasFinalArtifact(events) || run.status === 'completed' || run.status === 'failed') && hasUnresolvedCliChildren(events, args)) return 'blocked';
  if (hasBlockingFinalArtifact(events)) return 'blocked';
  if (completedWithoutFinalArtifact(run, events)) return 'blocked';
  if (!continuation && hasFinalArtifact(events)) return 'done';
  const status = normalizeAgentFlowStatus(run.status);
  return status !== 'done' && continuation ? 'waiting_on_orchestrator' : status;
}

function findVerifiedAcceptance(events: ArchitectureExecutionEvent[]): string | undefined {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (
      event
      && hasTypedFinalizationAcceptance(event)
    ) {
      return eventRuntimeDecision(event)?.message ?? event.message;
    }
    if (
      event?.type === 'router_decision'
      // TODO: legacy fallback - older Goal Master events had no runtimeDecision/evidence contract.
      && (event.roleSlotId === 'goal_master' || event.nodeId === 'goal-master')
      && event.route?.nextNodeId === 'final-artifact'
      && !isLegacyEmptyOutputPlaceholder(event.message)
    ) {
      return event.message;
    }
  }
  return undefined;
}

function summarizeCompletedFlow(args: RunSubAgentFlowArgs, status: SubAgentFlowResult['status'], events: ArchitectureExecutionEvent[]): string {
  if (status === 'cancelled') {
    for (let index = events.length - 1; index >= 0; index -= 1) {
      if (events[index]?.type === 'run_stopped') {
        return events[index].message;
      }
    }
    return `AgentFlow ${args.flowId} finished with status cancelled.`;
  }
  const finalArtifact = findFinalArtifact(events);
  if (finalArtifact !== undefined) {
    return finalArtifact;
  }
  const verifiedAcceptance = findVerifiedAcceptance(events);
  return verifiedAcceptance ?? finalArtifact ?? `AgentFlow ${args.flowId} finished with status ${status}.`;
}

function summarizeBlockedFlowResult(
  args: RunSubAgentFlowArgs,
  run: ArchitectureRun,
  events: ArchitectureExecutionEvent[],
  continuation: AgentFlowContinuationCursor | undefined,
): string {
  if (hasFinalizationMissingBlocker(events, continuation)) {
    return 'Blocked because Goal Master accepted finalization evidence, but the runtime could not produce the final artifact.';
  }
  const unresolvedChildren = unresolvedCliChildSessions(events, args);
  if (unresolvedChildren.length > 0) {
    return 'Blocked because linked CLI child agents are unresolved.';
  }
  if (hasBlockingFinalArtifact(events)) {
    return summarizeCompletedFlow(args, 'blocked', events);
  }
  if (completedWithoutFinalArtifact(run, events)) {
    return 'Blocked because the latest architecture attempt completed without a final artifact.';
  }
  return summarizeCompletedFlow(args, 'blocked', events);
}

function lastRouteEvent(events: ArchitectureExecutionEvent[]): ArchitectureExecutionEvent | undefined {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event?.route) return event;
  }
  return undefined;
}

function lastCompletedNodeId(events: ArchitectureExecutionEvent[]): string | undefined {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event?.type === 'node_completed' && event.nodeId) {
      return event.nodeId;
    }
  }
  return undefined;
}

function maxStepContinuation(events: ArchitectureExecutionEvent[]): AgentFlowContinuationCursor | undefined {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (
      (
        event?.type !== 'router_decision'
        && event?.type !== 'run_stopped'
      )
      || !isRecord(event.data)
    ) {
      continue;
    }
    const reasonCode = event.reasonCode ?? event.data.reasonCode;
    const pendingNodeIds = stringArray(event.data['pendingNodeIds']);
    const isReturnToOrchestrator = reasonCode === 'return_to_orchestrator';
    const isMaxStepContinuation = reasonCode === 'max_steps';
    const isRuntimePause = reasonCode === 'runtime_pause';
    if (pendingNodeIds.length === 0 || (!isMaxStepContinuation && !isReturnToOrchestrator && !isRuntimePause)) {
      continue;
    }
    if (index < events.length - 1) {
      continue;
    }
    const routeEvent = lastRouteEvent(events.slice(0, index + 1));
    const waitIdentity = isRecord(event.data['waitIdentity'])
      && typeof event.data['waitIdentity']['requestId'] === 'string'
      && typeof event.data['waitIdentity']['childSessionId'] === 'string'
      && typeof event.data['waitIdentity']['childTurnId'] === 'string'
      ? {
          requestId: event.data['waitIdentity']['requestId'],
          childSessionId: event.data['waitIdentity']['childSessionId'],
          childTurnId: event.data['waitIdentity']['childTurnId'],
          ...(typeof event.data['waitIdentity']['promptMessageId'] === 'string'
            ? { promptMessageId: event.data['waitIdentity']['promptMessageId'] }
            : {}),
        }
      : undefined;
    return {
      reason: isReturnToOrchestrator
        ? 'return_to_orchestrator'
        : isRuntimePause
          ? 'runtime_pause'
          : 'max_steps',
      waitingNodeId: pendingNodeIds[0],
      pendingNodeIds,
      visitCounts: numberRecord(event.data['visitCounts']),
      lastCompletedNodeId: lastCompletedNodeId(events.slice(0, index + 1)),
      lastRoute: routeEvent?.route
        ? {
            fromNodeId: routeEvent.route.fromNodeId,
            selectedNodeIds: [...routeEvent.route.selectedNodeIds],
            nextNodeId: routeEvent.route.nextNodeId,
            source: routeEvent.route.source,
            response: routeEvent.route.response,
          }
        : undefined,
      waitIdentity,
      message: event.message,
    };
  }
  return undefined;
}

function toResult(args: RunSubAgentFlowArgs, run: ArchitectureRun, events: ArchitectureExecutionEvent[]): SubAgentFlowResult {
  const statusEvents = latestAttemptEvents(events);
  const continuation = maxStepContinuation(statusEvents);
  const status = effectiveResultStatus(run, statusEvents, continuation, args);
  const returnToOrchestratorCount = continuation?.reason === 'return_to_orchestrator' ? 1 : undefined;
  const returnMode = normalizeReturnMode(args.returnMode);
  const summary = status === 'blocked'
    ? summarizeBlockedFlowResult(args, run, statusEvents, continuation)
    : summarizeCompletedFlow(args, status, statusEvents);
  return {
    flowRunId: run.id,
    flowDefinitionId: args.flowId,
    parentSessionId: args.parentSessionId,
    parentToolCallId: args.parentToolCallId,
    childSessionId: run.rootSessionId ?? `arch-${run.id}-root`,
    status,
    summary,
    decisions: returnMode === 'artifacts_only' ? [] : extractDecisions(events),
    nextActions: extractNextActions(status, statusEvents, args),
    artifacts: [],
    returnToOrchestratorCount,
    tracePreview: traceProjection(returnMode, events),
    openChatSessionId: run.rootSessionId ?? `arch-${run.id}-root`,
    openGraphRunId: run.id,
  };
}

function toSnapshot(args: RunSubAgentFlowArgs, run: ArchitectureRun, events: ArchitectureExecutionEvent[]): AgentFlowRunSnapshot {
  const statusEvents = latestAttemptEvents(events);
  const continuation = maxStepContinuation(statusEvents);
  const status = effectiveRunStatus(run, statusEvents, continuation, args);
  const unresolvedChildren = status === 'blocked' ? unresolvedCliChildSessions(statusEvents, args) : [];
  const finalArtifactBlocked = status === 'blocked' && hasBlockingFinalArtifact(statusEvents);
  const missingFinalArtifact = status === 'blocked' && completedWithoutFinalArtifact(run, statusEvents);
  const finalizationMissing = status === 'blocked' && hasFinalizationMissingBlocker(statusEvents, continuation);
  const summary = status === 'done' || status === 'failed' || status === 'cancelled'
    ? summarizeCompletedFlow(args, status, statusEvents)
    : finalizationMissing
      ? 'Blocked because Goal Master accepted finalization evidence, but the runtime could not produce the final artifact.'
    : status === 'blocked' && unresolvedChildren.length > 0
      ? 'Blocked because linked CLI child agents are unresolved.'
      : finalArtifactBlocked
        ? summarizeCompletedFlow(args, status, statusEvents)
        : missingFinalArtifact
          ? 'Blocked because the latest architecture attempt completed without a final artifact.'
      : undefined;
  const result = status === 'done' || status === 'failed' || status === 'cancelled' || (status === 'blocked' && (finalizationMissing || unresolvedChildren.length > 0 || finalArtifactBlocked || missingFinalArtifact))
    ? toResult(args, run, events)
    : undefined;
  const traceEvents = mapTraceEvents(events);
  const unresolvedEvent: AgentFlowTraceItem | undefined = unresolvedChildren.length > 0
    ? {
        id: `agent-flow:${run.id}:event:${traceEvents.length + 1}:unresolved_cli_children`,
        sequence: (traceEvents.at(-1)?.sequence ?? traceEvents.length) + 1,
        type: 'flow:unresolved_cli_children',
        lifecycle: 'blocked',
        message: `AgentFlow blocked because linked CLI child agents are unresolved: ${unresolvedChildren.join(', ')}.`,
        data: { reasonCode: 'unresolved_cli_children', childSessionIds: unresolvedChildren },
        status: 'blocked',
        createdAt: traceEvents.at(-1)?.createdAt ?? run.updatedAt,
      }
    : undefined;
  const finalArtifactBlockedEvent: AgentFlowTraceItem | undefined = finalArtifactBlocked
    ? {
        id: `agent-flow:${run.id}:event:${traceEvents.length + (unresolvedEvent ? 2 : 1)}:final_artifact_blocker`,
        sequence: (unresolvedEvent?.sequence ?? traceEvents.at(-1)?.sequence ?? traceEvents.length) + 1,
        type: 'flow:final_artifact_blocker',
        lifecycle: 'blocked',
        message: 'AgentFlow blocked because the final artifact declares unresolved acceptance blockers.',
        data: { reasonCode: 'final_artifact_blocker' },
        status: 'blocked',
        createdAt: traceEvents.at(-1)?.createdAt ?? run.updatedAt,
      }
    : undefined;
  const missingFinalArtifactEvent: AgentFlowTraceItem | undefined = missingFinalArtifact
    ? {
        id: `agent-flow:${run.id}:event:${traceEvents.length + (unresolvedEvent ? 2 : 1) + (finalArtifactBlockedEvent ? 1 : 0)}:missing_final_artifact`,
        sequence: (finalArtifactBlockedEvent?.sequence ?? unresolvedEvent?.sequence ?? traceEvents.at(-1)?.sequence ?? traceEvents.length) + 1,
        type: 'flow:missing_final_artifact',
        lifecycle: 'blocked',
        message: 'AgentFlow blocked because the latest architecture attempt completed without producing a final artifact.',
        data: { reasonCode: 'missing_final_artifact' },
        status: 'blocked',
        createdAt: traceEvents.at(-1)?.createdAt ?? run.updatedAt,
      }
    : undefined;
  const finalizationMissingEvent: AgentFlowTraceItem | undefined = finalizationMissing
    ? {
        id: `agent-flow:${run.id}:event:${traceEvents.length + (unresolvedEvent ? 2 : 1) + (finalArtifactBlockedEvent ? 1 : 0) + (missingFinalArtifactEvent ? 1 : 0)}:finalization_missing`,
        sequence: (missingFinalArtifactEvent?.sequence ?? finalArtifactBlockedEvent?.sequence ?? unresolvedEvent?.sequence ?? traceEvents.at(-1)?.sequence ?? traceEvents.length) + 1,
        type: 'flow:finalization_missing',
        lifecycle: 'blocked',
        message: 'AgentFlow blocked because Goal Master accepted finalization evidence, but the runtime could not produce the final artifact.',
        data: { reasonCode: 'finalization_missing' },
        status: 'blocked',
        createdAt: traceEvents.at(-1)?.createdAt ?? run.updatedAt,
      }
    : undefined;
  const projectedEvents = [
    ...traceEvents,
    ...(unresolvedEvent ? [unresolvedEvent] : []),
    ...(finalArtifactBlockedEvent ? [finalArtifactBlockedEvent] : []),
    ...(missingFinalArtifactEvent ? [missingFinalArtifactEvent] : []),
    ...(finalizationMissingEvent ? [finalizationMissingEvent] : []),
  ];
  return {
    run: toFlowRunWithContinuation(args, run, continuation, status, summary),
    events: projectedEvents,
    ...(result ? { result } : {}),
  };
}

function toRuntimeMissingEvent(snapshot: AgentFlowRunSnapshot): AgentFlowTraceItem {
  const lastCreatedAt = snapshot.events.at(-1)?.createdAt ?? snapshot.run.updatedAt;
  return {
    id: `agent-flow:${snapshot.run.id}:event:${snapshot.events.length + 1}`,
    sequence: snapshot.events.length + 1,
    type: 'flow:runtime_missing',
    lifecycle: 'runtime_missing',
    message: 'Architecture run was reconstructed from durable audit events, but no live runtime worker exists to continue it.',
    data: { reasonCode: 'runtime_missing' },
    status: 'blocked',
    createdAt: lastCreatedAt,
  };
}

function blockStaleLiveRunningSnapshot(
  args: RunSubAgentFlowArgs,
  snapshot: AgentFlowRunSnapshot,
  idleMs: number,
): AgentFlowRunSnapshot {
  const lastCreatedAt = snapshot.events.at(-1)?.createdAt ?? snapshot.run.updatedAt;
  const event: AgentFlowTraceItem = {
    id: `agent-flow:${snapshot.run.id}:event:${snapshot.events.length + 1}:runtime_stalled`,
    sequence: snapshot.events.length + 1,
    type: 'flow:runtime_stalled',
    lifecycle: 'runtime_stalled',
    message: `Architecture run made no observable progress for ${idleMs}ms and was stopped by the runtime watchdog.`,
    data: { reasonCode: 'runtime_stalled', idleMs },
    status: 'blocked',
    createdAt: Date.now(),
  };
  return {
    ...snapshot,
    run: {
      ...snapshot.run,
      status: 'blocked',
      summary: 'Blocked because the architecture runtime stopped making observable progress.',
      updatedAt: event.createdAt,
      finishedAt: event.createdAt,
    },
    result: {
      flowRunId: snapshot.run.id,
      parentSessionId: snapshot.run.parentSessionId,
      parentToolCallId: snapshot.run.parentToolCallId,
      childSessionId: snapshot.run.childSessionId,
      status: 'blocked',
      summary: `AgentFlow ${args.flowId} is blocked because the architecture runtime stopped making observable progress.`,
      decisions: [],
      nextActions: [
        `Inspect the child AgentFlow trace after event ${lastCreatedAt}; the runtime watchdog detected stale running state.`,
      ],
      artifacts: [],
      tracePreview: [
        ...snapshot.events.slice(-19),
        event,
      ],
      openChatSessionId: snapshot.run.openChatSessionId,
      openGraphRunId: snapshot.run.openGraphRunId,
    },
    events: [
      ...snapshot.events,
      event,
    ],
  };
}

function isStaleLiveRunningSnapshot(
  run: ArchitectureRun,
  snapshot: AgentFlowRunSnapshot,
  idleTimeoutMs: number,
): boolean {
  if (run.status !== 'running' || snapshot.run.status !== 'running' || snapshot.events.length === 0) {
    return false;
  }
  if (run.updatedAt < Date.UTC(2000, 0, 1)) {
    return false;
  }
  return Date.now() - run.updatedAt >= idleTimeoutMs;
}

function blockReconstructedRunningSnapshot(
  args: RunSubAgentFlowArgs,
  snapshot: AgentFlowRunSnapshot,
): AgentFlowRunSnapshot {
  if (snapshot.run.status === 'waiting_on_orchestrator') {
    return snapshot;
  }
  const event = toRuntimeMissingEvent(snapshot);
  return {
    ...snapshot,
    run: {
      ...snapshot.run,
      status: 'blocked',
      summary: 'Blocked because the architecture runtime worker is no longer live.',
      updatedAt: event.createdAt,
      finishedAt: event.createdAt,
    },
    result: {
      flowRunId: snapshot.run.id,
      parentSessionId: snapshot.run.parentSessionId,
      parentToolCallId: snapshot.run.parentToolCallId,
      childSessionId: snapshot.run.childSessionId,
      status: 'blocked',
      summary: `AgentFlow ${args.flowId} is blocked because its architecture runtime is no longer live.`,
      decisions: [],
      nextActions: [
        'Restart or resume the AgentFlow run from a durable checkpoint; do not treat the reconstructed running projection as active work.',
      ],
      artifacts: [],
      tracePreview: [
        ...snapshot.events.slice(-19),
        event,
      ],
      openChatSessionId: snapshot.run.openChatSessionId,
      openGraphRunId: snapshot.run.openGraphRunId,
    },
    events: [
      ...snapshot.events,
      event,
    ],
  };
}

@Injectable()
export class ArchitectureAgentFlowAdapter implements AgentFlowRuntimePort {
  constructor(private readonly architectureRuntime: ArchitectureRuntimeService) {}

  async start(args: RunSubAgentFlowArgs): Promise<AgentFlowRunSnapshot> {
    const run = await this.architectureRuntime.createRunAsync(toCreateRunDto(args));
    const events = this.architectureRuntime.getEvents(run.id);
    return toSnapshot(args, run, events);
  }

  async run(args: RunSubAgentFlowArgs): Promise<SubAgentFlowResult> {
    const run = args.startMode === 'blocking'
      ? await this.architectureRuntime.createRun(toCreateRunDto(args))
      : await this.architectureRuntime.createRunAsync(toCreateRunDto(args));
    const events = this.architectureRuntime.getEvents(run.id);
    return toResult(args, run, events);
  }

  async getSnapshot(runId: string, args: RunSubAgentFlowArgs): Promise<AgentFlowRunSnapshot | null> {
    const liveRun = (this.architectureRuntime as LiveArchitectureRuntimeLookup).findRun?.(runId) ?? null;
    const run = liveRun ?? await this.architectureRuntime.findRunDurable(runId);
    if (!run) return null;
    const events = await this.architectureRuntime.getEventsDurable(runId);
    const snapshot = toSnapshot(args, run, events);
    if (liveRun && isStaleLiveRunningSnapshot(liveRun, snapshot, liveIdleTimeoutMs(args))) {
      return blockStaleLiveRunningSnapshot(args, snapshot, liveIdleTimeoutMs(args));
    }
    return !liveRun && run.status === 'running'
      ? blockReconstructedRunningSnapshot(args, snapshot)
      : snapshot;
  }

  async resume(
    runId: string,
    dto: ResumeAgentFlowRunDto,
    args?: RunSubAgentFlowArgs,
  ): Promise<AgentFlowRunSnapshot> {
    const resolvedArgs = args ?? {
      flowId: 'goal_guard_delivery_loop',
      goal: `Resume AgentFlow run ${runId}`,
      parentSessionId: 'unknown',
    };
    const continuableRuntime = this.architectureRuntime as ContinuableArchitectureRuntime;
    if (!continuableRuntime.resumeRun) {
      const snapshot = await this.getSnapshot(runId, resolvedArgs);
      if (!snapshot) {
        throw new Error(`AGENT_FLOW_RUN_NOT_FOUND: ${runId}`);
      }
      return snapshot;
    }
    const run = await continuableRuntime.resumeRun(runId, {
      input: dto.input,
      maxSteps: dto.maxSteps,
      context: normalizeResumeContext(resolvedArgs, dto),
      continuation: resolvedArgs.continuation,
    });
    const events = await this.architectureRuntime.getEventsDurable(run.id);
    return toSnapshot(resolvedArgs, run, events);
  }

  async stop(runId: string, args?: RunSubAgentFlowArgs): Promise<AgentFlowRunSnapshot | null> {
    const run = await this.architectureRuntime.stopRun(runId);
    const events = await this.architectureRuntime.getEventsDurable(run.id);
    if (!args) {
      return null;
    }
    return toSnapshot(args, run, events);
  }
}
