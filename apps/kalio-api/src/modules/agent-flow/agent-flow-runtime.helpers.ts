import type {
  AgentFlowRun,
  AgentFlowRunSnapshot,
  AgentFlowTraceItem,
  ResumeAgentFlowRunDto,
  RunSubAgentFlowArgs,
  SubAgentFlowResult,
} from '@kalio/types';

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
    events: [
      ...stored.events,
      ...refreshed.events.filter((event) => !stored.events.some((existing) => existing.id === event.id)),
    ],
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
    events: [
      ...updated.events,
      ...refreshed.events.filter((event) => !updated.events.some((existing) => existing.id === event.id)),
    ],
    result: mergedResult(updated.run, updated.result, refreshed),
  }));
}

export function reconcileContinuationSnapshot(snapshot: AgentFlowRunSnapshot): AgentFlowRunSnapshot {
  const reconciled = {
    ...snapshot,
    run: reconcileContinuationRun(snapshot.run),
  };
  return appendWaitingEventIfNeeded(reconciled);
}

export function createResumeFailedEvent(runId: string, sequence: number, error: unknown): AgentFlowTraceItem {
  return {
    id: `agent-flow:${runId}:event:${sequence}:resume_failed`,
    sequence,
    type: 'flow:resume_failed',
    message: error instanceof Error ? error.message : 'AgentFlow resume failed.',
    status: 'blocked',
    createdAt: Date.now(),
  };
}

export function markRuntimeMissing(snapshot: AgentFlowRunSnapshot): AgentFlowRunSnapshot {
  if (snapshot.run.status !== 'running') {
    return snapshot;
  }
  if (snapshot.events.some((event) => event.type === 'flow:runtime_missing')) {
    return snapshot;
  }
  const now = Date.now();
  const event = createRuntimeMissingEvent(snapshot, now);
  return {
    ...snapshot,
    run: {
      ...snapshot.run,
      status: 'blocked',
      updatedAt: now,
      finishedAt: now,
      summary: snapshot.run.summary ?? 'Blocked because the underlying architecture runtime snapshot is no longer available.',
    },
    result: snapshot.result
      ? {
          ...snapshot.result,
          status: 'blocked',
          summary: snapshot.result.summary || 'Blocked because the underlying architecture runtime snapshot is no longer available.',
          nextActions: [
            ...snapshot.result.nextActions,
            'Restart or resume the AgentFlow run from the durable checkpoint instead of trusting the stale running projection.',
          ],
        }
      : undefined,
    events: [
      ...snapshot.events,
      event,
    ],
  };
}

