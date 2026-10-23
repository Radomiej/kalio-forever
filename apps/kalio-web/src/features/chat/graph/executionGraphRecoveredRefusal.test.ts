import { describe, expect, it } from 'vitest';
import type { ChatMessage } from '@kalio/types';
import { buildExecutionGraphModel } from './executionGraphModel';

describe('completed turn after tool refusal', () => {
  it('keeps the refused tool cancelled without marking the completed response interrupted', () => {
    const messages: ChatMessage[] = [
      { id: 'assistant', sessionId: 'session', role: 'assistant', content: 'Write was refused.', createdAt: 1,
        toolCalls: [{ id: 'call', name: 'fs_write', args: { path: 'guard.txt', content: 'test' } }] },
      { id: 'result', sessionId: 'session', role: 'tool_result', toolCallId: 'call', createdAt: 2,
        content: JSON.stringify({ status: 'cancelled', errorMessage: 'Tool was not approved.' }) },
    ];
    const model = buildExecutionGraphModel({ sessionId: 'session', messages,
      turns: [{ id: 'turn', sessionId: 'session', done: true, items: [{ kind: 'tool', callId: 'call' }] }],
      toolActivities: [], activeAgentLoops: {}, sessions: [], sessionMessages: {} });
    expect(model.nodes.find(node => node.payload.kind === 'turn')?.status).toBe('success');
    expect(model.nodes.find(node => node.payload.kind === 'tool')?.status).toBe('cancelled');
  });
});
