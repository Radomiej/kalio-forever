import { describe, expect, it } from 'vitest';
import type { AgentFlowRunSnapshot, AgentFlowRunStatus, RuntimeChildExecution } from '@kalio/types';
import {
  agentFlowRuntimeLabel,
  agentFlowRuntimeStatusLabel,
  mergeRuntimeChildExecutions,
  runtimeChildExecutionFromAgentFlowSnapshot,
} from './useExecutionGraphRuntimeSources';

function makeSnapshot(status: AgentFlowRunStatus, overrides: Partial<AgentFlowRunSnapshot['run']> = {}): AgentFlowRunSnapshot {
  return {
    run: {
      id: 'flow-1',
      parentSessionId: 'parent-session',
      childSessionId: 'child-session',
      flowDefinitionId: 'goal_guard_delivery_loop',
      status,
      startMode: 'durable',
      returnMode: 'summary',
      createdAt: 1,
      updatedAt: 2,
      ...overrides,
    },
    events: [],
  };
}

function makeExecution(overrides: Partial<RuntimeChildExecution> = {}): RuntimeChildExecution {
  return {
    id: 'execution-1',
    kind: 'agent_flow',
    parentSessionId: 'parent-session',
    childSessionId: 'child-session',
    flowRunId: 'flow-1',
    status: 'running',
    updatedAt: 1,
    ...overrides,
  };
}

describe('useExecutionGraphRuntimeSources mappings', () => {
  it('maps every AgentFlow status to the runtime execution status', () => {
    const expected = [
      ['queued', 'idle'],
      ['running', 'running'],
      ['done', 'completed'],
      ['failed', 'failed'],
      ['blocked', 'blocked'],
      ['cancelled', 'cancelled'],
      ['waiting_on_orchestrator', 'waiting'],
    ] as const;

    for (const [status, runtimeStatus] of expected) {
      expect(runtimeChildExecutionFromAgentFlowSnapshot(makeSnapshot(status)).status).toBe(runtimeStatus);
    }
  });

  it('prefers explicit graph/chat ids and preserves result output metadata', () => {
    const execution = runtimeChildExecutionFromAgentFlowSnapshot(makeSnapshot('done', {
      openChatSessionId: 'open-chat',
      openGraphRunId: 'open-graph',
      summary: 'run summary',
    }));

    expect(execution).toMatchObject({
      childSessionId: 'open-chat',
      flowRunId: 'open-graph',
      label: 'Goal Master Delivery Loop',
      lastOutput: 'run summary',
      updatedAt: 2,
    });

    expect(runtimeChildExecutionFromAgentFlowSnapshot(makeSnapshot('queued', {
      flowDefinitionId: 'custom_flow-name',
    })).label).toBe('Custom Flow Name');
  });

  it('formats labels and statuses with safe fallbacks', () => {
    expect(agentFlowRuntimeLabel(makeExecution({ label: '  Child flow  ' }))).toBe('Child flow');
    expect(agentFlowRuntimeLabel(makeExecution({ label: ' ' }), '  Fallback  ')).toBe('Fallback');
    expect(agentFlowRuntimeLabel(makeExecution())).toBe('Sub AgentFlow');

    expect(agentFlowRuntimeStatusLabel('completed')).toBe('completed');
    expect(agentFlowRuntimeStatusLabel('waiting')).toBe('waiting_on_orchestrator');
    expect(agentFlowRuntimeStatusLabel('stopped')).toBe('cancelled');
    expect(agentFlowRuntimeStatusLabel('running')).toBe('running');
  });

  it('deduplicates executions by call, flow, and child session keys with overrides winning', () => {
    const primary = [
      makeExecution({ id: 'call-old', childSessionId: 'c1', parentToolCallId: 'call-1' }),
      makeExecution({ id: 'flow-old', childSessionId: 'c2', flowRunId: 'flow-2' }),
      makeExecution({ id: 'session-old', kind: 'cli_agent', childSessionId: 'c3', flowRunId: undefined }),
    ];
    const overrides = [
      { ...primary[0], id: 'call-new', status: 'completed' as const },
      { ...primary[1], id: 'flow-new', status: 'failed' as const },
      { ...primary[2], id: 'session-new', status: 'waiting' as const },
    ];

    const merged = mergeRuntimeChildExecutions(primary, overrides);

    expect(merged).toHaveLength(3);
    expect(merged.map((execution) => execution.id)).toEqual(['call-new', 'flow-new', 'session-new']);
    expect(merged.map((execution) => execution.status)).toEqual(['completed', 'failed', 'waiting']);
  });
});
