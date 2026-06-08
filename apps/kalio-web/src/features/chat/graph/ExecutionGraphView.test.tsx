import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
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
  addSession: ReturnType<typeof vi.fn>;
  setMessages: ReturnType<typeof vi.fn>;
  setAgentTurns: ReturnType<typeof vi.fn>;
  setPendingMessage: ReturnType<typeof vi.fn>;
  addMessage: ReturnType<typeof vi.fn>;
  updateSession: ReturnType<typeof vi.fn>;
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
  isStreaming: boolean;
  clearToolActivities: ReturnType<typeof vi.fn>;
  setPendingConfirmation: ReturnType<typeof vi.fn>;
  setStreaming: ReturnType<typeof vi.fn>;
};

const {
  sessionState,
  agentState,
  apiGetMock,
  apiPostMock,
  confirmToolMock,
  cancelToolMock,
  stopTurnMock,
  sendMessageMock,
} = vi.hoisted(() => ({
  sessionState: {
    activeSessionId: null as string | null,
    messages: [] as ChatMessage[],
    agentTurns: [] as AgentTurn[],
    sessions: [] as ChatSession[],
    sessionMessages: {} as Record<string, ChatMessage[]>,
    sessionAgentTurns: {} as Record<string, AgentTurn[]>,
    setActiveSession: vi.fn(),
    addSession: vi.fn(),
    setMessages: vi.fn(),
    setAgentTurns: vi.fn(),
    setPendingMessage: vi.fn(),
    addMessage: vi.fn(),
    updateSession: vi.fn(),
  },
  agentState: {
    toolActivities: [] as ToolActivity[],
    activeAgentLoops: {} as Record<string, AgentLoopShape>,
    pendingConfirmations: {} as Record<string, ToolConfirmationRequest>,
    isStreaming: false,
    clearToolActivities: vi.fn(),
    setPendingConfirmation: vi.fn(),
    setStreaming: vi.fn(),
  },
  apiGetMock: vi.fn(),
  apiPostMock: vi.fn(),
  confirmToolMock: vi.fn(),
  cancelToolMock: vi.fn(),
  stopTurnMock: vi.fn(),
  sendMessageMock: vi.fn(),
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
    post: apiPostMock,
  },
}));

