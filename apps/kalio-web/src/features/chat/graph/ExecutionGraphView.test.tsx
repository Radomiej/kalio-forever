import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatMessage, ChatSession, Persona, ToolConfirmationRequest } from '@kalio/types';
import type { ToolActivity } from '../../../store/agentStore';
import type { AgentTurn } from '../../../store/sessionStore';
import { buildTurnsFromHistory } from '../chatUtils';
import { ExecutionGraphView } from './ExecutionGraphView';

type SessionStateShape = {
  activeSessionId: string | null;
  messages: ChatMessage[];
  agentTurns: AgentTurn[];
  sessions: ChatSession[];
  sessionMessages: Record<string, ChatMessage[]>;
  sessionAgentTurns: Record<string, AgentTurn[]>;
  setActiveSession: ReturnType<typeof vi.fn>;
  setPendingMessage: ReturnType<typeof vi.fn>;
};

type AgentLoopShape = {
  sessionId: string;
  turnId: string;
  startedAt: number;
  agentRun?: {
    agentRunId: string;
    agentType: 'subagent';
    label?: string;
  };
};

type AgentStateShape = {
  toolActivities: ToolActivity[];
  activeAgentLoops: Record<string, AgentLoopShape>;
  pendingConfirmations: Record<string, ToolConfirmationRequest>;
  setPendingConfirmation: ReturnType<typeof vi.fn>;
};

const {
  sessionState,
  agentState,
  apiGetMock,
  confirmToolMock,
  cancelToolMock,
  stopTurnMock,
} = vi.hoisted(() => ({
  sessionState: {
    activeSessionId: null as string | null,
    messages: [] as ChatMessage[],
    agentTurns: [] as AgentTurn[],
    sessions: [] as ChatSession[],
    sessionMessages: {} as Record<string, ChatMessage[]>,
    sessionAgentTurns: {} as Record<string, AgentTurn[]>,
    setActiveSession: vi.fn(),
    setPendingMessage: vi.fn(),
  },
  agentState: {
    toolActivities: [] as ToolActivity[],
    activeAgentLoops: {} as Record<string, AgentLoopShape>,
    pendingConfirmations: {} as Record<string, ToolConfirmationRequest>,
    setPendingConfirmation: vi.fn(),
  },
  apiGetMock: vi.fn(),
  confirmToolMock: vi.fn(),
  cancelToolMock: vi.fn(),
  stopTurnMock: vi.fn(),
}));

vi.mock('../../../store/sessionStore', () => ({
  useSessionStore: (selector?: (state: SessionStateShape) => unknown) => selector ? selector(sessionState) : sessionState,
}));

vi.mock('../../../store/agentStore', () => ({
  useAgentStore: (selector?: (state: AgentStateShape) => unknown) => selector ? selector(agentState) : agentState,
}));

vi.mock('../../../services/apiClient', () => ({
  apiClient: {
    get: apiGetMock,
  },
}));

vi.mock('../../../services/eventBus', () => ({
  eventBus: {
    confirmTool: confirmToolMock,
    cancelTool: cancelToolMock,
    stopTurn: stopTurnMock,
  },
}));

vi.mock('../../raapp/RAAppRenderer', () => ({
  RAAppRenderer: ({
    block,
    sessionId,
  }: {
    block: { type: string; content: string; vfsPath?: string };
    sessionId?: string;
  }) => (
    <div data-testid="graph-raapp-renderer">
      {block.type}:{sessionId ?? 'none'}:{block.vfsPath ?? block.content}
    </div>
  ),
}));

async function renderExecutionGraphView(): Promise<void> {
  await act(async () => {
    render(<ExecutionGraphView />);
    await Promise.resolve();
    await Promise.resolve();
  });
}

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

