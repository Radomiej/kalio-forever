import type { AgentFlowRun, AgentFlowRunSnapshot, AgentFlowTraceItem } from '@kalio/types';

export function reconcileContinuationSnapshot(snapshot: AgentFlowRunSnapshot): AgentFlowRunSnapshot {
  const reconciled = {
    ...snapshot,
    run: reconcileContinuationRun(snapshot.run),
  };
  return appendWaitingEventIfNeeded(reconciled);
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
    lifecycle: continuation.reason === 'return_to_orchestrator' ? 'return_to_orchestrator' : 'waiting_on_orchestrator',
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
    lifecycle: 'runtime_missing',
    message: 'Underlying architecture runtime snapshot is no longer available; the durable AgentFlow run was blocked instead of staying running.',
    data: { reasonCode: 'runtime_missing' },
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

export function blockExceededReturnToOrchestratorCap(snapshot: AgentFlowRunSnapshot): AgentFlowRunSnapshot {
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
    lifecycle: 'blocked',
    message: `AgentFlow exceeded the return-to-orchestrator cap (${maxCount}).`,
    data: { reasonCode: 'return_to_orchestrator_cap_exceeded', maxCount },
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
