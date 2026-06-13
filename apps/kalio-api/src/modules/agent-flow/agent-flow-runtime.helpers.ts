import type {
  AgentFlowRun,
  AgentFlowRunSnapshot,
  AgentFlowTraceItem,
  ResumeAgentFlowRunDto,
  RunSubAgentFlowArgs,
  SubAgentFlowResult,
} from '@kalio/types';
import {
  blockExceededReturnToOrchestratorCap,
  reconcileContinuationSnapshot,
} from './agent-flow-runtime.continuation';

export {
  copyBackEventExists,
  markRuntimeMissing,
  reconcileContinuationSnapshot,
} from './agent-flow-runtime.continuation';

export function cloneTrace(events: AgentFlowTraceItem[] | undefined): AgentFlowTraceItem[] {
  return events ? events.map((item) => ({ ...item })) : [];
}

export function checkpointFromArgs(args: RunSubAgentFlowArgs): AgentFlowRun['checkpoint'] {
  return {
    goal: args.goal,
    context: args.context,
    vfsMode: args.vfsMode,
    copyBack: args.copyBack,
    maxSteps: args.maxSteps,
  };
}

export function createRunFromResult(args: RunSubAgentFlowArgs, result: SubAgentFlowResult): AgentFlowRun {
  return {
    id: result.flowRunId,
    parentSessionId: args.parentSessionId,
    parentToolCallId: args.parentToolCallId,
    childSessionId: result.childSessionId,
    openChatSessionId: result.openChatSessionId,
    openGraphRunId: result.openGraphRunId,
    flowDefinitionId: args.flowId,
    status: result.status,
    startMode: args.startMode ?? 'durable',
    returnMode: args.returnMode ?? 'summary',
    checkpoint: checkpointFromArgs(args),
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

export function argsFromRun(run: AgentFlowRun): RunSubAgentFlowArgs {
  return {
    flowId: run.flowDefinitionId,
    goal: run.checkpoint?.goal ?? `Resume AgentFlow run ${run.id}`,
    context: mergedRunContext(run),
    parentSessionId: run.parentSessionId,
    parentToolCallId: run.parentToolCallId,
    startMode: run.startMode,
    returnMode: run.returnMode,
    vfsMode: run.checkpoint?.vfsMode,
    copyBack: run.checkpoint?.copyBack,
    maxSteps: run.checkpoint?.maxSteps,
    continuation: run.checkpoint?.continuation,
  };
}

export function mergeResumeCheckpoint(
  run: AgentFlowRun,
  dto: ResumeAgentFlowRunDto,
): AgentFlowRun['checkpoint'] {
  return {
    ...(run.checkpoint ?? { goal: `Resume AgentFlow run ${run.id}` }),
    ...(dto.context !== undefined ? { resumeContext: { ...dto.context } } : {}),
    ...(dto.input !== undefined ? { lastResumeInput: dto.input } : {}),
    ...(dto.maxSteps !== undefined ? { maxSteps: dto.maxSteps } : {}),
  };
}

export function withCheckpoint(snapshot: AgentFlowRunSnapshot, args: RunSubAgentFlowArgs): AgentFlowRunSnapshot {
  return {
    ...snapshot,
    run: {
      ...snapshot.run,
      checkpoint: snapshot.run.checkpoint ?? checkpointFromArgs(args),
    },
  };
}

export function mergeRefreshedSnapshot(
  stored: AgentFlowRunSnapshot,
  refreshed: AgentFlowRunSnapshot,
): AgentFlowRunSnapshot {
  const run = preserveRunIdentity(stored.run, {
    ...stored.run,
    ...refreshed.run,
    maxIterations: refreshed.run.maxIterations ?? stored.run.maxIterations,
    returnToOrchestratorCount: refreshed.run.returnToOrchestratorCount ?? stored.run.returnToOrchestratorCount,
    checkpoint: mergeCheckpoint(refreshed.run.checkpoint, stored.run.checkpoint),
  });
  return blockExceededReturnToOrchestratorCap(reconcileContinuationSnapshot({
    ...stored,
    ...refreshed,
    run,
    events: normalizeTraceSequences([
      ...storedEventsForRefresh(stored.events, refreshed.events),
      ...refreshed.events.filter((event) => !stored.events.some((existing) => existing.id === event.id)),
    ]),
    result: mergedResult(stored.run, stored.result, refreshed),
  }));
}

export function createResumeEvent(runId: string, sequence: number, dto: ResumeAgentFlowRunDto): AgentFlowTraceItem {
  const message = dto.input?.trim()
    ? dto.input
    : 'Resume requested with no additional instructions.';
  return {
    id: `agent-flow:${runId}:event:${sequence}`,
    sequence,
    type: 'flow:resume_input',
    lifecycle: 'resume_input',
    message,
    status: 'running',
    createdAt: Date.now(),
  };
}

export function mergeRefreshedAfterResume(
  updated: AgentFlowRunSnapshot,
  refreshed: AgentFlowRunSnapshot,
): AgentFlowRunSnapshot {
  const run = preserveRunIdentity(updated.run, {
    ...refreshed.run,
    maxIterations: refreshed.run.maxIterations ?? updated.run.maxIterations,
    returnToOrchestratorCount: refreshed.run.returnToOrchestratorCount ?? updated.run.returnToOrchestratorCount,
    checkpoint: mergeCheckpoint(refreshed.run.checkpoint, updated.run.checkpoint),
  });
  return blockExceededReturnToOrchestratorCap(reconcileContinuationSnapshot({
    run,
    events: normalizeTraceSequences([
      ...storedEventsForRefresh(updated.events, refreshed.events),
      ...refreshed.events.filter((event) => !updated.events.some((existing) => existing.id === event.id)),
    ]),
    result: mergedResult(updated.run, updated.result, refreshed),
  }));
}

export function createResumeFailedEvent(runId: string, sequence: number, error: unknown): AgentFlowTraceItem {
  return {
    id: `agent-flow:${runId}:event:${sequence}:resume_failed`,
    sequence,
    type: 'flow:resume_failed',
    lifecycle: 'blocked',
    message: error instanceof Error ? error.message : 'AgentFlow resume failed.',
    data: { reasonCode: 'resume_failed' },
    status: 'blocked',
    createdAt: Date.now(),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function mergedRunContext(run: AgentFlowRun): RunSubAgentFlowArgs['context'] {
  const base = run.checkpoint?.context;
  const resume = run.checkpoint?.resumeContext;
  if (typeof base === 'string' && isRecord(resume)) {
    return { subAgentFlowContext: base, ...resume };
  }
  if (isRecord(base) && isRecord(resume)) {
    return { ...base, ...resume };
  }
  if (isRecord(base) && resume === undefined) {
    return { ...base };
  }
  return resume ?? base;
}

function mergeCheckpoint(
  base: AgentFlowRun['checkpoint'],
  override: AgentFlowRun['checkpoint'],
): AgentFlowRun['checkpoint'] {
  if (!base) return override;
  if (!override) return base;
  return {
    ...base,
    ...override,
    continuation: base.continuation,
  };
}

function preserveRunIdentity(
  base: AgentFlowRun,
  run: AgentFlowRun,
): AgentFlowRun {
  return {
    ...run,
    parentSessionId: base.parentSessionId,
    parentToolCallId: base.parentToolCallId,
    childSessionId: base.childSessionId,
    openChatSessionId: base.openChatSessionId,
    openGraphRunId: base.openGraphRunId,
    flowDefinitionId: base.flowDefinitionId,
    startMode: base.startMode,
    returnMode: base.returnMode,
  };
}

function preserveResultIdentity(
  baseRun: AgentFlowRun,
  result: SubAgentFlowResult,
): SubAgentFlowResult {
  return {
    ...result,
    parentSessionId: baseRun.parentSessionId,
    parentToolCallId: baseRun.parentToolCallId,
    childSessionId: baseRun.childSessionId,
    ...(baseRun.openChatSessionId ? { openChatSessionId: baseRun.openChatSessionId } : {}),
    ...(baseRun.openGraphRunId ? { openGraphRunId: baseRun.openGraphRunId } : {}),
  };
}

function mergedResult(
  baseRun: AgentFlowRun,
  storedResult: SubAgentFlowResult | undefined,
  refreshed: AgentFlowRunSnapshot,
): SubAgentFlowResult | undefined {
  if (refreshed.result) {
    return preserveResultIdentity(baseRun, refreshed.result);
  }
  if (storedResult && isTerminalRunStatus(refreshed.run.status)) {
    return preserveResultIdentity(baseRun, storedResult);
  }
  return undefined;
}

function isTerminalRunStatus(status: AgentFlowRun['status']): boolean {
  return status === 'done'
    || status === 'failed'
    || status === 'blocked'
    || status === 'cancelled';
}

function normalizeTraceSequences(events: AgentFlowTraceItem[]): AgentFlowTraceItem[] {
  return events.map((event, index) => ({
    ...event,
    sequence: index + 1,
  }));
}

function storedEventsForRefresh(
  storedEvents: AgentFlowTraceItem[],
  refreshedEvents: AgentFlowTraceItem[],
): AgentFlowTraceItem[] {
  const refreshedTypes = new Set(refreshedEvents.map((event) => event.type));
  return storedEvents.filter((event) => !isSyntheticBlockerEvent(event) || refreshedTypes.has(event.type));
}

function isSyntheticBlockerEvent(event: AgentFlowTraceItem): boolean {
  return event.type === 'flow:unresolved_cli_children';
}
