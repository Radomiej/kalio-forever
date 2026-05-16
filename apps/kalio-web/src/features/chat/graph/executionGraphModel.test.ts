import { describe, expect, it } from 'vitest';
import type { ChatMessage, ChatSession } from '@kalio/types';
import type { ToolActivity } from '../../../store/agentStore';
import { buildTurnsFromHistory } from '../chatUtils';
import { buildExecutionGraphModel } from './executionGraphModel';

function makeMessage(overrides: Partial<ChatMessage>): ChatMessage {
  return {
    id: 'msg-1',
    sessionId: 'session-1',
    role: 'assistant',
    content: '',
    createdAt: 1,
    ...overrides,
  } as ChatMessage;
}

function makeSession(overrides: Partial<ChatSession> = {}): ChatSession {
  return {
    id: 'session-1',
    personaId: 'default',
    title: 'Main session',
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

describe('buildExecutionGraphModel', () => {
  it('builds prompt, turn, tool, subagent, artifact, and final-answer nodes for a subagent execution branch', () => {
    const subagentResult = {
      result: 'created wireframe and copied files',
      taskId: 'task-1',
      childSessionId: 'child-session-1',
      parentSessionId: 'session-1',
      vfsMode: 'isolated',
      vfsSessionId: 'child-session-1',
      copiedFiles: [
        { fromPath: 'wireframe.svg', toPath: 'sub-agents/child-session-1/wireframe.svg', sizeBytes: 128 },
      ],
      durationMs: 42,
    };

    const messages: ChatMessage[] = [
      makeMessage({ id: 'u1', role: 'user', content: 'Design a graph UI', createdAt: 1 }),
      makeMessage({
        id: 'a1',
        role: 'assistant',
        createdAt: 2,
        toolCalls: [{ id: 'call-subagent-1', name: 'run_subagent', args: { persona: 'UX Designer' } }],
      }),
      makeMessage({
        id: 'tr1',
        role: 'tool_result',
        toolCallId: 'call-subagent-1',
        content: JSON.stringify(subagentResult),
        createdAt: 3,
      }),
      makeMessage({ id: 'a2', role: 'assistant', content: 'Done. I prepared the first variant.', createdAt: 4 }),
    ];

    const turns = buildTurnsFromHistory(messages, 'session-1');
    const toolActivities: ToolActivity[] = [
      {
        callId: 'call-subagent-1',
        toolName: 'run_subagent',
        args: { persona: 'UX Designer' },
        sessionId: 'session-1',
        status: 'success',
        startedAt: 2,
        finishedAt: 3,
        result: {
          callId: 'call-subagent-1',
          status: 'success',
          data: subagentResult,
        },
      },
    ];

    const sessions: ChatSession[] = [
      makeSession(),
      makeSession({ id: 'child-session-1', title: 'UX Designer child', updatedAt: 5, kind: 'subagent' }),
    ];

    const model = buildExecutionGraphModel({
      sessionId: 'session-1',
      messages,
      turns,
      toolActivities,
      activeAgentLoops: {},
      sessions,
      sessionMessages: {
        'session-1': messages,
        'child-session-1': [
          makeMessage({ id: 'cu1', sessionId: 'child-session-1', role: 'user', content: 'Create wireframe', createdAt: 1 }),
          makeMessage({ id: 'ca1', sessionId: 'child-session-1', role: 'assistant', content: 'Working on the mockup', createdAt: 2 }),
        ],
      },
    });

    expect(model.nodes.map((node) => node.kind)).toEqual(expect.arrayContaining([
      'prompt',
      'turn',
      'tool',
      'subagent',
      'artifact',
      'final-answer',
    ]));

    expect(model.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({ sourceId: 'prompt:u1', targetId: expect.stringContaining('turn:') }),
      expect.objectContaining({ sourceId: expect.stringContaining('turn:'), targetId: 'tool:call-subagent-1' }),
      expect.objectContaining({ sourceId: 'tool:call-subagent-1', targetId: 'subagent:child-session-1' }),
      expect.objectContaining({ sourceId: 'subagent:child-session-1', targetId: 'artifact:sub-agents/child-session-1/wireframe.svg' }),
    ]));
  });
});