function makePersona(overrides: Partial<Persona> = {}): Persona {
  return {
    id: 'default',
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

describe('ExecutionGraphView empty-session state', () => {
  beforeEach(() => {
    sessionState.activeSessionId = null;
    sessionState.messages = [];
    sessionState.agentTurns = [];
    sessionState.sessionAgentTurns = {};
    sessionState.sessions = [
      {
        id: 'session-1',
        personaId: 'default',
        title: 'Main UI task',
        createdAt: 1,
        updatedAt: 10,
      },
      {
        id: 'child-session-1',
        personaId: 'default',
        title: 'Sub-agent: UX Designer',
        kind: 'subagent',
        createdAt: 2,
        updatedAt: 12,
      },
    ];
    sessionState.sessionMessages = {};
    sessionState.setActiveSession.mockReset();
    sessionState.setPendingMessage.mockReset();
    apiGetMock.mockResolvedValue({ data: [makePersona(), makePersona({ id: 'persona-child', name: 'UX Designer', model: 'claude-sonnet-4.6' })] });

    agentState.toolActivities = [
      {
        callId: 'call-subagent-1',
        toolName: 'run_subagent',
        args: { persona: 'UX Designer' },
        sessionId: 'session-1',
        status: 'running',
        startedAt: 100,
      },
    ];
    agentState.activeAgentLoops = {
      'subagent-run-1': {
        sessionId: 'child-session-1',
        turnId: 'turn-1',
        startedAt: 100,
        agentRun: {
          agentRunId: 'subagent-run-1',
          agentType: 'subagent',
          label: 'UX Designer',
        },
      },
    };
    agentState.pendingConfirmations = {};
    agentState.setPendingConfirmation.mockReset();
    confirmToolMock.mockReset();
    cancelToolMock.mockReset();
    stopTurnMock.mockReset();
  });

  it('shows session suggestions and live agent activity when no session is selected', async () => {
    await renderExecutionGraphView();

    expect(screen.getByText('Pick a session or inspect live activity')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open session Main UI task from graph overview' })).toBeInTheDocument();
    expect(screen.getAllByText('UX Designer').length).toBeGreaterThan(0);
    expect(screen.getAllByText('run_subagent').length).toBeGreaterThan(0);
  });

  it('opens a suggested session from the empty graph state', async () => {
    await renderExecutionGraphView();

    fireEvent.click(screen.getByRole('button', { name: 'Open session Main UI task from graph overview' }));

    expect(sessionState.setActiveSession).toHaveBeenCalledWith('session-1');
  });

  it('keeps the graph shell visible when the active session has no execution nodes yet', async () => {
    sessionState.activeSessionId = 'session-1';

    await renderExecutionGraphView();

    expect(screen.getByRole('heading', { name: 'Execution Graph' })).toBeInTheDocument();
    expect(screen.getByText('No execution nodes yet for this session.')).toBeInTheDocument();
  });

  it('shows Accept actions for awaiting-confirmation tool nodes', async () => {
    const messages = [
      makeMessage({ id: 'u1', role: 'user', content: 'Delete draft file', createdAt: 1 }),
      makeMessage({
        id: 'a1',
        role: 'assistant',
        createdAt: 2,
        toolCalls: [{ id: 'call-delete-1', name: 'vfs_delete', args: { path: 'draft.txt' } }],
      }),
    ];

    sessionState.activeSessionId = 'session-1';
    sessionState.messages = messages;
    sessionState.sessionMessages = { 'session-1': messages };
    sessionState.agentTurns = buildTurnsFromHistory(messages, 'session-1');
    sessionState.sessionAgentTurns = { 'session-1': sessionState.agentTurns };
    agentState.toolActivities = [
      {
        callId: 'call-delete-1',
        toolName: 'vfs_delete',
        args: { path: 'draft.txt' },
        sessionId: 'session-1',
        status: 'awaiting_confirmation',
        startedAt: 2,
      },
    ];
    agentState.pendingConfirmations = {
      'session-1': {
        requestId: 'req-1',
        toolCallId: 'call-delete-1',
        sessionId: 'session-1',
        toolName: 'vfs_delete',
        args: { path: 'draft.txt' },
        timeoutMs: 0,
      },
    };

    await renderExecutionGraphView();

    fireEvent.click(screen.getByTestId('graph-node-tool:call-delete-1'));
    fireEvent.click(await screen.findByRole('button', { name: 'Accept tool request' }));

    expect(confirmToolMock).toHaveBeenCalledWith({ requestId: 'req-1', sessionId: 'session-1' });
    expect(agentState.setPendingConfirmation).toHaveBeenCalledWith('session-1', null);
  });

  it('expands individual tools when zoomed in and groups them when zoomed out', async () => {
    const messages = [
      makeMessage({ id: 'u1', role: 'user', content: 'Build graph layout', createdAt: 1 }),
      makeMessage({
        id: 'a1',
        role: 'assistant',
        createdAt: 2,
        toolCalls: [
          { id: 'call-list-1', name: 'list_tools', args: {} },
          { id: 'call-preview-1', name: 'design_preview', args: { mode: 'ui' } },
        ],
      }),
      makeMessage({ id: 'tr1', role: 'tool_result', toolCallId: 'call-list-1', content: JSON.stringify({ ok: true }), createdAt: 3 }),
      makeMessage({ id: 'tr2', role: 'tool_result', toolCallId: 'call-preview-1', content: JSON.stringify({ ok: true }), createdAt: 4 }),
      makeMessage({ id: 'a2', role: 'assistant', content: 'Done.', createdAt: 5 }),
    ];

    sessionState.activeSessionId = 'session-1';
    sessionState.messages = messages;
    sessionState.sessionMessages = { 'session-1': messages };
    sessionState.agentTurns = buildTurnsFromHistory(messages, 'session-1').map((turn) => ({
      ...turn,
      agentRun: { agentRunId: 'master-1', agentType: 'master' as const, label: 'RaBuilder' },
    }));
    sessionState.sessionAgentTurns = { 'session-1': sessionState.agentTurns };
    agentState.toolActivities = [
      {
        callId: 'call-list-1',
        toolName: 'list_tools',
        args: {},
        sessionId: 'session-1',
        status: 'success',
        startedAt: 2,
        finishedAt: 3,
        result: { callId: 'call-list-1', status: 'success', data: { ok: true } },
      },
      {
        callId: 'call-preview-1',
        toolName: 'design_preview',
        args: { mode: 'ui' },
        sessionId: 'session-1',
        status: 'success',
        startedAt: 3,
        finishedAt: 4,
        result: { callId: 'call-preview-1', status: 'success', data: { ok: true } },
      },
    ];

    await renderExecutionGraphView();

    expect(screen.getByTestId('graph-node-tool:call-list-1')).toBeInTheDocument();
    expect(screen.getByTestId('graph-node-tool:call-preview-1')).toBeInTheDocument();

    fireEvent.click(await screen.findByTestId('graph-zoom-out'));
    fireEvent.click(await screen.findByTestId('graph-zoom-out'));
    fireEvent.click(await screen.findByTestId('graph-zoom-out'));

    expect(await screen.findByTestId(`graph-node-tool-group:${sessionState.agentTurns[0]?.id}`)).toBeInTheDocument();
  });

  it('zooms the graph with the mouse wheel over the canvas', async () => {
    const messages = [
      makeMessage({ id: 'u1', role: 'user', content: 'Build graph layout', createdAt: 1 }),
      makeMessage({
        id: 'a1',
        role: 'assistant',
        createdAt: 2,
        toolCalls: [{ id: 'call-list-1', name: 'list_tools', args: {} }],
      }),
      makeMessage({ id: 'tr1', role: 'tool_result', toolCallId: 'call-list-1', content: JSON.stringify({ ok: true }), createdAt: 3 }),
      makeMessage({ id: 'a2', role: 'assistant', content: 'Done.', createdAt: 4 }),
    ];

    sessionState.activeSessionId = 'session-1';
    sessionState.messages = messages;
    sessionState.sessionMessages = { 'session-1': messages };
    sessionState.agentTurns = buildTurnsFromHistory(messages, 'session-1');
    sessionState.sessionAgentTurns = { 'session-1': sessionState.agentTurns };
    agentState.toolActivities = [];

    await renderExecutionGraphView();

    fireEvent.wheel(await screen.findByTestId('execution-graph-viewport'), { deltaY: -120 });

    expect(await screen.findByText('115%')).toBeInTheDocument();
  });

  it('lets the inspector panel be resized from the graph view', async () => {
    const messages = [
      makeMessage({ id: 'u1', role: 'user', content: 'Build graph layout', createdAt: 1 }),
      makeMessage({
        id: 'a1',
        role: 'assistant',
        createdAt: 2,
        toolCalls: [{ id: 'call-list-1', name: 'list_tools', args: {} }],
      }),
      makeMessage({ id: 'tr1', role: 'tool_result', toolCallId: 'call-list-1', content: JSON.stringify({ ok: true }), createdAt: 3 }),
      makeMessage({ id: 'a2', role: 'assistant', content: 'Done.', createdAt: 4 }),
    ];

    sessionState.activeSessionId = 'session-1';
    sessionState.messages = messages;
    sessionState.sessionMessages = { 'session-1': messages };
    sessionState.agentTurns = buildTurnsFromHistory(messages, 'session-1');
    sessionState.sessionAgentTurns = { 'session-1': sessionState.agentTurns };
    agentState.toolActivities = [];

    await renderExecutionGraphView();

    const inspector = await screen.findByTestId('execution-graph-inspector');

    expect(inspector).toHaveStyle({ width: '384px' });

    fireEvent.mouseDown(screen.getByTestId('graph-inspector-resize-handle'), { clientX: 1000 });
    fireEvent.mouseMove(document, { clientX: 920 });
    fireEvent.mouseUp(document);

    expect(inspector.style.width).toBe('464px');
  });

  it('renders a real preview panel for preview-capable tool nodes and a miniature in the node', async () => {
    const messages = [
      makeMessage({ id: 'u1', role: 'user', content: 'Build calculator preview', createdAt: 1 }),
      makeMessage({
        id: 'a1',
        role: 'assistant',
        createdAt: 2,
        toolCalls: [{ id: 'call-preview-1', name: 'design_preview', args: { filePath: 'calculator/index.html' } }],
      }),
      makeMessage({
        id: 'tr1',
        role: 'tool_result',
        toolCallId: 'call-preview-1',
        content: JSON.stringify({
          status: 'ready',
          type: 'html',
          vfsPath: 'calculator/index.html',
          content: '<main><h1>Calculator preview</h1></main>',
        }),
        createdAt: 3,
      }),
    ];

    sessionState.activeSessionId = 'session-1';
    sessionState.messages = messages;
    sessionState.sessionMessages = { 'session-1': messages };
    sessionState.agentTurns = buildTurnsFromHistory(messages, 'session-1');
    sessionState.sessionAgentTurns = { 'session-1': sessionState.agentTurns };
    agentState.toolActivities = [];

    await renderExecutionGraphView();

    expect(await screen.findByTestId('graph-node-preview-tool:call-preview-1')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('graph-node-tool:call-preview-1'));

    expect(await screen.findByTestId('graph-live-preview')).toBeInTheDocument();
    expect(await screen.findByTestId('graph-raapp-renderer')).toHaveTextContent('html:session-1:calculator/index.html');
  });

  it('renders CLI child controls for CLI-agent child nodes', async () => {
    const messages = [
      makeMessage({ id: 'u1', role: 'user', content: 'Inspect repo with CLI agent', createdAt: 1 }),
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
        content: JSON.stringify({
          childSessionId: 'cli-child-1',
          parentSessionId: 'session-1',
          agentId: 'codex',
          workdir: 'C:/repo',
          status: 'running',
          lastPrompt: 'Inspect repo',
          updatedAt: 3,
        }),
        createdAt: 3,
      }),
    ];

    sessionState.activeSessionId = 'session-1';
    sessionState.messages = messages;
    sessionState.sessionMessages = {
      'session-1': messages,
      'cli-child-1': [makeMessage({ id: 'cli-msg-1', sessionId: 'cli-child-1', role: 'assistant', content: 'Working', createdAt: 4 })],
    };
    sessionState.sessions = [
      { id: 'session-1', personaId: 'default', title: 'Main', createdAt: 1, updatedAt: 4 },
      { id: 'cli-child-1', personaId: 'default', title: 'Codex CLI child', kind: 'cli-agent', parentSessionId: 'session-1', createdAt: 2, updatedAt: 4 },
    ];
    sessionState.agentTurns = buildTurnsFromHistory(messages, 'session-1');
    sessionState.sessionAgentTurns = { 'session-1': sessionState.agentTurns };
    agentState.toolActivities = [];

    await renderExecutionGraphView();

    fireEvent.click(screen.getByTestId('graph-node-cli-agent:cli-child-1'));

    expect(screen.getByRole('button', { name: 'Open child chat' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Send follow-up' }));
    expect(sessionState.setPendingMessage).toHaveBeenCalledWith('Continue from the current task. Share a concise status update and your next concrete step.');
    expect(sessionState.setActiveSession).toHaveBeenCalledWith('cli-child-1');

    stopTurnMock.mockReturnValue(true);
    fireEvent.click(screen.getByRole('button', { name: 'Stop run' }));
    expect(stopTurnMock).toHaveBeenCalledWith('cli-child-1');
  });

  it('does not render CLI child controls for non-CLI nodes', async () => {
    const messages = [
      makeMessage({ id: 'u1', role: 'user', content: 'List tools', createdAt: 1 }),
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
        content: JSON.stringify({ tools: ['vfs_read'] }),
        createdAt: 3,
      }),
    ];

    sessionState.activeSessionId = 'session-1';
    sessionState.messages = messages;
    sessionState.sessionMessages = { 'session-1': messages };
    sessionState.sessions = [
      { id: 'session-1', personaId: 'default', title: 'Main', createdAt: 1, updatedAt: 3 },
    ];
    sessionState.agentTurns = buildTurnsFromHistory(messages, 'session-1');
    sessionState.sessionAgentTurns = { 'session-1': sessionState.agentTurns };
    agentState.toolActivities = [];

    await renderExecutionGraphView();

    fireEvent.click(screen.getByTestId('graph-node-tool:call-list-1'));

    expect(screen.queryByRole('button', { name: 'Send follow-up' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Stop run' })).not.toBeInTheDocument();
  });
});
