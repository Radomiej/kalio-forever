import { describe, expect, it } from 'vitest';
import type { ChatMessage, ChatSession } from '@kalio/types';
import type { ToolActivity } from '../../store/agentStore';
import { buildAgentFlowPreviews } from './CanvasPanel.AgentFlows';

function message(overrides: Partial<ChatMessage>): ChatMessage {
  return {
    id: 'msg-1',
    sessionId: 'session-1',
    role: 'tool_result',
    toolCallId: 'tool-call-1',
    content: '',
    createdAt: 1,
    ...overrides,
  } as ChatMessage;
}

describe('buildAgentFlowPreviews', () => {
  it('keeps the newest AgentFlow conversation first so the latest waiting run stays visible', () => {
    const messages = [
      message({
        id: 'flow-msg-older',
        toolCallId: 'agentflow-call-older',
        content: JSON.stringify({
          flowRunId: 'flow-run-older',
          childSessionId: 'flow-child-older',
          openChatSessionId: 'flow-chat-older',
          openGraphRunId: 'flow-graph-older',
          status: 'waiting_on_orchestrator',
          summary: 'Older Goal Guard wait.',
          decisions: [],
          nextActions: [],
          artifacts: [],
        }),
        createdAt: 2,
      }),
      message({
        id: 'flow-msg-newer',
        toolCallId: 'agentflow-call-newer',
        content: JSON.stringify({
          flowRunId: 'flow-run-newer',
          childSessionId: 'flow-child-newer',
          openChatSessionId: 'flow-chat-newer',
          openGraphRunId: 'flow-graph-newer',
          status: 'waiting_on_orchestrator',
          summary: 'Newest Goal Guard wait.',
          decisions: [],
          nextActions: [],
          artifacts: [],
        }),
        createdAt: 3,
      }),
    ];
    const sessions: ChatSession[] = [
      {
        id: 'flow-chat-older',
        personaId: 'default',
        title: 'Older AgentFlow chat',
        kind: 'agent-flow',
        parentSessionId: 'session-1',
        createdAt: 2,
        updatedAt: 10,
      },
      {
        id: 'flow-chat-newer',
        personaId: 'default',
        title: 'Newest AgentFlow chat',
        kind: 'agent-flow',
        parentSessionId: 'session-1',
        createdAt: 3,
        updatedAt: 30,
      },
    ];

    const previews = buildAgentFlowPreviews(messages, [], sessions);

    expect(previews.map((preview) => preview.flowRunId)).toEqual([
      'flow-run-newer',
      'flow-run-older',
    ]);
  });

  it('ignores malformed history entries and only surfaces AgentFlow previews backed by real sessions', () => {
    const messages = [
      message({
        id: 'ignored-non-tool',
        role: 'assistant',
        content: 'plain assistant text',
      }),
      message({
        id: 'ignored-invalid-json',
        content: 'not-json',
      }),
      message({
        id: 'message-flow',
        content: JSON.stringify({
          flowRunId: 'flow-run-message',
          childSessionId: 'flow-child-message',
          status: 'waiting_on_orchestrator',
          summary: 'Message-derived flow.',
          decisions: [],
          nextActions: [],
          artifacts: [],
        }),
      }),
    ];
    const toolActivities: ToolActivity[] = [
      {
        callId: 'tool-flow-success',
        toolName: 'run_sub_agentflow',
        args: {},
        status: 'success',
        startedAt: 10,
        result: {
          callId: 'tool-flow-success',
          status: 'success',
          data: {
            flowRunId: 'flow-run-tool',
            childSessionId: 'flow-child-tool',
            openChatSessionId: 'flow-chat-tool',
            openGraphRunId: 'flow-graph-tool',
            status: 'done',
            summary: 'Tool-derived flow.',
            decisions: [],
            nextActions: [],
            artifacts: [],
          },
        },
      } as ToolActivity,
      {
        callId: 'tool-flow-failed',
        toolName: 'run_sub_agentflow',
        args: {},
        status: 'error',
        startedAt: 11,
        result: {
          callId: 'tool-flow-failed',
          status: 'error',
          data: {
            flowRunId: 'flow-run-ignored',
            childSessionId: 'flow-child-ignored',
            status: 'failed',
            summary: 'Ignored.',
            decisions: [],
            nextActions: [],
            artifacts: [],
          },
        },
      } as ToolActivity,
    ];
    const sessions: ChatSession[] = [
      {
        id: 'flow-chat-tool',
        personaId: 'default',
        title: 'Tool AgentFlow chat',
        kind: 'agent-flow',
        parentSessionId: 'session-1',
        createdAt: 10,
        updatedAt: 30,
      },
    ];

    const previews = buildAgentFlowPreviews(messages, toolActivities, sessions);

    expect(previews.map((preview) => preview.flowRunId)).toEqual(['flow-run-tool']);
    expect(previews[0]).toMatchObject({
      sessionId: 'flow-chat-tool',
      graphRunId: 'flow-graph-tool',
      title: 'Tool AgentFlow chat',
      updatedAt: 30,
    });
  });
});
