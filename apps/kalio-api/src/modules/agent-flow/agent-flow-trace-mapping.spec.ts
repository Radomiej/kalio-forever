import { describe, expect, it } from 'vitest';
import type { ArchitectureExecutionEvent } from '@kalio/types';
import { normalizeFlowEventType, normalizeFlowLifecycle, normalizeFlowStatus } from './agent-flow-trace-mapping';

function event(overrides: Partial<ArchitectureExecutionEvent>): ArchitectureExecutionEvent {
  return {
    id: 'event-1',
    runId: 'run-1',
    sequence: 1,
    type: 'router_decision',
    message: 'Display text only.',
    createdAt: 1,
    ...overrides,
  };
}

describe('agent-flow-trace-mapping', () => {
  it('maps renamed judge router results from typed slot metadata instead of magic ids', () => {
    const releaseGuardEvent = event({
      nodeId: 'release-gate',
      roleSlotId: 'release_guard',
      data: { slotType: 'judge' },
    });

    expect(normalizeFlowEventType(releaseGuardEvent)).toBe('flow:guard_result');
    expect(normalizeFlowLifecycle(releaseGuardEvent)).toBe('guard_result');
  });

  it('maps guard results from nested runtime decisions restored from durable data', () => {
    const durableEvent = event({
      nodeId: 'release-gate',
      roleSlotId: 'release_guard',
      data: {
        runtimeDecision: {
          status: 'done',
          reasonCode: 'final_artifact_accepted',
          accepted: true,
          nextNodeId: 'release-report',
        },
      },
    });

    expect(normalizeFlowEventType(durableEvent)).toBe('flow:guard_result');
    expect(normalizeFlowLifecycle(durableEvent)).toBe('guard_result');
  });

  it('does not project blocked final artifacts as done trace items', () => {
    const blockedFinalArtifact = event({
      type: 'final_artifact',
      nodeId: 'release-report',
      roleSlotId: 'finalizer',
      data: {
        finalArtifactStatus: 'blocked',
        blockingReason: 'Build evidence missing.',
      },
    });

    expect(normalizeFlowLifecycle(blockedFinalArtifact)).toBe('blocked');
    expect(normalizeFlowStatus(blockedFinalArtifact)).toBe('blocked');
  });

  it('maps max-step run stops to waiting instead of cancellation', () => {
    const stoppedForContinuation = event({
      type: 'run_stopped',
      message: 'Runtime stopped after 5 graph steps.',
      reasonCode: 'max_steps',
      data: {
        reasonCode: 'max_steps',
        pendingNodeIds: ['implementer'],
      },
    });

    expect(normalizeFlowLifecycle(stoppedForContinuation)).toBe('waiting_on_orchestrator');
    expect(normalizeFlowStatus(stoppedForContinuation)).toBe('waiting_on_orchestrator');
  });
});
