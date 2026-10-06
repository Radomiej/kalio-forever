import { describe, expect, it } from 'vitest';
import type { AgentTurn } from '../../../store/sessionStore';
import { getTurnStatus, statusFromActivity, statusFromRuntimeChildExecution } from './executionGraphModel.helpers';
import { aggregateGraphStatus } from './executionGraphStatus';
import { buildArchitectureRootGraphModel } from './executionGraphArchitectureRoot';
import { buildExecutionGraphModel } from './executionGraphModel';
import type { ChatMessage } from '@kalio/types';

describe('execution graph intentional cancellation', () => {
  it('preserves a persisted cancelled Sub-AgentFlow without a live child snapshot', () => {
    const messages: ChatMessage[] = [
      { id: 'assistant', sessionId: 'session', role: 'assistant', content: '', createdAt: 1,
        toolCalls: [{ id: 'call', name: 'run_sub_agentflow', args: {} }] },
      { id: 'result', sessionId: 'session', role: 'tool_result', toolCallId: 'call', createdAt: 2,
        content: JSON.stringify({ flowRunId: 'flow', childSessionId: 'child', status: 'cancelled',
          summary: 'Stopped', decisions: [], nextActions: [], artifacts: [] }) },
    ];
    const model = buildExecutionGraphModel({ sessionId: 'session', messages,
      turns: [{ id: 'turn', sessionId: 'session', done: true, items: [{ kind: 'tool', callId: 'call' }] }],
      toolActivities: [], activeAgentLoops: {}, sessions: [], sessionMessages: {} });
    expect(model.nodes.find(node => node.id === 'agent-flow:flow')?.status).toBe('cancelled');
  });
  it('preserves cancelled architecture root nodes', () => {
    const model = buildArchitectureRootGraphModel({ graph: { runId: 'run',
      nodes: [{ id: 'worker', label: 'Worker', kind: 'role', status: 'cancelled', eventIds: [] }],
      edges: [], routeHops: [] }, rootSessionId: 'root', sessions: [], sessionMessages: {} });
    expect(model.nodes.find(node => node.id === 'architecture-root:worker')?.status).toBe('cancelled');
  });
  it.each(['error', 'waiting', 'running', 'success', 'idle'] as const)('aggregates cancelled with %s without hiding unfinished work or failure', (status) => {
    expect(aggregateGraphStatus([status, 'cancelled'])).toBe(
      status === 'success' || status === 'idle' ? 'cancelled' : status,
    );
  });
  it.each(['INTERRUPTED', 'CANCELLED'])('does not present %s as a failed turn', (code) => {
    const turn: AgentTurn = { id: 'turn', sessionId: 'session', done: true,
      items: [], error: { code, message: 'Stopped' } };
    expect(getTurnStatus(turn, new Map())).toBe('cancelled');
  });

  it('preserves persisted tool cancellation without requiring live activity', () => {
    expect(statusFromActivity(null, true, { status: 'cancelled' }, 'terminal_output')).toBe('cancelled');
  });

  it.each(['cancelled', 'stopped'] as const)('distinguishes a %s child from failure', (status) => {
    expect(statusFromRuntimeChildExecution(status)).toBe('cancelled');
  });

  it('keeps genuine turn and tool failures visible', () => {
    const turn: AgentTurn = { id: 'turn', sessionId: 'session', done: true,
      items: [], error: { code: 'LLM_ERROR', message: 'Host unavailable' } };
    expect(getTurnStatus(turn, new Map())).toBe('error');
    expect(statusFromActivity(null, true, { status: 'error' }, 'terminal_output')).toBe('error');
    expect(statusFromRuntimeChildExecution('failed')).toBe('error');
    expect(statusFromRuntimeChildExecution('blocked')).toBe('error');
  });
});
