import { describe, expect, it } from 'vitest';
import type { ChatMessage, ChatSession, Persona } from '@kalio/types';
import type { ToolActivity } from '../../../store/agentStore';
import { buildTurnsFromHistory } from '../chatUtils';
import { buildExecutionGraphModel } from './executionGraphModel';
import { NODE_HEIGHT, ROW_GAP } from './executionGraphModel.helpers';
import { DEFAULT_TEST_PERSONA_AVATAR } from '../../../test/personaFixtures';

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

function makePersona(overrides: Partial<Persona> = {}): Persona {
  return {
    id: 'persona-1',
    name: 'RaBuilder',
    systemPrompt: 'You are a builder.',
    model: 'gpt-4.1',
    allowedTools: [],
    skillIds: [],
    mcpPolicy: 'deny_all',
    ...DEFAULT_TEST_PERSONA_AVATAR,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

describe('buildExecutionGraphModel', () => {
  it('renders workflow envelope turns without a Default agent node', () => {
    const messages: ChatMessage[] = [
      makeMessage({ id: 'u1', role: 'user', content: 'Run the council graph', createdAt: 1 }),
      makeMessage({
        id: 'a1',
        role: 'assistant',
        content: 'Architecture run running: strategic-decision-council',
        createdAt: 2,
        architectureRun: {
          runId: 'run-1',
          schemaId: 'strategic-decision-council',
          status: 'running',
          hostProjectionKind: 'workflow-envelope',
          trace: [],
          routeHops: [],
        },
      }),
    ];
    const turns = buildTurnsFromHistory(messages, 'session-1');

    const model = buildExecutionGraphModel({
      sessionId: 'session-1',
      messages,
      turns,
      toolActivities: [],
      activeAgentLoops: {},
      sessions: [makeSession()],
      sessionMessages: {
        'session-1': messages,
      },
      personas: [makePersona({ id: 'default', name: 'Default', model: 'mimo-v2.5' })],
    });

    expect(model.nodes.some((node) => node.kind === 'turn')).toBe(false);
    expect(model.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'architecture-run:a1',
        kind: 'architecture-run',
        column: 1,
        payload: expect.objectContaining({
          kind: 'architecture-run',
          summary: expect.objectContaining({ hostProjectionKind: 'workflow-envelope' }),
        }),
      }),
      expect.objectContaining({
        id: `final:${turns[0]?.id}`,
        kind: 'final-answer',
        column: 2,
        payload: expect.objectContaining({
          kind: 'final-answer',
          message: expect.objectContaining({ id: 'a1' }),
        }),
      }),
    ]));
    expect(model.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({ sourceId: 'prompt:u1', targetId: 'architecture-run:a1' }),
      expect.objectContaining({ sourceId: 'architecture-run:a1', targetId: `final:${turns[0]?.id}` }),
    ]));
  });

  it('falls back to a normal turn when a workflow-envelope turn has no architecture message', () => {
    const messages: ChatMessage[] = [
      makeMessage({ id: 'u1', role: 'user', content: 'Run the council graph', createdAt: 1 }),
      makeMessage({
        id: 'a1',
        role: 'assistant',
        content: 'Plain assistant answer',
        createdAt: 2,
      }),
    ];
    const turns = buildTurnsFromHistory(messages, 'session-1').map((turn) => ({
      ...turn,
      turnKind: 'workflow-envelope' as const,
    }));

    const model = buildExecutionGraphModel({
      sessionId: 'session-1',
      messages,
      turns,
      toolActivities: [],
      activeAgentLoops: {},
      sessions: [makeSession()],
      sessionMessages: {
        'session-1': messages,
      },
      personas: [makePersona({ id: 'default', name: 'Default', model: 'mimo-v2.5' })],
    });

    expect(model.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: `turn:${turns[0]?.id}`,
        kind: 'turn',
      }),
      expect.objectContaining({
        id: `final:${turns[0]?.id}`,
        kind: 'final-answer',
      }),
    ]));
  });

  it('does not render generic run_subagent tool nodes for workflow-envelope turns', () => {
    const messages: ChatMessage[] = [
      makeMessage({ id: 'u1', role: 'user', content: 'Run the council graph', createdAt: 1 }),
      makeMessage({
        id: 'a1',
        role: 'assistant',
        content: '',
        createdAt: 2,
        architectureRun: {
          runId: 'run-1',
          schemaId: 'strategic-decision-council',
          status: 'running',
          hostProjectionKind: 'workflow-envelope',
          trace: [
            {
              speaker: 'participant',
              content: 'Pragmatist answer',
              eventId: 'event-1',
              nodeId: 'pragmatist',
              nextNodeId: 'router',
              stream: {
                streamGroupId: 'run-1',
                branchSessionId: 'arch-run-1-pragmatist',
                status: 'completed',
                chunkCount: 2,
                text: 'Pragmatist answer',
              },
            },
          ],
          routeHops: [],
        },
        toolCalls: [{
          id: 'architecture:run-1:event-1',
          name: 'run_subagent',
          args: {
            architectureRunId: 'run-1',
            roleSlotId: 'pragmatist',
            childSessionId: 'arch-run-1-pragmatist',
          },
        }],
      }),
      makeMessage({
        id: 'r1',
        role: 'tool_result',
        toolCallId: 'architecture:run-1:event-1',
        content: JSON.stringify({
          taskId: 'event-1',
          childSessionId: 'arch-run-1-pragmatist',
          parentSessionId: 'session-1',
          vfsMode: 'shared',
          vfsSessionId: 'arch-run-1-root',
          copiedFiles: [],
          durationMs: 10,
          result: 'Pragmatist answer',
        }),
        createdAt: 3,
      }),
    ];
    const turns = buildTurnsFromHistory(messages, 'session-1');

    const model = buildExecutionGraphModel({
      sessionId: 'session-1',
      messages,
      turns,
      toolActivities: [],
      activeAgentLoops: {},
      sessions: [
        makeSession(),
        makeSession({ id: 'arch-run-1-pragmatist', title: 'Strategic Decision Council: Pragmatist', kind: 'subagent', parentSessionId: 'arch-run-1-root' }),
      ],
      sessionMessages: {
        'session-1': messages,
      },
      personas: [makePersona({ id: 'default', name: 'Default', model: 'mimo-v2.5' })],
    });

    expect(model.nodes.some((node) => node.id === 'tool:architecture:run-1:event-1')).toBe(false);
    expect(model.nodes.some((node) => node.id === 'subagent:arch-run-1-pragmatist')).toBe(false);
    expect(model.nodes.some((node) => node.id === 'architecture-run:a1')).toBe(true);
  });

  it('renders architecture run metadata as graph nodes and route hops', () => {
    const messages: ChatMessage[] = [
      makeMessage({ id: 'u1', role: 'user', content: 'Run the council graph', createdAt: 1 }),
      makeMessage({
        id: 'a1',
        role: 'assistant',
        content: 'Architecture run completed: strategic-decision-council',
        createdAt: 2,
        architectureRun: {
          runId: 'run-1',
          schemaId: 'strategic-decision-council',
          status: 'completed',
          finalArtifact: 'Final decision text',
          trace: [
            {
              speaker: 'participant',
              content: 'Agent response',
              nodeId: 'agent-1',
              nextNodeId: 'router-1',
            },
            {
              speaker: 'router',
              content: 'Router selected final',
              nodeId: 'router-1',
              nextNodeId: 'artifact',
            },
          ],
          routeHops: [
            {
              eventId: 'event-1',
              source: 'runtime_fallback',
              fromNodeId: 'agent-1',
              toNodeId: 'router-1',
            },
            {
              eventId: 'event-2',
              source: 'router',
              fromNodeId: 'router-1',
              toNodeId: 'artifact',
            },
          ],
        },
      }),
    ];
    const turns = buildTurnsFromHistory(messages, 'session-1');

    const model = buildExecutionGraphModel({
      sessionId: 'session-1',
      messages,
      turns,
      toolActivities: [],
      activeAgentLoops: {},
      sessions: [makeSession()],
      sessionMessages: {
        'session-1': messages,
      },
    });

    const architectureNodes = model.nodes.filter((node) => node.kind === 'architecture-run');
    expect(architectureNodes.map((node) => node.subtitle)).toEqual([
      'strategic-decision-council / completed',
      'Agent 1 -> Router 1',
      'Router 1 -> Artifact',
    ]);
    expect(architectureNodes.map((node) => ({ id: node.id, column: node.column, row: node.row }))).toEqual([
      { id: 'architecture-run:a1', column: 2, row: 0 },
      { id: 'architecture-route:a1:0', column: 3, row: 0 },
      { id: 'architecture-route:a1:1', column: 4, row: 0 },
    ]);
    expect(model.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({ sourceId: expect.stringContaining('turn:'), targetId: 'architecture-run:a1' }),
      expect.objectContaining({ sourceId: 'architecture-run:a1', targetId: 'architecture-route:a1:0' }),
      expect.objectContaining({ sourceId: 'architecture-route:a1:1', targetId: expect.stringContaining('final:') }),
    ]));
  });

  it('stacks parallel architecture route hops in one stage before continuing horizontally', () => {
    const messages: ChatMessage[] = [
      makeMessage({ id: 'u1', role: 'user', content: 'Run parallel architecture graph', createdAt: 1 }),
      makeMessage({
        id: 'a1',
        role: 'assistant',
        content: 'Architecture run completed: goal-master-delivery-loop',
        createdAt: 2,
        architectureRun: {
          runId: 'run-1',
          schemaId: 'goal-master-delivery-loop',
          status: 'completed',
          finalArtifact: 'Final decision text',
          trace: [
            { speaker: 'router', content: 'Dispatch branches', nodeId: 'router', nextNodeId: 'implementer' },
            { speaker: 'participant', content: 'Implementer output', nodeId: 'implementer', nextNodeId: 'router' },
            { speaker: 'participant', content: 'Verifier output', nodeId: 'verifier', nextNodeId: 'router' },
            { speaker: 'participant', content: 'Tester output', nodeId: 'tester', nextNodeId: 'router' },
            { speaker: 'router', content: 'Merge branches', nodeId: 'router', nextNodeId: 'final-artifact' },
          ],
          routeHops: [
            { eventId: 'event-router', source: 'router', fromNodeId: 'router', toNodeId: 'implementer' },
            { eventId: 'event-implementer', source: 'parallel', fromNodeId: 'implementer', toNodeId: 'router' },
            { eventId: 'event-verifier', source: 'parallel', fromNodeId: 'verifier', toNodeId: 'router' },
            { eventId: 'event-tester', source: 'parallel', fromNodeId: 'tester', toNodeId: 'router' },
            { eventId: 'event-merge', source: 'router', fromNodeId: 'router', toNodeId: 'final-artifact' },
          ],
        },
      }),
    ];
    const turns = buildTurnsFromHistory(messages, 'session-1');

    const model = buildExecutionGraphModel({
      sessionId: 'session-1',
      messages,
      turns,
      toolActivities: [],
      activeAgentLoops: {},
      sessions: [makeSession()],
      sessionMessages: {
        'session-1': messages,
      },
    });

    const byId = new Map(model.nodes.map((node) => [node.id, node]));
    const implementer = byId.get('architecture-route:a1:1');
    const verifier = byId.get('architecture-route:a1:2');
    const tester = byId.get('architecture-route:a1:3');
    const mergeRouter = byId.get('architecture-route:a1:4');

    expect(implementer?.column).toBe(verifier?.column);
    expect(verifier?.column).toBe(tester?.column);
    expect([implementer?.row, verifier?.row, tester?.row]).toEqual([0, 1, 2]);
    expect(mergeRouter?.column).toBe((tester?.column ?? 0) + 1);
    expect(mergeRouter?.row).toBe(0);
  });

  it('reconstructs architecture graph nodes from persisted run tool history after reload', () => {
    const messages: ChatMessage[] = [
      makeMessage({
        id: 'u1',
        role: 'user',
        content: '[Architecture: five-minds-council]\nReview the release workflow',
        createdAt: 1,
      }),
      makeMessage({
        id: 'a1',
        role: 'assistant',
        content: '',
        createdAt: 2,
        toolCalls: [{
          id: 'architecture:run-1:event-strategist',
          name: 'run_subagent',
          args: {
            architectureRunId: 'run-1',
            nodeId: 'strategist',
          },
        }],
      }),
      makeMessage({
        id: 'tr1',
        role: 'tool_result',
        toolCallId: 'architecture:run-1:event-strategist',
        content: JSON.stringify({
          result: 'Check graph readability before demo.',
          taskId: 'architecture:run-1:event:1',
          childSessionId: 'branch-strategist',
          parentSessionId: 'session-1',
          vfsMode: 'shared',
          vfsSessionId: 'session-1',
          copiedFiles: [],
          durationMs: 0,
        }),
        createdAt: 3,
      }),
      makeMessage({
        id: 'a2',
        role: 'assistant',
        content: '### Finalizer\n\nShip the smallest UX fix first.',
        createdAt: 4,
      }),
    ];
    const turns = buildTurnsFromHistory(messages, 'session-1');

    const model = buildExecutionGraphModel({
      sessionId: 'session-1',
      messages,
      turns,
      toolActivities: [],
      activeAgentLoops: {},
      sessions: [makeSession()],
      sessionMessages: {
        'session-1': messages,
      },
    });

    expect(model.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'architecture-run:a2',
        kind: 'architecture-run',
        title: 'Architecture run',
        status: 'running',
      }),
      expect.objectContaining({
        id: 'architecture-route:a2:0',
        subtitle: 'Strategist -> Router',
      }),
      expect.objectContaining({
        id: 'tool:architecture:run-1:event-strategist',
        title: 'Strategist branch',
        subtitle: 'Architecture branch',
      }),
    ]));
    expect(model.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({ sourceId: 'architecture-run:a2', targetId: 'architecture-route:a2:0' }),
      expect.objectContaining({ sourceId: 'architecture-route:a2:0', targetId: expect.stringContaining('final:') }),
    ]));
    expect(model.nodes.filter((node) => node.id.startsWith('architecture-run:'))).toHaveLength(1);
  });

  it('renders run_sub_agentflow results as durable child flow graph nodes', () => {
    const messages: ChatMessage[] = [
      makeMessage({ id: 'u1', role: 'user', content: 'Build the project with Goal Guard', createdAt: 1 }),
      makeMessage({
        id: 'a1',
        role: 'assistant',
        content: '',
        createdAt: 2,
        toolCalls: [{
          id: 'flow-call-1',
          name: 'run_sub_agentflow',
          args: {
            flowId: 'goal_guard_delivery_loop',
            goal: 'Build the project with Goal Guard',
          },
        }],
      }),
      makeMessage({
        id: 'tr1',
        role: 'tool_result',
        toolCallId: 'flow-call-1',
        content: JSON.stringify({
          flowRunId: 'flow-1',
          childSessionId: 'arch-flow-1-root',
          status: 'running',
          summary: 'Goal Guard flow started.',
          decisions: [],
          nextActions: ['Wait for evidence.'],
          artifacts: [],
          openChatSessionId: 'arch-flow-1-root',
          openGraphRunId: 'flow-1',
        }),
        createdAt: 3,
      }),
    ];
    const turns = buildTurnsFromHistory(messages, 'session-1');

    const model = buildExecutionGraphModel({
      sessionId: 'session-1',
      messages,
      turns,
      toolActivities: [],
      activeAgentLoops: {},
      sessions: [
        makeSession(),
        makeSession({ id: 'arch-flow-1-root', kind: 'agent-flow', title: 'Goal Guard flow' }),
      ],
      sessionMessages: {
        'session-1': messages,
        'arch-flow-1-root': [],
      },
    });

    expect(model.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'agent-flow:flow-1',
        kind: 'agent-flow',
        subtitle: 'flow-1 / running',
        sessionId: 'arch-flow-1-root',
        payload: expect.objectContaining({
          kind: 'agent-flow',
          graphRunId: 'flow-1',
          childSessionId: 'arch-flow-1-root',
        }),
      }),
    ]));
    expect(model.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({ sourceId: 'tool:flow-call-1', targetId: 'agent-flow:flow-1' }),
    ]));
  });

  it('does not render malformed run_sub_agentflow results as child flow nodes', () => {
    const messages: ChatMessage[] = [
      makeMessage({ id: 'u1', role: 'user', content: 'Build the project with Goal Guard', createdAt: 1 }),
      makeMessage({
        id: 'a1',
        role: 'assistant',
        content: '',
        createdAt: 2,
        toolCalls: [{
          id: 'flow-call-bad',
          name: 'run_sub_agentflow',
          args: {
            flowId: 'goal_guard_delivery_loop',
            goal: 'Build the project with Goal Guard',
          },
        }],
      }),
      makeMessage({
        id: 'tr1',
        role: 'tool_result',
        toolCallId: 'flow-call-bad',
        content: JSON.stringify({
          flowRunId: 'flow-bad',
          childSessionId: 'arch-flow-bad-root',
          status: 'running',
          summary: 'Malformed trace must not render.',
          decisions: [],
          nextActions: ['Wait for evidence.'],
          artifacts: [],
          tracePreview: [{
            id: 'bad-event',
            sequence: '1',
            type: 'architecture:router_decision',
            message: 'Bad sequence.',
            createdAt: 1,
          }],
        }),
        createdAt: 3,
      }),
    ];
    const turns = buildTurnsFromHistory(messages, 'session-1');

    const model = buildExecutionGraphModel({
      sessionId: 'session-1',
      messages,
      turns,
      toolActivities: [],
      activeAgentLoops: {},
      sessions: [makeSession()],
      sessionMessages: { 'session-1': messages },
    });

    expect(model.nodes.some((node) => node.id === 'agent-flow:flow-bad')).toBe(false);
  });

  it('labels repeated architecture route visits with visit indices', () => {
    const messages: ChatMessage[] = [
      makeMessage({ id: 'u1', role: 'user', content: 'Run the looping graph', createdAt: 1 }),
      makeMessage({
        id: 'a1',
        role: 'assistant',
        content: '### Finalizer\n\nDone',
        createdAt: 2,
        architectureRun: {
          runId: 'run-1',
          schemaId: 'looping-router-chain',
          status: 'completed',
          finalArtifact: 'Done',
          trace: [
            {
              speaker: 'participant',
              eventId: 'event-agent-1-first',
              content: 'Agent first pass',
              nodeId: 'agent-1',
              nextNodeId: 'router-1',
              visitIndex: 1,
            },
            {
              speaker: 'router',
              eventId: 'event-router-2-first',
              content: 'Router loops back',
              nodeId: 'router-2',
              nextNodeId: 'agent-1',
              visitIndex: 1,
            },
            {
              speaker: 'participant',
              eventId: 'event-agent-1-second',
              content: 'Agent second pass',
              nodeId: 'agent-1',
              nextNodeId: 'router-1',
              visitIndex: 2,
            },
          ],
          routeHops: [
            {
              eventId: 'event-agent-1-first',
              source: 'runtime_fallback',
              fromNodeId: 'agent-1',
              toNodeId: 'router-1',
            },
            {
              eventId: 'event-router-2-first',
              source: 'agent',
              fromNodeId: 'router-2',
              toNodeId: 'agent-1',
            },
            {
              eventId: 'event-agent-1-second',
              source: 'runtime_fallback',
              fromNodeId: 'agent-1',
              toNodeId: 'router-1',
            },
          ],
        },
      }),
    ];
    const turns = buildTurnsFromHistory(messages, 'session-1');

    const model = buildExecutionGraphModel({
      sessionId: 'session-1',
      messages,
      turns,
      toolActivities: [],
      activeAgentLoops: {},
      sessions: [makeSession()],
      sessionMessages: {
        'session-1': messages,
      },
    });

    expect(model.nodes
      .filter((node) => node.id.startsWith('architecture-route:'))
      .map((node) => node.subtitle)).toEqual([
      'Agent 1 #1 -> Router 1',
      'Router 2 #1 -> Agent 1',
      'Agent 1 #2 -> Router 1',
    ]);
  });

  it('surfaces architecture branch stream status on route graph nodes', () => {
    const messages: ChatMessage[] = [
      makeMessage({ id: 'u1', role: 'user', content: 'Run streamed architecture', createdAt: 1 }),
      makeMessage({
        id: 'a1',
        role: 'assistant',
        content: '### Pragmatist\n\nReal streamed response',
        createdAt: 2,
        architectureRun: {
          runId: 'run-1',
          schemaId: 'streamed-council',
          status: 'completed',
          trace: [
            {
              speaker: 'participant',
              eventId: 'event-agent',
              content: 'Real streamed response',
              nodeId: 'agent-1',
              nextNodeId: 'router',
              stream: {
                streamGroupId: 'architecture:run-1:agent-1',
                branchSessionId: 'branch-agent-1',
                status: 'completed',
                chunkCount: 2,
                text: 'Real streamed response',
              },
            },
          ],
          routeHops: [
            {
              eventId: 'event-agent',
              source: 'runtime_fallback',
              fromNodeId: 'agent-1',
              toNodeId: 'router',
            },
          ],
        },
      }),
    ];
    const turns = buildTurnsFromHistory(messages, 'session-1');

    const model = buildExecutionGraphModel({
      sessionId: 'session-1',
      messages,
      turns,
      toolActivities: [],
      activeAgentLoops: {},
      sessions: [makeSession()],
      sessionMessages: {
        'session-1': messages,
      },
    });

    const routeNode = model.nodes.find((node) => node.id === 'architecture-route:a1:0');

    expect(routeNode?.detail).toContain('Stream completed / 2 chunks');
    expect(routeNode?.detail).toContain('Branch completed its role-specific response.');
    expect(routeNode?.detail).not.toContain('branch-agent-1');
    expect(routeNode?.sessionId).toBe('branch-agent-1');
    expect(routeNode?.payload.kind === 'architecture-run' ? routeNode.payload.route?.branchSessionOpenable : null).toBe(true);
    expect(routeNode?.payload.kind === 'architecture-run' ? routeNode.payload.route?.branchSessionId : null).toBe('branch-agent-1');
  });

  it('falls back to architecture trace steps when route hops are not persisted yet', () => {
    const messages: ChatMessage[] = [
      makeMessage({ id: 'u1', role: 'user', content: 'Run partial architecture', createdAt: 1 }),
      makeMessage({
        id: 'a1',
        role: 'assistant',
        content: '### Router\n\nPartial result',
        createdAt: 2,
        architectureRun: {
          runId: 'run-1',
          schemaId: 'partial-council',
          status: 'running',
          trace: [
            {
              speaker: 'router',
              eventId: 'event-router',
              content: 'Router dispatched the branch',
              nodeId: 'router',
              nextNodeId: 'pragmatist',
            },
            {
              speaker: 'participant',
              eventId: 'event-pragmatist',
              content: 'Pragmatist is streaming',
              nodeId: 'pragmatist',
              nextNodeId: 'router',
            },
          ],
          routeHops: [],
        },
      }),
    ];
    const turns = buildTurnsFromHistory(messages, 'session-1');

    const model = buildExecutionGraphModel({
      sessionId: 'session-1',
      messages,
      turns,
      toolActivities: [],
      activeAgentLoops: {},
      sessions: [makeSession()],
      sessionMessages: {
        'session-1': messages,
      },
    });

    const routeNodes = model.nodes.filter((node) => node.id.startsWith('architecture-route:'));
    expect(routeNodes.map((node) => node.subtitle)).toEqual([
      'Router -> Pragmatist',
      'Pragmatist -> Router',
    ]);
    expect(routeNodes.map((node) => node.title)).toEqual(['Router', 'Pragmatist']);
    expect(model.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({ sourceId: 'architecture-run:a1', targetId: 'architecture-route:a1:0' }),
      expect.objectContaining({ sourceId: 'architecture-route:a1:0', targetId: 'architecture-route:a1:1' }),
    ]));
  });

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

  it('uses neutral turn naming and stacks multi-tool branches below the turn node', () => {
    const messages: ChatMessage[] = [
      makeMessage({ id: 'u1', role: 'user', content: 'Build a graph plan', createdAt: 1 }),
      makeMessage({
        id: 'a1',
        role: 'assistant',
        createdAt: 2,
        toolCalls: [
          { id: 'call-list-tools', name: 'list_tools', args: {} },
          { id: 'call-create-app', name: 'raapp_create', args: { mode: 'gui' } },
        ],
      }),
      makeMessage({
        id: 'tr1',
        role: 'tool_result',
        toolCallId: 'call-list-tools',
        content: JSON.stringify({ tools: ['vfs_read', 'run_subagent'] }),
        createdAt: 3,
      }),
      makeMessage({
        id: 'tr2',
        role: 'tool_result',
        toolCallId: 'call-create-app',
        content: JSON.stringify({ status: 'ready', type: 'gui', content: '<app />' }),
        createdAt: 4,
      }),
      makeMessage({ id: 'a2', role: 'assistant', content: 'Prepared a graph execution plan.', createdAt: 5 }),
    ];

    const turns = buildTurnsFromHistory(messages, 'session-1').map((turn) => ({
      ...turn,
      agentRun: {
        agentRunId: 'master-run-1',
        agentType: 'master' as const,
        label: 'RaBuilder',
      },
    }));

    const toolActivities: ToolActivity[] = [
      {
        callId: 'call-list-tools',
        toolName: 'list_tools',
        args: {},
        sessionId: 'session-1',
        status: 'success',
        startedAt: 2,
        finishedAt: 3,
        result: {
          callId: 'call-list-tools',
          status: 'success',
          data: { tools: ['vfs_read', 'run_subagent'] },
        },
      },
      {
        callId: 'call-create-app',
        toolName: 'raapp_create',
        args: { mode: 'gui' },
        sessionId: 'session-1',
        status: 'success',
        startedAt: 3,
        finishedAt: 4,
        result: {
          callId: 'call-create-app',
          status: 'success',
          data: { status: 'ready', type: 'gui', content: '<app />' },
        },
      },
    ];

    const model = buildExecutionGraphModel({
      sessionId: 'session-1',
      messages,
      turns,
      toolActivities,
      activeAgentLoops: {},
      sessions: [makeSession()],
      sessionMessages: {
        'session-1': messages,
      },
      collapseTools: false,
    });

    const turnNode = model.nodes.find((node) => node.kind === 'turn');
    const toolNodes = model.nodes.filter((node) => node.kind === 'tool');

    expect(turnNode?.title).toBe('Turn');
    expect(turnNode?.subtitle).toContain('RaBuilder');
    expect(toolNodes.length).toBe(2);
    expect(Math.min(...toolNodes.map((node) => node.row))).toBeGreaterThan(turnNode?.row ?? -1);
    expect(new Set(toolNodes.map((node) => node.column))).toEqual(new Set([turnNode?.column]));
    expect(toolNodes.map((node) => node.row)).toEqual([
      (turnNode?.row ?? 0) + 1,
      (turnNode?.row ?? 0) + 2,
    ]);
  });

  it('keeps thinking snippets on turn payloads for inspector drill-down', () => {
    const messages: ChatMessage[] = [
      makeMessage({ id: 'u1', role: 'user', content: 'Explain the flow', createdAt: 1 }),
      makeMessage({
        id: 'a1',
        role: 'assistant',
        content: 'The flow is ready.',
        thinking: 'I checked the current route before answering.',
        createdAt: 2,
      }),
    ];
    const turns = buildTurnsFromHistory(messages, 'session-1');

    const model = buildExecutionGraphModel({
      sessionId: 'session-1',
      messages,
      turns,
      toolActivities: [],
      activeAgentLoops: {},
      sessions: [makeSession()],
      sessionMessages: { 'session-1': messages },
    });

    const turnNode = model.nodes.find((node) => node.kind === 'turn');
    expect(turnNode?.payload.kind).toBe('turn');
    if (turnNode?.payload.kind === 'turn') {
      expect(turnNode.payload.thinkingCount).toBe(1);
      expect(turnNode.payload.thinkingPreviews).toEqual(['I checked the current route before answering.']);
    }
  });

  it('shows nested child turns and persona models below the subagent node', () => {
    const subagentResult = {
      result: 'designed the nested child flow',
      taskId: 'task-2',
      childSessionId: 'child-session-1',
      parentSessionId: 'session-1',
      vfsMode: 'isolated' as const,
      vfsSessionId: 'child-session-1',
      copiedFiles: [],
      durationMs: 30,
    };

    const rootMessages: ChatMessage[] = [
      makeMessage({ id: 'u1', role: 'user', content: 'Design nested graph orchestration', createdAt: 1 }),
      makeMessage({
        id: 'a1',
        role: 'assistant',
        createdAt: 2,
        toolCalls: [{
          id: 'call-subagent-1',
          name: 'run_subagent',
          args: {
            persona: 'UX Designer',
            inputPrompt: 'Explore layout options for the execution graph and keep the child flow readable.',
          },
        }],
      }),
      makeMessage({
        id: 'tr1',
        role: 'tool_result',
        toolCallId: 'call-subagent-1',
        content: JSON.stringify(subagentResult),
        createdAt: 3,
      }),
      makeMessage({ id: 'a2', role: 'assistant', content: 'Nested graph prepared.', createdAt: 4 }),
    ];

    const childMessages: ChatMessage[] = [
      makeMessage({ id: 'cu1', sessionId: 'child-session-1', role: 'user', content: 'Explore layout options', createdAt: 5 }),
      makeMessage({
        id: 'ca1',
        sessionId: 'child-session-1',
        role: 'assistant',
        createdAt: 6,
        toolCalls: [{ id: 'child-call-1', name: 'list_tools', args: {} }],
      }),
      makeMessage({
        id: 'ctr1',
        sessionId: 'child-session-1',
        role: 'tool_result',
        toolCallId: 'child-call-1',
        content: JSON.stringify({ tools: ['design_preview', 'raapp_create'] }),
        createdAt: 7,
      }),
      makeMessage({ id: 'ca2', sessionId: 'child-session-1', role: 'assistant', content: 'Nested branch finished.', createdAt: 8 }),
    ];

    const rootTurns = buildTurnsFromHistory(rootMessages, 'session-1');
    const childTurns = buildTurnsFromHistory(childMessages, 'child-session-1');

    const sessions: ChatSession[] = [
      makeSession({ id: 'session-1', personaId: 'persona-root', title: 'Main session' }),
      makeSession({ id: 'child-session-1', personaId: 'persona-child', title: 'UX child', kind: 'subagent' }),
    ];

    const toolActivities: ToolActivity[] = [
      {
        callId: 'call-subagent-1',
        toolName: 'run_subagent',
        args: {
          persona: 'UX Designer',
          inputPrompt: 'Explore layout options for the execution graph and keep the child flow readable.',
        },
        sessionId: 'session-1',
        status: 'success',
        startedAt: 2,
        finishedAt: 3,
        result: { callId: 'call-subagent-1', status: 'success', data: subagentResult },
      },
      {
        callId: 'child-call-1',
        toolName: 'list_tools',
        args: {},
        sessionId: 'child-session-1',
        status: 'success',
        startedAt: 6,
        finishedAt: 7,
        result: { callId: 'child-call-1', status: 'success', data: { tools: ['design_preview', 'raapp_create'] } },
      },
    ];

    const model = buildExecutionGraphModel({
      sessionId: 'session-1',
      messages: rootMessages,
      turns: rootTurns,
      toolActivities,
      activeAgentLoops: {},
      sessions,
      sessionMessages: {
        'session-1': rootMessages,
        'child-session-1': childMessages,
      },
      sessionAgentTurns: {
        'session-1': rootTurns,
        'child-session-1': childTurns,
      },
      personas: [
        makePersona({ id: 'persona-root', name: 'RaBuilder', model: 'gpt-4.1' }),
        makePersona({ id: 'persona-child', name: 'UX Designer', model: 'claude-sonnet-4.6' }),
      ],
    });

    const rootTurnNode = model.nodes.find((node) => node.id === `turn:${rootTurns[0]?.id}`);
    const subagentNode = model.nodes.find((node) => node.id === 'subagent:child-session-1');
    const childTurnNode = model.nodes.find((node) => node.id === `turn:${childTurns[0]?.id}`);

    expect(rootTurnNode?.subtitle).toContain('RaBuilder');
    expect(rootTurnNode?.subtitle).toContain('gpt-4.1');
    expect(subagentNode?.subtitle).toContain('UX Designer');
    expect(subagentNode?.subtitle).toContain('claude-sonnet-4.6');
    expect(subagentNode?.detail).toContain('Explore layout options for the execution graph');
    expect(childTurnNode?.subtitle).toContain('UX Designer');
    expect(childTurnNode?.subtitle).toContain('claude-sonnet-4.6');
    expect(childTurnNode?.row).toBe(subagentNode?.row);
    expect(childTurnNode?.column).toBe((subagentNode?.column ?? 0) + 1);
    expect(model.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({ sourceId: 'subagent:child-session-1', targetId: `turn:${childTurns[0]?.id}` }),
    ]));
  });

  it('renders cli-agent child sessions as dedicated graph nodes and marks them running when the child loop is active', () => {
    const cliAgentResult = {
      childSessionId: 'cli-child-1',
      parentSessionId: 'session-1',
      agentId: 'codex',
      workdir: 'C:/repo',
      status: 'running',
      lastPrompt: 'Inspect the repo and summarize the architecture',
      updatedAt: 8,
      startedAt: 6,
      activeCallId: 'cli-run-1',
      lastOutput: 'Scanning files...',
      output: 'Scanning files...',
      exitCode: 0,
      durationMs: 0,
    };

    const messages: ChatMessage[] = [
      makeMessage({ id: 'u1', role: 'user', content: 'Inspect the repository with Codex', createdAt: 1 }),
      makeMessage({
        id: 'a1',
        role: 'assistant',
        createdAt: 2,
        toolCalls: [{ id: 'call-cli-1', name: 'spawn_cli_agent', args: { agentId: 'codex', prompt: 'Inspect repo', workdir: 'C:/repo' } }],
      }),
      makeMessage({
        id: 'tr1',
        role: 'tool_result',
        toolCallId: 'call-cli-1',
        content: JSON.stringify(cliAgentResult),
        createdAt: 3,
      }),
      makeMessage({ id: 'a2', role: 'assistant', content: 'Codex is running in the child session.', createdAt: 4 }),
    ];

    const turns = buildTurnsFromHistory(messages, 'session-1');
    const toolActivities: ToolActivity[] = [
      {
        callId: 'call-cli-1',
        toolName: 'spawn_cli_agent',
        args: { agentId: 'codex', prompt: 'Inspect repo', workdir: 'C:/repo' },
        sessionId: 'session-1',
        status: 'success',
        startedAt: 2,
        finishedAt: 3,
        result: {
          callId: 'call-cli-1',
          status: 'success',
          data: cliAgentResult,
        },
      },
    ];

    const model = buildExecutionGraphModel({
      sessionId: 'session-1',
      messages,
      turns,
      toolActivities,
      activeAgentLoops: {
        'cli-run-1': {
          sessionId: 'cli-child-1',
          turnId: 'cli-turn-1',
          startedAt: 6,
        },
      },
      sessions: [
        makeSession(),
        makeSession({ id: 'cli-child-1', title: 'Codex CLI child', kind: 'cli-agent', parentSessionId: 'session-1', updatedAt: 8 }),
      ],
      sessionMessages: {
        'session-1': messages,
        'cli-child-1': [
          makeMessage({ id: 'cu1', sessionId: 'cli-child-1', role: 'user', content: 'Inspect repo', createdAt: 5 }),
          makeMessage({ id: 'ca1', sessionId: 'cli-child-1', role: 'assistant', content: '', toolCalls: [{ id: 'cli-run-1', name: 'run_cli_agent', args: { agentId: 'codex', workdir: 'C:/repo' } }], createdAt: 6 }),
        ],
      },
      sessionAgentTurns: {
        'session-1': turns,
        'cli-child-1': buildTurnsFromHistory([
          makeMessage({ id: 'cu1', sessionId: 'cli-child-1', role: 'user', content: 'Inspect repo', createdAt: 5 }),
          makeMessage({ id: 'ca1', sessionId: 'cli-child-1', role: 'assistant', content: '', toolCalls: [{ id: 'cli-run-1', name: 'run_cli_agent', args: { agentId: 'codex', workdir: 'C:/repo' } }], createdAt: 6 }),
        ], 'cli-child-1'),
      },
    });

    const cliNode = model.nodes.find((node) => node.id === 'cli-agent:cli-child-1');

    expect(cliNode).toMatchObject({
      kind: 'cli-agent',
      status: 'running',
      sessionId: 'cli-child-1',
    });
    expect(model.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({ sourceId: 'tool:call-cli-1', targetId: 'cli-agent:cli-child-1' }),
    ]));
  });

  it('renders main -> subagent -> nested subagent -> CLI-agent graph chain', () => {
    const outerSubagentResult = {
      result: 'Nested delegated to CLI',
      taskId: 'task-outer',
      childSessionId: 'sub-outer',
      parentSessionId: 'session-1',
      vfsMode: 'isolated' as const,
      vfsSessionId: 'sub-outer',
      copiedFiles: [],
      durationMs: 100,
    };
    const nestedSubagentResult = {
      result: 'CLI reported kalio-forever',
      taskId: 'task-nested',
      childSessionId: 'sub-nested',
      parentSessionId: 'sub-outer',
      vfsMode: 'isolated' as const,
      vfsSessionId: 'sub-nested',
      copiedFiles: [],
      durationMs: 80,
    };
    const cliAgentResult = {
      childSessionId: 'cli-child-1',
      parentSessionId: 'sub-nested',
      agentId: 'codex',
      workdir: 'C:/repo',
      status: 'completed',
      lastPrompt: 'Read package.json',
      updatedAt: 9,
      completedAt: 9,
      lastOutput: 'kalio-forever',
      output: 'kalio-forever',
      exitCode: 0,
      durationMs: 20,
    };
    const mainMessages: ChatMessage[] = [
      makeMessage({ id: 'u1', role: 'user', content: 'Delegate deeply', createdAt: 1 }),
      makeMessage({
        id: 'a1',
        role: 'assistant',
        toolCalls: [{ id: 'call-sub-outer', name: 'run_subagent', args: { objective: 'outer' } }],
        createdAt: 2,
      }),
      makeMessage({ id: 'tr1', role: 'tool_result', toolCallId: 'call-sub-outer', content: JSON.stringify(outerSubagentResult), createdAt: 3 }),
    ];
    const outerMessages: ChatMessage[] = [
      makeMessage({ id: 'ou1', sessionId: 'sub-outer', role: 'user', content: 'outer', createdAt: 4 }),
      makeMessage({
        id: 'oa1',
        sessionId: 'sub-outer',
        role: 'assistant',
        toolCalls: [{ id: 'call-sub-nested', name: 'run_subagent', args: { objective: 'nested' } }],
        createdAt: 5,
      }),
      makeMessage({ id: 'otr1', sessionId: 'sub-outer', role: 'tool_result', toolCallId: 'call-sub-nested', content: JSON.stringify(nestedSubagentResult), createdAt: 6 }),
    ];
    const nestedMessages: ChatMessage[] = [
      makeMessage({ id: 'nu1', sessionId: 'sub-nested', role: 'user', content: 'nested', createdAt: 7 }),
      makeMessage({
        id: 'na1',
        sessionId: 'sub-nested',
        role: 'assistant',
        toolCalls: [{ id: 'call-cli', name: 'run_cli_agent', args: { agentId: 'codex', workdir: 'C:/repo', prompt: 'Read package.json' } }],
        createdAt: 8,
      }),
      makeMessage({ id: 'ntr1', sessionId: 'sub-nested', role: 'tool_result', toolCallId: 'call-cli', content: JSON.stringify(cliAgentResult), createdAt: 9 }),
    ];
    const cliMessages: ChatMessage[] = [
      makeMessage({ id: 'cu1', sessionId: 'cli-child-1', role: 'user', content: 'Read package.json', createdAt: 10 }),
      makeMessage({
        id: 'ca1',
        sessionId: 'cli-child-1',
        role: 'assistant',
        toolCalls: [{ id: 'cli-run-1', name: 'run_cli_agent', args: { agentId: 'codex', workdir: 'C:/repo', prompt: 'Read package.json' } }],
        createdAt: 11,
      }),
      makeMessage({
        id: 'ctr1',
        sessionId: 'cli-child-1',
        role: 'tool_result',
        toolCallId: 'cli-run-1',
        content: JSON.stringify({ output: 'kalio-forever', exitCode: 0, durationMs: 20, agentId: 'codex', childSessionId: 'cli-child-1' }),
        createdAt: 12,
      }),
      makeMessage({ id: 'ca2', sessionId: 'cli-child-1', role: 'assistant', content: 'kalio-forever', createdAt: 13 }),
    ];
    const model = buildExecutionGraphModel({
      sessionId: 'session-1',
      messages: mainMessages,
      turns: buildTurnsFromHistory(mainMessages, 'session-1'),
      toolActivities: [],
      activeAgentLoops: {},
      sessions: [
        makeSession(),
        makeSession({ id: 'sub-outer', title: 'Outer subagent', kind: 'subagent', parentSessionId: 'session-1' }),
        makeSession({ id: 'sub-nested', title: 'Nested subagent', kind: 'subagent', parentSessionId: 'sub-outer' }),
        makeSession({ id: 'cli-child-1', title: 'Codex CLI', kind: 'cli-agent', parentSessionId: 'sub-nested' }),
      ],
      sessionMessages: {
        'session-1': mainMessages,
        'sub-outer': outerMessages,
        'sub-nested': nestedMessages,
        'cli-child-1': cliMessages,
      },
      sessionAgentTurns: {
        'session-1': buildTurnsFromHistory(mainMessages, 'session-1'),
        'sub-outer': buildTurnsFromHistory(outerMessages, 'sub-outer'),
        'sub-nested': buildTurnsFromHistory(nestedMessages, 'sub-nested'),
        'cli-child-1': buildTurnsFromHistory(cliMessages, 'cli-child-1'),
      },
    });

    expect(model.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'subagent:sub-outer', kind: 'subagent' }),
      expect.objectContaining({ id: 'subagent:sub-nested', kind: 'subagent' }),
      expect.objectContaining({
        id: 'cli-agent:cli-child-1',
        kind: 'cli-agent',
        status: 'success',
        detail: expect.stringContaining('kalio-forever'),
        payload: expect.objectContaining({
          transcript: expect.arrayContaining([
            expect.objectContaining({ role: 'assistant', content: 'kalio-forever' }),
          ]),
        }),
      }),
    ]));
    expect(model.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({ sourceId: 'tool:call-sub-outer', targetId: 'subagent:sub-outer' }),
      expect.objectContaining({ sourceId: 'tool:call-sub-nested', targetId: 'subagent:sub-nested' }),
      expect.objectContaining({ sourceId: 'tool:call-cli', targetId: 'cli-agent:cli-child-1' }),
      expect.objectContaining({ sourceId: 'cli-agent:cli-child-1', targetId: expect.stringMatching(/^turn:/) }),
    ]));
  });

  it('preserves shared child execution kind metadata for mixed delegated children', () => {
    const subagentResult = {
      result: 'sub-agent reviewed requirements',
      taskId: 'task-sub',
      childSessionId: 'sub-child-1',
      parentSessionId: 'session-1',
      vfsMode: 'isolated' as const,
      vfsSessionId: 'sub-child-1',
      copiedFiles: [],
      durationMs: 50,
    };
    const cliAgentResult = {
      childSessionId: 'cli-child-1',
      parentSessionId: 'session-1',
      agentId: 'codex',
      workdir: 'C:/repo',
      status: 'completed',
      lastPrompt: 'Inspect repo',
      updatedAt: 5,
      completedAt: 5,
      lastOutput: 'repo checked',
      output: 'repo checked',
      exitCode: 0,
      durationMs: 20,
    };
    const subAgentFlowResult = {
      flowRunId: 'flow-run-1',
      childSessionId: 'flow-child-1',
      openChatSessionId: 'flow-child-1',
      openGraphRunId: 'flow-run-1',
      status: 'done' as const,
      summary: 'Goal Guard accepted the flow.',
      decisions: ['accepted'],
      nextActions: [],
      artifacts: [],
    };
    const messages: ChatMessage[] = [
      makeMessage({ id: 'u1', role: 'user', content: 'Delegate across all child kinds', createdAt: 1 }),
      makeMessage({
        id: 'a1',
        role: 'assistant',
        createdAt: 2,
        toolCalls: [
          { id: 'call-sub', name: 'run_subagent', args: { inputPrompt: 'Review requirements' } },
          { id: 'call-cli', name: 'run_cli_agent', args: { agentId: 'codex', workdir: 'C:/repo', prompt: 'Inspect repo' } },
          { id: 'call-flow', name: 'run_sub_agentflow', args: { flowId: 'goal_guard_delivery_loop', goal: 'Verify delivery' } },
        ],
      }),
      makeMessage({ id: 'tr-sub', role: 'tool_result', toolCallId: 'call-sub', content: JSON.stringify(subagentResult), createdAt: 3 }),
      makeMessage({ id: 'tr-cli', role: 'tool_result', toolCallId: 'call-cli', content: JSON.stringify(cliAgentResult), createdAt: 4 }),
      makeMessage({ id: 'tr-flow', role: 'tool_result', toolCallId: 'call-flow', content: JSON.stringify(subAgentFlowResult), createdAt: 5 }),
    ];

    const model = buildExecutionGraphModel({
      sessionId: 'session-1',
      messages,
      turns: buildTurnsFromHistory(messages, 'session-1'),
      toolActivities: [],
      activeAgentLoops: {},
      sessions: [
        makeSession(),
        makeSession({ id: 'sub-child-1', title: 'Reviewer child', kind: 'subagent', parentSessionId: 'session-1' }),
        makeSession({ id: 'cli-child-1', title: 'Codex CLI', kind: 'cli-agent', parentSessionId: 'session-1' }),
        makeSession({ id: 'flow-child-1', title: 'Goal Guard flow', kind: 'agent-flow', parentSessionId: 'session-1' }),
      ],
      sessionMessages: {
        'session-1': messages,
        'sub-child-1': [],
        'cli-child-1': [],
        'flow-child-1': [],
      },
      collapseTools: false,
    });

    expect(model.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'subagent:sub-child-1',
        payload: expect.objectContaining({ childExecutionKind: 'sub_agent' }),
      }),
      expect.objectContaining({
        id: 'cli-agent:cli-child-1',
        payload: expect.objectContaining({ childExecutionKind: 'cli_agent' }),
      }),
      expect.objectContaining({
        id: 'agent-flow:flow-run-1',
        payload: expect.objectContaining({ childExecutionKind: 'sub_agentflow' }),
      }),
    ]));
  });

  it('renders runtime-only child execution placeholders before durable results arrive', () => {
    const messages: ChatMessage[] = [
      makeMessage({ id: 'u1', role: 'user', content: 'Delegate across all child kinds', createdAt: 1 }),
      makeMessage({
        id: 'a1',
        role: 'assistant',
        createdAt: 2,
        toolCalls: [
          { id: 'call-sub', name: 'run_subagent', args: { inputPrompt: 'Review requirements' } },
          { id: 'call-cli', name: 'run_cli_agent', args: { agentId: 'codex', workdir: 'C:/repo', prompt: 'Inspect repo' } },
          { id: 'call-flow', name: 'run_sub_agentflow', args: { flowId: 'goal_guard_delivery_loop', goal: 'Verify delivery' } },
        ],
      }),
    ];

    const model = buildExecutionGraphModel({
      sessionId: 'session-1',
      messages,
      turns: buildTurnsFromHistory(messages, 'session-1'),
      toolActivities: [
        { callId: 'call-sub', toolName: 'run_subagent', args: { inputPrompt: 'Review requirements' }, sessionId: 'session-1', status: 'running', startedAt: 2 },
        { callId: 'call-cli', toolName: 'run_cli_agent', args: { agentId: 'codex', workdir: 'C:/repo', prompt: 'Inspect repo' }, sessionId: 'session-1', status: 'running', startedAt: 2 },
        { callId: 'call-flow', toolName: 'run_sub_agentflow', args: { flowId: 'goal_guard_delivery_loop', goal: 'Verify delivery' }, sessionId: 'session-1', status: 'running', startedAt: 2 },
      ],
      activeAgentLoops: {},
      childExecutions: [
        {
          id: 'child-sub-1',
          kind: 'subagent',
          parentSessionId: 'session-1',
          childSessionId: 'sub-child-1',
          parentToolCallId: 'call-sub',
          label: 'Reviewer child',
          status: 'running',
          updatedAt: 3,
        },
        {
          id: 'child-cli-1',
          kind: 'cli_agent',
          parentSessionId: 'session-1',
          childSessionId: 'cli-child-1',
          parentToolCallId: 'call-cli',
          label: 'codex',
          status: 'running',
          lastOutput: 'Scanning repository...',
          updatedAt: 4,
        },
        {
          id: 'child-flow-1',
          kind: 'agent_flow',
          parentSessionId: 'session-1',
          childSessionId: 'flow-child-1',
          parentToolCallId: 'call-flow',
          flowRunId: 'flow-run-1',
          label: 'Goal Guard',
          status: 'waiting',
          updatedAt: 5,
        },
      ],
      sessions: [
        makeSession(),
        makeSession({ id: 'sub-child-1', title: 'Reviewer child', kind: 'subagent', parentSessionId: 'session-1' }),
        makeSession({ id: 'cli-child-1', title: 'Codex CLI', kind: 'cli-agent', parentSessionId: 'session-1' }),
        makeSession({ id: 'flow-child-1', title: 'Goal Guard flow', kind: 'agent-flow', parentSessionId: 'session-1' }),
      ],
      sessionMessages: {
        'session-1': messages,
        'sub-child-1': [],
        'cli-child-1': [],
        'flow-child-1': [],
      },
      collapseTools: false,
    });

    expect(model.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'subagent:sub-child-1',
        kind: 'subagent',
        status: 'running',
        payload: expect.objectContaining({ result: null, childExecutionKind: 'sub_agent' }),
      }),
      expect.objectContaining({
        id: 'cli-agent:cli-child-1',
        kind: 'cli-agent',
        status: 'running',
        payload: expect.objectContaining({
          childExecutionKind: 'cli_agent',
          snapshot: expect.objectContaining({ status: 'running', lastOutput: 'Scanning repository...' }),
        }),
      }),
      expect.objectContaining({
        id: 'agent-flow:flow-run-1',
        kind: 'agent-flow',
        status: 'waiting',
        payload: expect.objectContaining({ result: null, childExecutionKind: 'sub_agentflow' }),
      }),
    ]));
  });

  it('prefers runtime child execution terminal status over stale loop state for CLI children', () => {
    const cliAgentResult = {
      childSessionId: 'cli-child-1',
      parentSessionId: 'session-1',
      agentId: 'codex',
      workdir: 'C:/repo',
      status: 'running',
      lastPrompt: 'Inspect repo',
      updatedAt: 9,
      lastOutput: 'still running',
    };
    const messages: ChatMessage[] = [
      makeMessage({ id: 'u1', role: 'user', content: 'Inspect the repo', createdAt: 1 }),
      makeMessage({
        id: 'a1',
        role: 'assistant',
        createdAt: 2,
        toolCalls: [{ id: 'call-cli-1', name: 'spawn_cli_agent', args: { agentId: 'codex', workdir: 'C:/repo', prompt: 'Inspect repo' } }],
      }),
      makeMessage({
        id: 'tr1',
        role: 'tool_result',
        toolCallId: 'call-cli-1',
        content: JSON.stringify(cliAgentResult),
        createdAt: 3,
      }),
    ];

    const model = buildExecutionGraphModel({
      sessionId: 'session-1',
      messages,
      turns: buildTurnsFromHistory(messages, 'session-1'),
      toolActivities: [],
      activeAgentLoops: {
        'cli-loop-1': {
          sessionId: 'cli-child-1',
          turnId: 'cli-turn-1',
          startedAt: 4,
        },
      },
      childExecutions: [{
        id: 'child-cli-1',
        kind: 'cli_agent',
        parentSessionId: 'session-1',
        childSessionId: 'cli-child-1',
        parentToolCallId: 'call-cli-1',
        label: 'codex',
        status: 'completed',
        lastOutput: 'done',
        updatedAt: 5,
      }],
      sessions: [
        makeSession(),
        makeSession({ id: 'cli-child-1', title: 'Codex CLI', kind: 'cli-agent', parentSessionId: 'session-1' }),
      ],
      sessionMessages: {
        'session-1': messages,
        'cli-child-1': [],
      },
      collapseTools: false,
    });

    expect(model.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'cli-agent:cli-child-1',
        kind: 'cli-agent',
        status: 'success',
      }),
    ]));
  });

  it('marks awaiting-confirmation tools so the graph can render Accept actions', () => {
    const messages: ChatMessage[] = [
      makeMessage({ id: 'u1', role: 'user', content: 'Delete the draft file', createdAt: 1 }),
      makeMessage({
        id: 'a1',
        role: 'assistant',
        createdAt: 2,
        toolCalls: [{ id: 'call-delete-1', name: 'vfs_delete', args: { path: 'draft.txt' } }],
      }),
    ];

    const turns = buildTurnsFromHistory(messages, 'session-1');
    const model = buildExecutionGraphModel({
      sessionId: 'session-1',
      messages,
      turns,
      toolActivities: [
        {
          callId: 'call-delete-1',
          toolName: 'vfs_delete',
          args: { path: 'draft.txt' },
          sessionId: 'session-1',
          status: 'awaiting_confirmation',
          startedAt: 2,
        },
      ],
      activeAgentLoops: {},
      sessions: [makeSession()],
      sessionMessages: {
        'session-1': messages,
      },
      collapseTools: false,
    });

    const toolNode = model.nodes.find((node) => node.id === 'tool:call-delete-1');

    expect(toolNode?.subtitle).toBe('Awaiting confirmation');
    expect(toolNode?.status).toBe('waiting');
    expect(toolNode?.payload.kind).toBe('tool');
    expect(toolNode?.payload.kind === 'tool' ? toolNode.payload.confirmationRequired : false).toBe(true);
  });

  it('renders an explicit fallback node for malformed subagent results', () => {
    const messages: ChatMessage[] = [
      makeMessage({ id: 'u1', role: 'user', content: 'Delegate review', createdAt: 1 }),
      makeMessage({
        id: 'a1',
        role: 'assistant',
        createdAt: 2,
        toolCalls: [{ id: 'call-subagent-1', name: 'run_subagent', args: { inputPrompt: 'Review this' } }],
      }),
      makeMessage({
        id: 'tr1',
        role: 'tool_result',
        toolCallId: 'call-subagent-1',
        content: JSON.stringify({ status: 'done', text: 'Missing childSessionId shape' }),
        createdAt: 3,
      }),
    ];

    const model = buildExecutionGraphModel({
      sessionId: 'session-1',
      messages,
      turns: buildTurnsFromHistory(messages, 'session-1'),
      toolActivities: [],
      activeAgentLoops: {},
      sessions: [makeSession()],
      sessionMessages: { 'session-1': messages },
      collapseTools: false,
    });

    expect(model.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'tool-result:call-subagent-1',
        kind: 'tool-result',
        status: 'error',
        title: 'Unparsed child result',
      }),
    ]));
    expect(model.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({
        sourceId: 'tool:call-subagent-1',
        targetId: 'tool-result:call-subagent-1',
        style: 'dashed',
      }),
    ]));
  });

  it('places even a single tool below the turn so tool calls read as downward branches', () => {
    const messages: ChatMessage[] = [
      makeMessage({ id: 'u1', role: 'user', content: 'Delegate calculator build', createdAt: 1 }),
      makeMessage({
        id: 'a1',
        role: 'assistant',
        createdAt: 2,
        toolCalls: [{ id: 'call-subagent-1', name: 'run_subagent', args: { persona: 'RaBuilder' } }],
      }),
      makeMessage({
        id: 'tr1',
        role: 'tool_result',
        toolCallId: 'call-subagent-1',
        content: JSON.stringify({
          result: 'The calculator is built.',
          taskId: 'task-1',
          childSessionId: 'child-session-1',
          parentSessionId: 'session-1',
          vfsMode: 'isolated',
          vfsSessionId: 'child-session-1',
          copiedFiles: [],
          durationMs: 42,
        }),
        createdAt: 3,
      }),
    ];

    const turns = buildTurnsFromHistory(messages, 'session-1');
    const model = buildExecutionGraphModel({
      sessionId: 'session-1',
      messages,
      turns,
      toolActivities: [],
      activeAgentLoops: {},
      sessions: [makeSession(), makeSession({ id: 'child-session-1', title: 'Child session', kind: 'subagent' })],
      sessionMessages: {
        'session-1': messages,
      },
      collapseTools: false,
    });

    const turnNode = model.nodes.find((node) => node.kind === 'turn');
    const toolNode = model.nodes.find((node) => node.id === 'tool:call-subagent-1');

    expect(toolNode?.row).toBeGreaterThan(turnNode?.row ?? -1);
    expect(toolNode?.column).toBe(turnNode?.column);
  });

  it('uses rendered RAApp content so the node can show a live preview', () => {
    const messages: ChatMessage[] = [
      makeMessage({ id: 'u1', role: 'user', content: 'Build a calculator app', createdAt: 1 }),
      makeMessage({
        id: 'a1',
        role: 'assistant',
        createdAt: 2,
        toolCalls: [{ id: 'call-raapp-1', name: 'raapp_create', args: { mode: 'html' } }],
      }),
      makeMessage({
        id: 'tr1',
        role: 'tool_result',
        toolCallId: 'call-raapp-1',
        content: JSON.stringify({
          status: 'ready',
          type: 'html',
          renderedContent: '<main><h1>Calculator preview</h1></main>',
        }),
        createdAt: 3,
      }),
    ];

    const model = buildExecutionGraphModel({
      sessionId: 'session-1',
      messages,
      turns: buildTurnsFromHistory(messages, 'session-1'),
      toolActivities: [],
      activeAgentLoops: {},
      sessions: [makeSession()],
      sessionMessages: {
        'session-1': messages,
      },
      collapseTools: false,
    });

    const artifactNode = model.nodes.find((node) => node.kind === 'artifact' && node.payload.kind === 'artifact' && node.payload.artifact.kind === 'raapp');

    expect(artifactNode?.payload.kind).toBe('artifact');
    expect(artifactNode?.payload.kind === 'artifact' ? artifactNode.payload.artifact.preview : null).toContain('Calculator preview');
  });

  it('grows dense turn nodes and pushes lower tool rows below their actual rendered height', () => {
    const longReply = 'The calculator has a responsive shell, keyboard support, layered visual hierarchy, focus states, hover states, and a polished preview surface for each execution step. '.repeat(4);

    const messages: ChatMessage[] = [
      makeMessage({ id: 'u1', role: 'user', content: 'Build the calculator app', createdAt: 1 }),
      makeMessage({
        id: 'a1',
        role: 'assistant',
        createdAt: 2,
        toolCalls: [{ id: 'call-preview-1', name: 'design_preview', args: { filePath: 'calculator/index.html', mode: 'desktop' } }],
      }),
      makeMessage({
        id: 'tr1',
        role: 'tool_result',
        toolCallId: 'call-preview-1',
        content: JSON.stringify({ status: 'ready', type: 'html', renderedContent: '<main>Preview</main>' }),
        createdAt: 3,
      }),
      makeMessage({ id: 'a2', role: 'assistant', content: longReply, createdAt: 4 }),
    ];

    const model = buildExecutionGraphModel({
      sessionId: 'session-1',
      messages,
      turns: buildTurnsFromHistory(messages, 'session-1'),
      toolActivities: [],
      activeAgentLoops: {},
      sessions: [makeSession()],
      sessionMessages: {
        'session-1': messages,
      },
      collapseTools: false,
    });

    const turnNode = model.nodes.find((node) => node.kind === 'turn');
    const toolNode = model.nodes.find((node) => node.id === 'tool:call-preview-1');

    expect(turnNode?.height).toBeGreaterThan(NODE_HEIGHT);
    expect(toolNode?.y).toBeGreaterThanOrEqual((turnNode?.y ?? 0) + (turnNode?.height ?? 0) + ROW_GAP);
  });

  it('places the final response on the right as the chat outcome without dashed links from tools', () => {
    const messages: ChatMessage[] = [
      makeMessage({ id: 'u1', role: 'user', content: 'Build a calculator app', createdAt: 1 }),
      makeMessage({
        id: 'a1',
        role: 'assistant',
        createdAt: 2,
        toolCalls: [{ id: 'call-list-1', name: 'list_tools', args: {} }],
      }),
      makeMessage({
        id: 'tr1',
        role: 'tool_result',
        toolCallId: 'call-list-1',
        content: JSON.stringify({ tools: ['vfs_read', 'vfs_write'] }),
        createdAt: 3,
      }),
      makeMessage({ id: 'a2', role: 'assistant', content: 'The calculator has been built.', createdAt: 4 }),
    ];

    const turns = buildTurnsFromHistory(messages, 'session-1');
    const model = buildExecutionGraphModel({
      sessionId: 'session-1',
      messages,
      turns,
      toolActivities: [],
      activeAgentLoops: {},
      sessions: [makeSession()],
      sessionMessages: {
        'session-1': messages,
      },
      collapseTools: false,
    });

    const turnNode = model.nodes.find((node) => node.kind === 'turn');
    const finalNode = model.nodes.find((node) => node.kind === 'final-answer');
    const nonFinalMaxColumn = Math.max(...model.nodes.filter((node) => node.kind !== 'final-answer').map((node) => node.column));
    const dashedToFinal = model.edges.filter((edge) => edge.targetId === finalNode?.id && edge.style === 'dashed');

    expect(finalNode?.title).toBe('Final response');
    expect(finalNode?.subtitle).toBe('Last chat reply');
    expect(finalNode?.column).toBeGreaterThan(turnNode?.column ?? -1);
    expect(finalNode?.column).toBeGreaterThan(nonFinalMaxColumn);
    expect(finalNode?.row).toBe(turnNode?.row);
    expect(dashedToFinal).toEqual([]);
  });
});
