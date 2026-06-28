import type { ChatMessage } from '@kalio/types';
import { describe, expect, it } from 'vitest';
import type { AgentTurn } from '../../store/sessionStore';
import { resolveWorkflowTurnProjection } from './workflowTurnProjection';

function message(overrides: Partial<ChatMessage>): ChatMessage {
  return {
    id: 'message-1',
    sessionId: 'session-1',
    role: 'assistant',
    content: '',
    createdAt: 1,
    ...overrides,
  } as ChatMessage;
}

function turn(overrides: Partial<AgentTurn>): AgentTurn {
  return {
    id: 'turn-1',
    sessionId: 'session-1',
    items: [],
    done: true,
    ...overrides,
  };
}

describe('resolveWorkflowTurnProjection', () => {
  it('correlates architecture tool results through typed tool args instead of toolCallId prefixes', () => {
    const messages = [
      message({
        id: 'assistant-tool-host',
        toolCalls: [{
          id: 'tool-1',
          name: 'run_subagent',
          args: { architectureRunId: 'run-1', childSessionId: 'branch-1' },
        }],
      }),
      message({
        id: 'tool-result-1',
        role: 'tool_result',
        toolCallId: 'tool-1',
        content: '{"ok":true}',
        createdAt: 2,
      }),
    ];

    const projection = resolveWorkflowTurnProjection(
      turn({ items: [{ kind: 'tool', callId: 'tool-1' }] }),
      messages,
      new Map([['tool-1', { architectureRunId: 'run-1', childSessionId: 'branch-1' }]]),
    );

    expect(projection.architectureRunId).toBe('run-1');
    expect(projection.architectureMessages.map((item) => item.id)).toEqual([
      'assistant-tool-host',
      'tool-result-1',
    ]);
    expect([...projection.branchSessionIds]).toEqual(['branch-1']);
  });
});
