import { describe, expect, it } from 'vitest';
import type { ChatMessage } from '@kalio/types';
import { focusExecutionGraphMessages } from './executionGraphFocus';

function message(overrides: Partial<ChatMessage>): ChatMessage {
  return {
    id: 'm1',
    sessionId: 'session-1',
    role: 'assistant',
    content: '',
    createdAt: 1,
    ...overrides,
  } as ChatMessage;
}

describe('focusExecutionGraphMessages', () => {
  it('keeps only the latest architecture prompt block in latest mode', () => {
    const messages = [
      message({ id: 'u1', role: 'user', content: '[Architecture: Five Minds]\nfirst', createdAt: 1 }),
      message({ id: 'a1', role: 'assistant', toolCalls: [{ id: 'architecture:run-1:event-a', name: 'run_subagent', args: { architectureRunId: 'run-1' } }], createdAt: 2 }),
      message({ id: 'r1', role: 'tool_result', toolCallId: 'architecture:run-1:event-a', content: 'first result', createdAt: 3 }),
      message({ id: 'u2', role: 'user', content: '[Architecture: Five Minds]\nsecond', createdAt: 4 }),
      message({ id: 'a2', role: 'assistant', toolCalls: [{ id: 'architecture:run-2:event-a', name: 'run_subagent', args: { architectureRunId: 'run-2' } }], createdAt: 5 }),
      message({ id: 'r2', role: 'tool_result', toolCallId: 'architecture:run-2:event-a', content: 'second result', createdAt: 6 }),
    ];

    const focused = focusExecutionGraphMessages(messages, 'latest-architecture');

    expect(focused.architectureRunCount).toBe(2);
    expect(focused.latestArchitectureRunId).toBe('run-2');
    expect(focused.messages.map((item) => item.id)).toEqual(['u2', 'a2', 'r2']);
  });

  it('leaves a single architecture run untouched in latest mode and still reports its run id', () => {
    const messages = [
      message({ id: 'u1', role: 'user', content: '[Architecture: Goal Guard]\nfirst', createdAt: 1 }),
      message({
        id: 'a1',
        role: 'assistant',
        toolCalls: [{ id: 'architecture:run-3:event-a', name: 'run_subagent', args: { architectureRunId: 'run-3' } }],
        createdAt: 2,
      }),
      message({
        id: 'r1',
        role: 'tool_result',
        toolCallId: 'architecture:run-3:event-a',
        content: 'ready',
        createdAt: 3,
      }),
      message({ id: 'u2', role: 'user', content: 'Continue the same chat', createdAt: 4 }),
    ];

    const focused = focusExecutionGraphMessages(messages, 'latest-architecture');

    expect(focused.architectureRunCount).toBe(1);
    expect(focused.latestArchitectureRunId).toBe('run-3');
    expect(focused.messages).toBe(messages);
  });

  it('still extracts the latest architecture run id from structured result metadata when no prompt block exists', () => {
    const messages = [
      message({ id: 'u1', role: 'user', content: 'Resume the current chat', createdAt: 1 }),
      message({
        id: 'a1',
        role: 'assistant',
        content: 'Waiting on archived output.',
        createdAt: 2,
      }),
      message({
        id: 'r1',
        role: 'tool_result',
        toolCallId: 'architecture:run-9:event-1',
        architectureRun: {
          runId: 'run-9',
          schemaId: 'goal-guard',
          status: 'completed',
          trace: [],
          routeHops: [],
        },
        content: 'finished',
        createdAt: 3,
      }),
    ];

    const focused = focusExecutionGraphMessages(messages, 'latest-architecture');

    expect(focused.architectureRunCount).toBe(0);
    expect(focused.latestArchitectureRunId).toBe('run-9');
    expect(focused.messages).toBe(messages);
  });

  it('reads the latest architecture run id from typed tool call args even without a tool result', () => {
    const messages = [
      message({ id: 'u1', role: 'user', content: 'Inspect the branch', createdAt: 1 }),
      message({
        id: 'a1',
        role: 'assistant',
        toolCalls: [{ id: 'architecture:run-12:event-1', name: 'run_subagent', args: { architectureRunId: 'run-12' } }],
        createdAt: 2,
      }),
    ];

    const focused = focusExecutionGraphMessages(messages, 'latest-architecture');

    expect(focused.architectureRunCount).toBe(0);
    expect(focused.latestArchitectureRunId).toBe('run-12');
    expect(focused.messages).toBe(messages);
  });

  it('cuts the focused graph at the next user prompt after the latest architecture run', () => {
    const messages = [
      message({ id: 'u1', role: 'user', content: '[Architecture: Five Minds]\nfirst', createdAt: 1 }),
      message({ id: 'a1', role: 'assistant', toolCalls: [{ id: 'architecture:run-1:event-a', name: 'run_subagent', args: { architectureRunId: 'run-1' } }], createdAt: 2 }),
      message({ id: 'r1', role: 'tool_result', toolCallId: 'architecture:run-1:event-a', content: 'first result', createdAt: 3 }),
      message({ id: 'u2', role: 'user', content: 'Follow up before the next architecture run', createdAt: 4 }),
      message({ id: 'u3', role: 'user', content: '[Architecture: Goal Guard]\nsecond', createdAt: 5 }),
      message({ id: 'a2', role: 'assistant', toolCalls: [{ id: 'architecture:run-2:event-a', name: 'run_subagent', args: { architectureRunId: 'run-2' } }], createdAt: 6 }),
      message({ id: 'r2', role: 'tool_result', toolCallId: 'architecture:run-2:event-a', content: 'second result', createdAt: 7 }),
      message({ id: 'u4', role: 'user', content: 'Keep going', createdAt: 8 }),
    ];

    const focused = focusExecutionGraphMessages(messages, 'latest-architecture');

    expect(focused.architectureRunCount).toBe(2);
    expect(focused.latestArchitectureRunId).toBe('run-2');
    expect(focused.messages.map((item) => item.id)).toEqual(['u3', 'a2', 'r2']);
  });

  it('reads the latest architecture run id straight from architectureRun metadata', () => {
    const messages = [
      message({ id: 'u1', role: 'user', content: '[Architecture: Council]\nRun the branch', createdAt: 1 }),
      message({
        id: 'a1',
        role: 'assistant',
        architectureRun: {
          runId: 'run-10',
          schemaId: 'goal-guard',
          status: 'running',
          trace: [],
          routeHops: [],
        },
        createdAt: 2,
      }),
    ];

    const focused = focusExecutionGraphMessages(messages, 'latest-architecture');

    expect(focused.architectureRunCount).toBe(1);
    expect(focused.latestArchitectureRunId).toBe('run-10');
    expect(focused.messages).toBe(messages);
  });

  it('keeps all messages in all mode', () => {
    const messages = [
      message({ id: 'u1', role: 'user', content: '[Architecture: Five Minds]\nfirst' }),
      message({ id: 'a1', role: 'assistant', architectureRun: { runId: 'run-1', schemaId: 'five-minds', status: 'completed', trace: [], routeHops: [] } }),
    ];

    expect(focusExecutionGraphMessages(messages, 'all').messages).toBe(messages);
  });
});
