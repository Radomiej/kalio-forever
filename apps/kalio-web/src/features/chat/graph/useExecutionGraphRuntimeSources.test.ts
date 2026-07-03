import { describe, expect, it } from 'vitest';
import type { AgentFlowRunSnapshot, RuntimeChildExecution } from '@kalio/types';
import {
  mergeRuntimeChildExecutions,
  runtimeChildExecutionFromAgentFlowSnapshot,
} from './useExecutionGraphRuntimeSources';

function snapshot(overrides: Partial<AgentFlowRunSnapshot> = {}): AgentFlowRunSnapshot {
  return {
    run: {
      id: 'agent-flow-1',
      parentSessionId: 'parent-1',
      parentToolCallId: 'call-flow-1',
      childSessionId: 'child-1',
      openChatSessionId: 'child-1',
      openGraphRunId: 'goal-run-1',
      flowDefinitionId: 'goal_guard_delivery_loop',
      status: 'done',
      startMode: 'durable',
      returnMode: 'summary',
      createdAt: 1,
      updatedAt: 2,
      finishedAt: 2,
    },
    result: {
      flowRunId: 'agent-flow-1',
      flowDefinitionId: 'goal_guard_delivery_loop',
      parentSessionId: 'parent-1',
      parentToolCallId: 'call-flow-1',
      childSessionId: 'child-1',
      openChatSessionId: 'child-1',
      openGraphRunId: 'goal-run-1',
      status: 'done',
      summary: 'Final response produced.',
      decisions: [],
      nextActions: [],
      artifacts: [],
    },
    events: [],
    ...overrides,
  };
}

describe('Execution Graph AgentFlow runtime sources', () => {
  it('maps durable AgentFlow snapshots to typed child executions', () => {
    expect(runtimeChildExecutionFromAgentFlowSnapshot(snapshot())).toEqual({
      id: 'agent-flow-1',
      kind: 'agent_flow',
      parentSessionId: 'parent-1',
      childSessionId: 'child-1',
      parentToolCallId: 'call-flow-1',
      flowRunId: 'goal-run-1',
      label: 'Goal Master Delivery Loop',
      status: 'completed',
      lastOutput: 'Final response produced.',
      updatedAt: 2,
    });
  });

  it('lets durable AgentFlow snapshots override stale runtime child executions by parent tool call', () => {
    const stale: RuntimeChildExecution = {
      id: 'stale-flow',
      kind: 'agent_flow',
      parentSessionId: 'parent-1',
      childSessionId: 'child-1',
      parentToolCallId: 'call-flow-1',
      flowRunId: 'goal-run-1',
      label: 'Goal Guard',
      status: 'running',
      updatedAt: 1,
    };
    const durable = runtimeChildExecutionFromAgentFlowSnapshot(snapshot());

    expect(mergeRuntimeChildExecutions([stale], [durable])).toEqual([durable]);
  });
});