export function copyBackEventExists(snapshot: AgentFlowRunSnapshot): boolean {
  return snapshot.events.some((event) => event.type === 'flow:copy_back');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function mergedRunContext(run: AgentFlowRun): RunSubAgentFlowArgs['context'] {
  const base = run.checkpoint?.context;
  const resume = run.checkpoint?.resumeContext;
  if (isRecord(base) && isRecord(resume)) {
    return { ...base, ...resume };
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

function reconcileContinuationRun(run: AgentFlowRun): AgentFlowRun {
  const continuation = run.checkpoint?.continuation;
  if (!continuation || run.status !== 'running') {
    return run;
  }
  const isReturnToOrchestrator = continuation.reason === 'return_to_orchestrator';
  return {
    ...run,
    status: 'waiting_on_orchestrator',
    activeNodeIds: run.activeNodeIds ?? continuation.pendingNodeIds,
    nodeVisitCounts: run.nodeVisitCounts ?? continuation.visitCounts,
    waitingForNodeId: run.waitingForNodeId ?? continuation.waitingNodeId,
    returnToOrchestratorCount: isReturnToOrchestrator
      ? run.returnToOrchestratorCount ?? 0
      : run.returnToOrchestratorCount,
  };
}

function appendWaitingEventIfNeeded(snapshot: AgentFlowRunSnapshot): AgentFlowRunSnapshot {
  const continuation = snapshot.run.checkpoint?.continuation;
  if (!continuation || snapshot.run.status !== 'waiting_on_orchestrator') {
    return snapshot;
  }
  const eventType = continuation.reason === 'return_to_orchestrator'
    ? 'flow:return_to_orchestrator'
    : 'flow:waiting_on_orchestrator';
  const lastEvent = snapshot.events.at(-1);
  if (eventType === 'flow:return_to_orchestrator' && lastEvent?.type === 'flow:resume_input') {
    const previousReturn = [...snapshot.events].reverse().find((event) => event.type === 'flow:return_to_orchestrator');
    if (previousReturn?.nodeId === continuation.waitingNodeId) {
      return snapshot;
    }
  }
  if (
    (eventType !== 'flow:return_to_orchestrator' && snapshot.events.some((event) => event.type === eventType))
    || (lastEvent?.type === eventType && lastEvent.nodeId === continuation.waitingNodeId)
  ) {
    return snapshot;
  }
  const nextEvent: AgentFlowTraceItem = {
    id: `agent-flow:${snapshot.run.id}:event:${snapshot.events.length + 1}:waiting`,
    sequence: (lastEvent?.sequence ?? snapshot.events.length) + 1,
    type: eventType,
    message: continuation.message ?? 'AgentFlow paused and is waiting for orchestrator input.',
    nodeId: continuation.waitingNodeId,
    status: 'waiting_on_orchestrator',
    createdAt: lastEvent?.createdAt ?? snapshot.run.updatedAt,
  };
  const nextEvents = [...snapshot.events, nextEvent];
  const returnToOrchestratorCount = eventType === 'flow:return_to_orchestrator'
    ? nextEvents.filter((event) => event.type === 'flow:return_to_orchestrator').length
    : snapshot.run.returnToOrchestratorCount;
  return {
    ...snapshot,
    run: {
      ...snapshot.run,
      ...(returnToOrchestratorCount !== undefined ? { returnToOrchestratorCount } : {}),
    },
    events: nextEvents,
  };
}

function createRuntimeMissingEvent(snapshot: AgentFlowRunSnapshot, now: number): AgentFlowTraceItem {
  return {
    id: `agent-flow:${snapshot.run.id}:event:${snapshot.events.length + 1}`,
    sequence: snapshot.events.length + 1,
    type: 'flow:runtime_missing',
    message: 'Underlying architecture runtime snapshot is no longer available; the durable AgentFlow run was blocked instead of staying running.',
    status: 'blocked',
    createdAt: now,
  };
}

function maxReturnToOrchestratorCount(run: AgentFlowRun): number {
  if (typeof run.maxIterations === 'number' && Number.isInteger(run.maxIterations) && run.maxIterations > 0) {
    return run.maxIterations;
  }
  const context = run.checkpoint?.context;
  if (isRecord(context)) {
    const configured = context['maxReturnToOrchestratorCount'];
    if (typeof configured === 'number' && Number.isInteger(configured) && configured > 0) {
      return configured;
    }
  }
  return 6;
}

function blockExceededReturnToOrchestratorCap(snapshot: AgentFlowRunSnapshot): AgentFlowRunSnapshot {
  const count = snapshot.run.returnToOrchestratorCount ?? 0;
  const maxCount = maxReturnToOrchestratorCount(snapshot.run);
  if (snapshot.run.status !== 'waiting_on_orchestrator' || count <= maxCount) {
    return snapshot;
  }
  const now = Date.now();
  const event: AgentFlowTraceItem = {
    id: `agent-flow:${snapshot.run.id}:event:${snapshot.events.length + 1}:loop_cap`,
    sequence: (snapshot.events.at(-1)?.sequence ?? snapshot.events.length) + 1,
    type: 'flow:return_to_orchestrator_cap_exceeded',
    message: `AgentFlow exceeded the return-to-orchestrator cap (${maxCount}).`,
    status: 'blocked',
    createdAt: now,
  };
  return {
    ...snapshot,
    run: {
      ...snapshot.run,
      status: 'blocked',
      summary: snapshot.run.summary ?? event.message,
      updatedAt: now,
      finishedAt: now,
    },
    result: snapshot.result
      ? {
          ...snapshot.result,
          status: 'blocked',
          summary: snapshot.result.summary || event.message,
          nextActions: [
            ...snapshot.result.nextActions,
            'Inspect the repeated Goal Guard handoffs before resuming or restarting this AgentFlow.',
          ],
        }
      : undefined,
    events: [...snapshot.events, event],
  };
}
