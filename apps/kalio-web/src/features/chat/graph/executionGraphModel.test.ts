import { describe, expect, it } from 'vitest';
import type { ChatMessage, ChatSession, Persona } from '@kalio/types';
import type { ToolActivity } from '../../../store/agentStore';
import { buildTurnsFromHistory } from '../chatUtils';
import { buildExecutionGraphModel } from './executionGraphModel';
import { NODE_HEIGHT, ROW_GAP } from './executionGraphModel.helpers';

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
    expect(subagentNode?.subtitle).toContain('Explore layout options for the execution graph');
    expect(subagentNode?.detail).toContain('claude-sonnet-4.6');
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
    expect(toolNode?.payload.kind).toBe('tool');
    expect(toolNode?.payload.kind === 'tool' ? toolNode.payload.confirmationRequired : false).toBe(true);
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
    expect(toolNode?.y).toBe((turnNode?.y ?? 0) + (turnNode?.height ?? 0) + ROW_GAP);
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