vi.mock('../../../services/eventBus', () => ({
  eventBus: {
    connected: true,
    sendMessage: sendMessageMock,
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

function openGraphControlsMenu(): void {
  fireEvent.click(screen.getByRole('button', { name: 'More graph controls' }));
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
    sessionState.addSession.mockReset();
    sessionState.setMessages.mockReset();
    sessionState.setAgentTurns.mockReset();
    sessionState.setPendingMessage.mockReset();
    sessionState.addMessage.mockReset();
    sessionState.updateSession.mockReset();
    apiGetMock.mockResolvedValue({ data: [makePersona(), makePersona({ id: 'persona-child', name: 'UX Designer', model: 'claude-sonnet-4.6' })] });
    apiPostMock.mockReset();
    apiPostMock.mockResolvedValue({
      data: {
        id: 'new-graph-session',
        personaId: 'default',
        title: 'New Chat',
        createdAt: 20,
        updatedAt: 20,
      },
    });

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
    agentState.isStreaming = false;
    agentState.clearToolActivities.mockReset();
    agentState.setPendingConfirmation.mockReset();
    agentState.setStreaming.mockReset();
    confirmToolMock.mockReset();
    cancelToolMock.mockReset();
    stopTurnMock.mockReset();
    sendMessageMock.mockReset();
    sendMessageMock.mockReturnValue(true);
  });

  it('shows session suggestions and live agent activity when no session is selected', async () => {
    await renderExecutionGraphView();

    expect(screen.getByText('Pick a session')).toBeInTheDocument();
    expect(screen.getByLabelText('Graph overview help')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open session Main UI task from graph overview' })).toBeInTheDocument();
    expect(screen.getAllByText('UX Designer').length).toBeGreaterThan(0);
    expect(screen.getAllByText('run_subagent').length).toBeGreaterThan(0);
  });

  it('opens a suggested session from the empty graph state', async () => {
    await renderExecutionGraphView();

    fireEvent.click(screen.getByRole('button', { name: 'Open session Main UI task from graph overview' }));

    expect(sessionState.setActiveSession).toHaveBeenCalledWith('session-1');
  });

  it('creates a new chat and sends the first prompt when graph view has no active session', async () => {
    sessionState.activeSessionId = null;
    sessionState.sessions = [];

    await renderExecutionGraphView();

    fireEvent.change(screen.getByTestId('graph-empty-prompt-input'), {
      target: { value: 'Start from graph' },
    });
    fireEvent.click(screen.getByTestId('graph-empty-send-prompt'));

    await waitFor(() => expect(apiPostMock).toHaveBeenCalledWith('/api/sessions', {
      personaId: 'default',
      title: 'New Chat',
    }));
    expect(sessionState.addSession).toHaveBeenCalledWith(expect.objectContaining({ id: 'new-graph-session' }));
    expect(sessionState.setActiveSession).toHaveBeenCalledWith('new-graph-session');
    expect(sessionState.addMessage).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: 'new-graph-session',
      role: 'user',
      content: 'Start from graph',
    }));
    expect(sendMessageMock).toHaveBeenCalledWith({
      sessionId: 'new-graph-session',
      content: 'Start from graph',
      personaId: 'default',
    });
  });

  it('keeps the graph shell visible when the active session has no execution nodes yet', async () => {
    sessionState.activeSessionId = 'session-1';
    sessionState.sessionMessages = { 'session-1': [] };

    await renderExecutionGraphView();

    expect(screen.getByRole('heading', { name: 'Execution Graph' })).toBeInTheDocument();
    expect(screen.getByText('Main UI task')).toBeInTheDocument();
    expect(screen.getByLabelText('Empty graph help')).toBeInTheDocument();
    expect(screen.getByLabelText('Empty graph help').tagName).toBe('BUTTON');
    expect(screen.queryByText('No execution nodes yet for this session.')).toBeNull();
    expect(screen.getByTestId('graph-empty-composer')).toBeInTheDocument();
    expect(screen.getByTestId('graph-empty-send-prompt')).toHaveClass('min-h-10');
  });

  it('starts the first chat message directly from the empty graph state', async () => {
    sessionState.activeSessionId = 'session-1';
    sessionState.sessionMessages = { 'session-1': [] };
    sessionState.sessions = [
      { id: 'session-1', personaId: 'default', title: 'New Chat', createdAt: 1, updatedAt: 10 },
    ];

    await renderExecutionGraphView();

    fireEvent.change(screen.getByTestId('graph-empty-prompt-input'), {
      target: { value: 'Start this graph session' },
    });
    fireEvent.click(screen.getByTestId('graph-empty-send-prompt'));

    expect(sessionState.updateSession).toHaveBeenCalledWith('session-1', { title: 'Start this graph session' });
    expect(sessionState.addMessage).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: 'session-1',
      role: 'user',
      content: 'Start this graph session',
    }));
    expect(agentState.clearToolActivities).toHaveBeenCalledWith('session-1');
    expect(agentState.setStreaming).toHaveBeenCalledWith(true);
    expect(sendMessageMock).toHaveBeenCalledWith({
      sessionId: 'session-1',
      content: 'Start this graph session',
      personaId: 'default',
    });
  });

  it('renders durable architecture graph nodes for architecture root sessions without chat messages', async () => {
    sessionState.activeSessionId = 'arch-run-1-root';
    sessionState.messages = [];
    sessionState.sessionMessages = {
      'arch-run-1-root': [],
      'arch-run-1-pragmatist': [
        makeMessage({
          id: 'branch-1',
          sessionId: 'arch-run-1-pragmatist',
          role: 'assistant',
          content: 'README exists and is readable.',
          createdAt: 3,
        }),
      ],
    };
    sessionState.sessions = [
      { id: 'arch-run-1-root', personaId: 'default', title: 'Architecture root', kind: 'chat', createdAt: 1, updatedAt: 1 },
      { id: 'arch-run-1-pragmatist', personaId: 'dev', title: 'Five Minds Council: Pragmatist', kind: 'subagent', parentSessionId: 'arch-run-1-root', createdAt: 2, updatedAt: 2 },
    ];
    apiGetMock.mockImplementation((url: string) => {
      if (url === '/api/personas') {
        return Promise.resolve({ data: [makePersona()] });
      }
      if (url === '/api/architecture-runs/run-1/graph') {
        return Promise.resolve({
          data: {
            runId: 'run-1',
            nodes: [
              { id: 'five-minds-debate', label: 'Five Minds Debate', kind: 'parallel', status: 'completed', eventIds: ['event-1'] },
              { id: 'pragmatist', label: 'Pragmatist', kind: 'role', status: 'completed', eventIds: ['event-2'] },
            ],
            edges: [
              { id: 'debate-pragmatist', fromNodeId: 'five-minds-debate', toNodeId: 'pragmatist' },
            ],
            routeHops: [
              { eventId: 'event-1', source: 'parallel', fromNodeId: 'five-minds-debate', toNodeId: 'pragmatist' },
            ],
          },
        });
      }
      return Promise.resolve({ data: [] });
    });

    await renderExecutionGraphView();

    expect(await screen.findByTestId('graph-node-architecture-root:five-minds-debate')).toBeInTheDocument();
    expect(await screen.findByTestId('graph-node-architecture-root:pragmatist')).toBeInTheDocument();
    expect(screen.queryByText('No execution nodes yet for this session.')).toBeNull();
  });

  it('defaults graph cards to compact density and can reveal detailed tool metadata', async () => {
    const messages = [
      makeMessage({ id: 'u1', role: 'user', content: 'Run architecture branch', createdAt: 1 }),
      makeMessage({
        id: 'a1',
        role: 'assistant',
        content: 'Starting branch.',
        createdAt: 2,
        toolCalls: [{
          id: 'call-architecture-1',
          name: 'run_subagent',
          args: {
            architectureRunId: 'run-123',
            nodeId: 'innovator',
            objective: 'Innovator branch for hydration audit proof',
          },
        }],
      }),
    ];

    sessionState.activeSessionId = 'session-1';
    sessionState.messages = messages;
    sessionState.sessionMessages = { 'session-1': messages };
    sessionState.agentTurns = buildTurnsFromHistory(messages, 'session-1');
    sessionState.sessionAgentTurns = { 'session-1': sessionState.agentTurns };
    agentState.toolActivities = [];

    await renderExecutionGraphView();

    openGraphControlsMenu();
    expect(screen.getByTestId('graph-card-density-compact')).toHaveClass('text-cyan-200');
    expect(screen.queryByText('Objective')).toBeNull();

    fireEvent.click(screen.getByTestId('graph-card-density-detailed'));

    expect(screen.getByText('Objective')).toBeInTheDocument();
  });

  it('filters the graph to the latest architecture run until the user expands all runs', async () => {
    const messages = [
      makeMessage({
        id: 'u1',
        role: 'user',
        content: '[Architecture: Five Minds]\nAudit the first pass',
        createdAt: 1,
      }),
      makeMessage({
        id: 'a1',
        role: 'assistant',
        content: 'First pass complete.',
        createdAt: 2,
        architectureRun: {
          runId: 'run-1',
          schemaId: 'five-minds-council',
          status: 'completed',
          finalArtifact: 'First pass artifact',
          trace: [
            {
              speaker: 'participant',
              eventId: 'run-1-event-1',
              content: 'First pass prompt',
              nodeId: 'agent-1',
              nextNodeId: 'router-1',
            },
          ],
          routeHops: [
            {
              eventId: 'run-1-event-1',
              source: 'runtime_fallback',
              fromNodeId: 'agent-1',
              toNodeId: 'router-1',
            },
          ],
        },
      }),
      makeMessage({
        id: 'u2',
        role: 'user',
        content: '[Architecture: Goal Guard]\nAudit the second pass',
        createdAt: 3,
      }),
      makeMessage({
        id: 'a2',
        role: 'assistant',
        content: 'Second pass complete.',
        createdAt: 4,
        architectureRun: {
          runId: 'run-2',
          schemaId: 'goal-guard-loop',
          status: 'completed',
          finalArtifact: 'Second pass artifact',
          trace: [
            {
              speaker: 'participant',
              eventId: 'run-2-event-1',
              content: 'Second pass prompt',
              nodeId: 'agent-2',
              nextNodeId: 'router-2',
            },
          ],
          routeHops: [
            {
              eventId: 'run-2-event-1',
              source: 'runtime_fallback',
              fromNodeId: 'agent-2',
              toNodeId: 'router-2',
            },
          ],
        },
      }),
    ];

    sessionState.activeSessionId = 'session-1';
    sessionState.messages = messages;
    sessionState.sessionMessages = { 'session-1': messages };
    sessionState.agentTurns = buildTurnsFromHistory(messages, 'session-1');
    sessionState.sessionAgentTurns = { 'session-1': sessionState.agentTurns };
    agentState.toolActivities = [];

    await renderExecutionGraphView();

    openGraphControlsMenu();
    expect(screen.getByTestId('graph-focus-latest-architecture')).toBeInTheDocument();
    expect(screen.getByTestId('graph-focus-all')).toBeInTheDocument();
    expect(screen.queryByTestId('graph-node-architecture-run:a1')).toBeNull();
    expect(screen.getByTestId('graph-node-architecture-run:a2')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('graph-focus-all'));

    expect(screen.getByTestId('graph-node-architecture-run:a1')).toBeInTheDocument();
    expect(screen.getByTestId('graph-node-architecture-run:a2')).toBeInTheDocument();
  });

  it('hydrates active session history when graph mode opens without chat state', async () => {
    const messages = [
      makeMessage({ id: 'u1', role: 'user', content: 'Review release workflow', createdAt: 1 }),
      makeMessage({ id: 'a1', role: 'assistant', content: 'Done.', createdAt: 2 }),
    ];
    sessionState.activeSessionId = 'session-1';
    sessionState.messages = [];
    sessionState.sessionMessages = {};
    apiGetMock.mockImplementation((url: string) => {
      if (url === '/api/personas') {
        return Promise.resolve({ data: [makePersona()] });
      }
      if (url === '/api/sessions/session-1/messages') {
        return Promise.resolve({ data: messages });
      }
      return Promise.resolve({ data: [] });
    });

    await renderExecutionGraphView();

    expect(apiGetMock).toHaveBeenCalledWith('/api/sessions/session-1/messages');
    expect(sessionState.setMessages).toHaveBeenCalledWith(messages, 'session-1');
    expect(sessionState.setAgentTurns).toHaveBeenCalledWith(buildTurnsFromHistory(messages, 'session-1'), 'session-1');
  });

  it('renders graph turns from loaded messages when stored turn state is empty', async () => {
    const messages = [
      makeMessage({ id: 'u1', role: 'user', content: 'Review release workflow', createdAt: 1 }),
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
    sessionState.agentTurns = [];
    sessionState.sessionAgentTurns = {};
    agentState.toolActivities = [];

    await renderExecutionGraphView();

    expect(screen.getByTestId('graph-node-tool:call-list-1')).toBeInTheDocument();
    expect(screen.getByTestId(/^graph-node-final:/)).toBeInTheDocument();
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

    expect(screen.getByTestId(`graph-node-tool-group:${sessionState.agentTurns[0]?.id}`)).toBeInTheDocument();

    openGraphControlsMenu();
    fireEvent.click(await screen.findByTestId('graph-zoom-in'));

    expect(await screen.findByTestId('graph-node-tool:call-list-1')).toBeInTheDocument();
    expect(screen.getByTestId('graph-node-tool:call-preview-1')).toBeInTheDocument();

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

    expect(await screen.findByText('97%')).toBeInTheDocument();
  });

  it('keeps wheel zoom clamped at the readable minimum instead of drifting below the board floor', async () => {
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

    const viewport = await screen.findByTestId('execution-graph-viewport');
    for (let index = 0; index < 8; index += 1) {
      fireEvent.wheel(viewport, { deltaY: 120 });
    }

    expect(await screen.findByText('58%')).toBeInTheDocument();
    expect(screen.queryByText('55%')).toBeNull();
  });

  it('fits the whole graph from the controls menu without forcing small graphs down to overview zoom', async () => {
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

    expect(await screen.findByText('82%')).toBeInTheDocument();

    openGraphControlsMenu();
    fireEvent.click(screen.getByTestId('graph-fit-all'));

    expect(await screen.findByText('82%')).toBeInTheDocument();
  });

  it('keeps node properties collapsed until a graph node is selected', async () => {
    const messages = [
      makeMessage({ id: 'u1', role: 'user', content: 'Build graph layout', createdAt: 1 }),
      makeMessage({
        id: 'a1',
        role: 'assistant',
        createdAt: 2,
        toolCalls: [{ id: 'call-list-1', name: 'list_tools', args: {} }],
      }),
      makeMessage({ id: 'tr1', role: 'tool_result', toolCallId: 'call-list-1', content: JSON.stringify({ ok: true }), createdAt: 3 }),
    ];

    sessionState.activeSessionId = 'session-1';
    sessionState.messages = messages;
    sessionState.sessionMessages = { 'session-1': messages };
    sessionState.agentTurns = buildTurnsFromHistory(messages, 'session-1');
    sessionState.sessionAgentTurns = { 'session-1': sessionState.agentTurns };
    agentState.toolActivities = [];

    await renderExecutionGraphView();

    expect(await screen.findByTestId('graph-inspector-expand')).toBeDisabled();
    expect(screen.queryByText('Node Properties')).toBeNull();

    fireEvent.click(await screen.findByTestId('graph-node-tool:call-list-1'));

    expect(await screen.findByText('Node Properties')).toBeInTheDocument();
    expect(screen.getByText('Tool details')).toBeInTheDocument();
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

    fireEvent.click(await screen.findByTestId('graph-node-tool:call-list-1'));
    const inspector = await screen.findByTestId('execution-graph-inspector');

    expect(inspector.style.getPropertyValue('--graph-inspector-width')).toBe('280px');

    fireEvent.mouseDown(screen.getByTestId('graph-inspector-resize-handle'), { clientX: 1000 });
    fireEvent.mouseMove(document, { clientX: 920 });
    fireEvent.mouseUp(document);

    expect(inspector.style.getPropertyValue('--graph-inspector-width')).toBe('360px');
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

    expect(screen.queryByTestId('graph-live-preview')).toBeNull();
    fireEvent.click(await screen.findByTestId('graph-live-preview-toggle'));
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

  it('shows reconnect/retry notice when stopping a CLI child run fails', async () => {
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
    stopTurnMock.mockReturnValue(false);
    fireEvent.click(screen.getByRole('button', { name: 'Stop run' }));

    expect(stopTurnMock).toHaveBeenCalledWith('cli-child-1');
    expect(screen.getByText('Stop request could not be delivered. Reconnect and retry.')).toBeInTheDocument();
  });

  it('renders a visible main to subagent to nested subagent to CLI-agent chain with CLI output', async () => {
    const outerSubagentResult = {
      result: 'Nested delegated to CLI',
      taskId: 'task-outer',
      childSessionId: 'sub-outer',
      parentSessionId: 'session-1',
      vfsMode: 'isolated',
      vfsSessionId: 'sub-outer',
      copiedFiles: [],
      durationMs: 100,
    };
    const nestedSubagentResult = {
      result: 'CLI reported kalio-forever',
      taskId: 'task-nested',
      childSessionId: 'sub-nested',
      parentSessionId: 'sub-outer',
      vfsMode: 'isolated',
      vfsSessionId: 'sub-nested',
      copiedFiles: [],
      durationMs: 80,
    };
    const cliAgentResult = {
      childSessionId: 'cli-child-1',
      parentSessionId: 'sub-nested',
      agentId: 'codex',
      workdir: 'C:/Projekty/kalio-forever',
      status: 'completed',
      lastPrompt: 'Read package.json',
      updatedAt: 9,
      completedAt: 9,
      lastOutput: 'kalio-forever',
      output: 'kalio-forever',
      exitCode: 0,
      durationMs: 20,
    };
    const mainMessages = [
      makeMessage({ id: 'u1', role: 'user', content: 'Delegate deeply', createdAt: 1 }),
      makeMessage({
        id: 'a1',
        role: 'assistant',
        toolCalls: [{ id: 'call-sub-outer', name: 'run_subagent', args: { objective: 'outer' } }],
        createdAt: 2,
      }),
      makeMessage({ id: 'tr1', role: 'tool_result', toolCallId: 'call-sub-outer', content: JSON.stringify(outerSubagentResult), createdAt: 3 }),
    ];
    const outerMessages = [
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
    const nestedMessages = [
      makeMessage({ id: 'nu1', sessionId: 'sub-nested', role: 'user', content: 'nested', createdAt: 7 }),
      makeMessage({
        id: 'na1',
        sessionId: 'sub-nested',
        role: 'assistant',
        toolCalls: [{ id: 'call-cli', name: 'run_cli_agent', args: { agentId: 'codex', workdir: 'C:/Projekty/kalio-forever', prompt: 'Read package.json' } }],
        createdAt: 8,
      }),
      makeMessage({ id: 'ntr1', sessionId: 'sub-nested', role: 'tool_result', toolCallId: 'call-cli', content: JSON.stringify(cliAgentResult), createdAt: 9 }),
    ];
    const cliMessages = [
      makeMessage({ id: 'cu1', sessionId: 'cli-child-1', role: 'user', content: 'Read package.json', createdAt: 10 }),
      makeMessage({
        id: 'ctr1',
        sessionId: 'cli-child-1',
        role: 'tool_result',
        toolCallId: 'cli-run-1',
        content: JSON.stringify({ output: 'kalio-forever', exitCode: 0, durationMs: 20, agentId: 'codex' }),
        createdAt: 11,
      }),
      makeMessage({ id: 'ca1', sessionId: 'cli-child-1', role: 'assistant', content: 'kalio-forever', createdAt: 12 }),
    ];

    const mainTurns = buildTurnsFromHistory(mainMessages, 'session-1');
    const outerTurns = buildTurnsFromHistory(outerMessages, 'sub-outer');
    const nestedTurns = buildTurnsFromHistory(nestedMessages, 'sub-nested');
    const cliTurns = buildTurnsFromHistory(cliMessages, 'cli-child-1');

    sessionState.activeSessionId = 'session-1';
    sessionState.messages = mainMessages;
    sessionState.sessionMessages = {
      'session-1': mainMessages,
      'sub-outer': outerMessages,
      'sub-nested': nestedMessages,
      'cli-child-1': cliMessages,
    };
    sessionState.sessions = [
      { id: 'session-1', personaId: 'default', title: 'Main', createdAt: 1, updatedAt: 12 },
      { id: 'sub-outer', personaId: 'default', title: 'Outer subagent', kind: 'subagent', parentSessionId: 'session-1', createdAt: 2, updatedAt: 12 },
      { id: 'sub-nested', personaId: 'default', title: 'Nested subagent', kind: 'subagent', parentSessionId: 'sub-outer', createdAt: 3, updatedAt: 12 },
      { id: 'cli-child-1', personaId: 'default', title: 'Codex CLI', kind: 'cli-agent', parentSessionId: 'sub-nested', createdAt: 4, updatedAt: 12 },
    ];
    sessionState.agentTurns = mainTurns;
    sessionState.sessionAgentTurns = {
      'session-1': mainTurns,
      'sub-outer': outerTurns,
      'sub-nested': nestedTurns,
      'cli-child-1': cliTurns,
    };
    agentState.toolActivities = [];

    await renderExecutionGraphView();

    expect(screen.getByTestId('graph-node-subagent:sub-outer')).toBeInTheDocument();
    expect(screen.getByTestId('graph-node-subagent:sub-nested')).toBeInTheDocument();
    expect(screen.getByTestId('graph-node-cli-agent:cli-child-1')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('graph-node-cli-agent:cli-child-1'));

    const inspector = screen.getByTestId('execution-graph-inspector');
    expect(inspector).toHaveTextContent('CLI child details');
    expect(inspector).toHaveTextContent('C:/Projekty/kalio-forever');
    expect(inspector).toHaveTextContent('kalio-forever');
    expect(inspector).toHaveTextContent('Transcript tail');

    fireEvent.click(screen.getByRole('button', { name: 'Open child chat' }));

    expect(sessionState.setActiveSession).toHaveBeenCalledWith('cli-child-1');
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

  it('opens child chat and graph actions for delegated AgentFlow nodes', async () => {
    const messages = [
      makeMessage({ id: 'u1', role: 'user', content: 'Run Goal Guard flow', createdAt: 1 }),
      makeMessage({
        id: 'a1',
        role: 'assistant',
        createdAt: 2,
        toolCalls: [{
          id: 'call-flow-1',
          name: 'run_sub_agentflow',
          args: { flowId: 'goal_guard_delivery_loop', goal: 'Verify delivery' },
        }],
      }),
      makeMessage({
        id: 'tr1',
        role: 'tool_result',
        toolCallId: 'call-flow-1',
        content: JSON.stringify({
          flowRunId: 'flow-1',
          childSessionId: 'arch-flow-1-root',
          openChatSessionId: 'arch-flow-1-root',
          openGraphRunId: 'flow-1',
          status: 'running',
          summary: 'Goal Guard AgentFlow is running.',
          decisions: [],
          nextActions: [],
          artifacts: [],
        }),
        createdAt: 3,
      }),
    ];

    sessionState.activeSessionId = 'session-1';
    sessionState.messages = messages;
    sessionState.sessionMessages = { 'session-1': messages };
    sessionState.sessions = [
      { id: 'session-1', personaId: 'default', title: 'Main', createdAt: 1, updatedAt: 3 },
      { id: 'arch-flow-1-root', personaId: 'default', title: 'Goal Guard AgentFlow', kind: 'chat', parentSessionId: 'session-1', createdAt: 2, updatedAt: 3 },
    ];
    sessionState.agentTurns = buildTurnsFromHistory(messages, 'session-1');
    sessionState.sessionAgentTurns = { 'session-1': sessionState.agentTurns };
    agentState.toolActivities = [];

    await renderExecutionGraphView();

    fireEvent.click(screen.getByTestId('graph-node-agent-flow:flow-1'));

    fireEvent.click(screen.getByRole('button', { name: 'Open child chat' }));
    expect(sessionState.setActiveSession).toHaveBeenCalledWith('arch-flow-1-root');

    fireEvent.click(screen.getByRole('button', { name: 'Open child graph' }));
    expect(sessionState.setActiveSession).toHaveBeenLastCalledWith('arch-flow-1-root');
  });
});
