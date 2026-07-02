import { describe, expect, it, vi } from 'vitest';
import type { ChatMessage } from '@kalio/types';
import type { AgentTurn } from '../../store/sessionStore';
import type { ArchitectRunResult } from '../architect/architect.types';
import { projectSubAgentFlowArchitectureResult } from './architectureAgentFlowProjection';

function message(overrides: Partial<ChatMessage>): ChatMessage {
  return {
    id: 'message-1',
    sessionId: 'host',
    role: 'assistant',
    content: '',
    createdAt: 1,
    ...overrides,
  } as ChatMessage;
}

function turn(overrides: Partial<AgentTurn>): AgentTurn {
  return {
    id: 'turn-1',
    sessionId: 'host',
    items: [],
    done: true,
    ...overrides,
  };
}

function runResult(runId: string): ArchitectRunResult {
  return {
    run: {
      id: runId,
      schemaId: 'strategic-decision-council',
      prompt: 'Second workflow prompt.',
      executionMode: 'subagent_execution',
      status: 'completed',
      createdAt: 10,
      updatedAt: 20,
      completedAt: 20,
    },
    events: [],
    graph: {
      runId,
      status: 'completed',
      nodes: [],
      edges: [],
      routeHops: [],
      childAgents: [],
    },
    chat: {
      runId,
      messages: [
        {
          id: 'chat-final',
          eventId: 'event-final',
          speaker: 'finalizer',
          roleSlotId: 'finalizer',
          content: 'Second workflow final answer.',
          createdAt: 20,
        },
      ],
    },
  };
}

describe('projectSubAgentFlowArchitectureResult', () => {
  it('turns a run_sub_agentflow tool result into a workflow envelope without removing the previous run', async () => {
    const messages: ChatMessage[] = [
      message({ id: 'user-1', role: 'user', content: 'First workflow prompt.', createdAt: 1 }),
      message({
        id: 'architecture:run-old:text:event-final',
        content: 'Old final.',
        createdAt: 2,
        architectureRun: {
          runId: 'run-old',
          schemaId: 'strategic-decision-council',
          status: 'completed',
          hostProjectionKind: 'workflow-envelope',
          trace: [],
          routeHops: [],
        },
      }),
      message({ id: 'user-2', role: 'user', content: 'Second workflow prompt.', createdAt: 3 }),
      message({
        id: 'assistant-tool-host',
        content: '',
        createdAt: 4,
        toolCalls: [{
          id: 'call-flow',
          name: 'run_sub_agentflow',
          args: { flowId: 'goal_guard_delivery_loop', goal: 'Second workflow prompt.' },
        }],
      }),
      message({
        id: 'tool-result-flow',
        role: 'tool_result',
        toolCallId: 'call-flow',
        content: '{}',
        createdAt: 5,
      }),
    ];
    const turns: AgentTurn[] = [
      turn({
        id: 'architecture-turn-run-old',
        promptMessageId: 'user-1',
        turnKind: 'workflow-envelope',
        items: [{ kind: 'text', messageId: 'architecture:run-old:text:event-final' }],
      }),
      turn({
        id: 'turn-second-live',
        promptMessageId: 'user-2',
        items: [
          { kind: 'tool', callId: 'call-flow' },
          { kind: 'text', messageId: 'tool-result-flow' },
        ],
        done: true,
      }),
    ];
    const setMessages = vi.fn((nextMessages: ChatMessage[]) => {
      messages.splice(0, messages.length, ...nextMessages);
    });
    const setAgentTurns = vi.fn((nextTurns: AgentTurn[]) => {
      turns.splice(0, turns.length, ...nextTurns);
    });

    const applied = await projectSubAgentFlowArchitectureResult({
      toolName: 'run_sub_agentflow',
      resultData: {
        flowRunId: 'flow-2',
        childSessionId: 'child-flow-2',
        status: 'done',
        summary: 'Done.',
        decisions: [],
        nextActions: [],
        artifacts: [],
        openGraphRunId: 'run-new',
      },
      resultSessionId: 'host',
      toolResultMessageId: 'tool-result-flow',
      fetchArchitectureRun: async () => runResult('run-new'),
      getSessionMessages: () => messages,
      getSessionAgentTurns: () => turns,
      getSessionActiveTurnId: () => null,
      setMessages,
      setAgentTurns,
    });

    expect(applied).toBe(true);
    expect(setMessages).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'architecture:run-old:text:event-final',
          architectureRun: expect.objectContaining({ runId: 'run-old' }),
        }),
        expect.objectContaining({
          architectureRun: expect.objectContaining({
            runId: 'run-new',
            hostProjectionKind: 'workflow-envelope',
          }),
        }),
      ]),
      'host',
    );
    expect(setAgentTurns).toHaveBeenCalledWith([
      expect.objectContaining({
        id: 'architecture-turn-run-old',
        turnKind: 'workflow-envelope',
      }),
      expect.objectContaining({
        id: 'architecture-turn-run-new',
        promptMessageId: 'user-2',
        turnKind: 'workflow-envelope',
      }),
    ], 'host');
  });
});
