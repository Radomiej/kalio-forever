import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { ChatMessage, ChatSession, RuntimeActivitySnapshot } from '@kalio/types';
import type { LlmActivity, ToolActivity } from '../../store/agentStore';

type AgentStateShape = {
  pendingConfirmations: Record<string, Array<{
    requestId: string;
    toolCallId: string;
    sessionId: string;
    toolName: string;
    args: Record<string, unknown>;
    timeoutMs: number;
    agentRun?: { label?: string };
  }>>;
  pendingBudgetApprovals: Record<string, Array<{
    requestId: string;
    sessionId: string;
    scope?: 'chat' | 'agent';
    usedIterations: number;
    currentLimit: number;
  }>>;
  toolActivities: ToolActivity[];
  llmActivities: LlmActivity[];
  sessionToolActivities: Record<string, ToolActivity[]>;
  activeAgentLoops: Record<string, {
    sessionId: string;
    turnId: string;
    startedAt: number;
  }>;
  runtimeActivitySnapshots: Record<string, RuntimeActivitySnapshot>;
  clearInactiveActivities: () => void;
};

type SessionStateShape = {
  sessions: ChatSession[];
  sessionMessages: Record<string, ChatMessage[]>;
};

const { stopTurn, resumeAgentFlowRun, agentState, sessionState } = vi.hoisted(() => ({
  stopTurn: vi.fn(),
  resumeAgentFlowRun: vi.fn(),
  agentState: {
    pendingConfirmations: {} as Record<string, Array<{
      requestId: string;
      toolCallId: string;
      sessionId: string;
      toolName: string;
      args: Record<string, unknown>;
      timeoutMs: number;
      agentRun?: { label?: string };
    }>>,
    pendingBudgetApprovals: {} as Record<string, Array<{
      requestId: string;
      sessionId: string;
      scope?: 'chat' | 'agent';
      usedIterations: number;
      currentLimit: number;
    }>>,
    toolActivities: [] as ToolActivity[],
    llmActivities: [] as LlmActivity[],
    sessionToolActivities: {} as Record<string, ToolActivity[]>,
    activeAgentLoops: {} as Record<string, {
      sessionId: string;
      turnId: string;
      startedAt: number;
    }>,
    runtimeActivitySnapshots: {} as Record<string, RuntimeActivitySnapshot>,
    clearInactiveActivities: vi.fn(),
  } satisfies AgentStateShape,
  sessionState: {
    sessions: [] as ChatSession[],
    sessionMessages: {} as Record<string, ChatMessage[]>,
  } satisfies SessionStateShape,
}));

vi.mock('../../store/agentStore', () => ({
  useAgentStore: (selector: (state: AgentStateShape) => unknown) => selector(agentState),
}));

vi.mock('../../store/sessionStore', () => ({
  useSessionStore: (selector: (state: SessionStateShape) => unknown) => selector(sessionState),
}));

vi.mock('../../services/eventBus', () => ({
  eventBus: {
    stopTurn,
    confirmTool: vi.fn(),
    cancelTool: vi.fn(),
  },
}));

vi.mock('../agent-flow/agentFlow.api', () => ({
  resumeAgentFlowRun,
}));

vi.mock('../chat/ToolActivityRow', () => ({
  ToolActivityRow: ({ activity }: { activity: ToolActivity }) => (
    <div data-testid="tool-activity-row-mock">
      {activity.toolName}:{activity.status}
    </div>
  ),
}));

import { ConversationManagerPanel } from './ConversationManagerPanel';

function makeSession(id: string, title: string): ChatSession {
  return {
    id,
    personaId: 'default',
    title,
    createdAt: 1,
    updatedAt: 1,
  };
}

function makeToolActivity(overrides: Partial<ToolActivity> = {}): ToolActivity {
  return {
    callId: 'call-1',
    toolName: 'web_search',
    args: {},
    status: 'running',
    startedAt: 1,
    ...overrides,
  };
}

function makeWaitingRuntimeSnapshot(sessionId: string): RuntimeActivitySnapshot {
  return {
    sessionId,
    active: false,
    turnId: 'turn-1',
    queueLength: 0,
    pendingConfirmations: [],
    pendingBudgetApprovals: [],
    toolActivities: [],
    childExecutions: [],
    updatedAt: 1,
    run: {
      id: 'run-1',
      sessionId,
      turnId: 'turn-1',
      phase: 'tool_running',
      status: 'waiting_on_orchestrator',
      retryCount: 0,
      safeResume: true,
      startedAt: 1,
      updatedAt: 1,
      lastHeartbeatAt: 1,
    } as unknown as RuntimeActivitySnapshot['run'],
  };
}

describe('ConversationManagerPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    agentState.pendingConfirmations = {};
    agentState.pendingBudgetApprovals = {};
    agentState.toolActivities = [];
    agentState.llmActivities = [];
    agentState.sessionToolActivities = {};
    agentState.activeAgentLoops = {};
    agentState.runtimeActivitySnapshots = {};
    agentState.clearInactiveActivities = vi.fn();
    sessionState.sessions = [];
    sessionState.sessionMessages = {};
  });

  it('shows the empty state and lets the user navigate back to chat', () => {
    const onNavigate = vi.fn();

    render(<ConversationManagerPanel onNavigate={onNavigate} />);

    expect(screen.getByText(/No active agent runs/i)).toBeInTheDocument();
    fireEvent.click(screen.getByText(/Go to chat/i));
    expect(onNavigate).toHaveBeenCalledTimes(1);
  });

  it('renders pending HITL confirmations and opens the owning conversation', async () => {
    const onOpenSession = vi.fn();
    agentState.pendingConfirmations = {
      'session-hitl': [{
        requestId: 'req-open',
        toolCallId: 'call-open',
        sessionId: 'session-hitl',
        toolName: 'fs_write',
        args: { filePath: 'README.md' },
        timeoutMs: 0,
        agentRun: { label: 'Implementer' },
      }],
    };
    agentState.sessionToolActivities = {
      'session-hitl': [
        {
          callId: 'call-open',
          toolName: 'fs_write',
          args: { filePath: 'README.md' },
          status: 'awaiting_confirmation',
          startedAt: 1,
        },
      ],
    };
    sessionState.sessions = [makeSession('session-hitl', 'Agent delivery run')];

    render(<ConversationManagerPanel onOpenSession={onOpenSession} />);

    expect(screen.getByTestId('home-hitl-inbox')).toBeInTheDocument();
    expect(screen.getByText('Agent delivery run')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('home-hitl-open-req-open'));
    expect(onOpenSession).toHaveBeenCalledWith('session-hitl');
  });

  it('renders running loops using the session title and stops them through the event bus', () => {
    sessionState.sessions = [makeSession('session-1', 'Cats Session')];
    agentState.runtimeActivitySnapshots = {
      'session-1': {
        sessionId: 'session-1',
        active: true,
        turnId: 'turn-1',
        queueLength: 0,
        pendingConfirmations: [],
        pendingBudgetApprovals: [],
        toolActivities: [],
        childExecutions: [],
        updatedAt: 1,
      },
    };

    render(<ConversationManagerPanel />);

    expect(screen.getByTestId('active-loop-session-1')).toHaveTextContent('Cats Session');
    fireEvent.click(screen.getByTestId('stop-loop-session-1'));
    expect(stopTurn).toHaveBeenCalledWith('session-1');
  });

  it('renders non-actionable runtime waiting rows and opens the owning conversation', () => {
    const onOpenSession = vi.fn();
    sessionState.sessions = [makeSession('session-1', 'Architecture Debate: Orchestrator')];
    sessionState.sessionMessages = {
      'session-1': [],
    };
    agentState.runtimeActivitySnapshots = {
      'session-1': makeWaitingRuntimeSnapshot('session-1'),
    };

    render(<ConversationManagerPanel onOpenSession={onOpenSession} />);

    const row = screen.getByTestId('runtime-attention-session-1');
    expect(row).toHaveTextContent('Architecture Debate: Orchestrator');
    expect(row).toHaveTextContent('Waiting on orchestrator');

    fireEvent.click(row);
    expect(onOpenSession).toHaveBeenCalledWith('session-1');
  });

  it('renders a resumable AgentFlow action and posts a generic resume request', () => {
    resumeAgentFlowRun.mockResolvedValue({
      run: {
        id: 'flow-run-1',
        parentSessionId: 'parent-session',
        childSessionId: 'arch-flow-run-1-root',
        flowDefinitionId: 'goal_guard_delivery_loop',
        status: 'running',
        startMode: 'durable',
        returnMode: 'summary',
        createdAt: 1,
        updatedAt: 2,
      },
      events: [],
    });
    sessionState.sessions = [
      makeSession('parent-session', 'Parent chat'),
      makeSession('arch-flow-run-1-root', 'Goal Guard'),
    ];
    agentState.runtimeActivitySnapshots = {
      'parent-session': {
        sessionId: 'parent-session',
        active: false,
        turnId: 'turn-1',
        queueLength: 0,
        pendingConfirmations: [],
        pendingBudgetApprovals: [],
        toolActivities: [],
        childExecutions: [{
          id: 'flow-run-1',
          kind: 'agent_flow',
          parentSessionId: 'parent-session',
          childSessionId: 'arch-flow-run-1-root',
          flowRunId: 'flow-run-1',
          label: 'Goal Guard waiting',
          status: 'waiting',
          updatedAt: 2,
        }],
        updatedAt: 2,
      },
    };

    render(<ConversationManagerPanel />);

    expect(screen.getByTestId('runtime-continuation-flow-run-1')).toHaveTextContent('Goal Guard');
    expect(screen.getByTestId('runtime-continuation-flow-run-1')).toHaveTextContent('Waiting on orchestrator');
    fireEvent.click(screen.getByRole('button', { name: 'Resume AgentFlow' }));

    expect(resumeAgentFlowRun).toHaveBeenCalledWith('flow-run-1', { input: 'Continue.' });
  });

  it('surfaces timeout evidence instead of leaving the active panel empty behind a warning badge', () => {
    sessionState.sessions = [makeSession('session-1', 'Architecture Debate: Orchestrator')];
    sessionState.sessionMessages = {
      'session-1': [{
        id: 'assistant-timeout',
        sessionId: 'session-1',
        role: 'assistant',
        content: 'Sub-agent failed: Sub-agent timed out after 300000ms.',
        createdAt: 2,
      }],
    };
    agentState.runtimeActivitySnapshots = {
      'session-1': {
        ...makeWaitingRuntimeSnapshot('session-1'),
        updatedAt: 2,
      },
    };

    render(<ConversationManagerPanel />);

    expect(screen.getByTestId('runtime-attention-session-1')).toHaveTextContent('Sub-agent timed out');
    expect(screen.queryByText(/No active agent runs/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Resume AgentFlow' })).not.toBeInTheDocument();
    expect(resumeAgentFlowRun).not.toHaveBeenCalled();
  });

  it('splits running and finished tool rows and shows llm activity counts', () => {
    agentState.toolActivities = [
      makeToolActivity({ callId: 'call-running', toolName: 'web_search', status: 'running' }),
      makeToolActivity({
        callId: 'call-done',
        toolName: 'memory_search',
        status: 'success',
        finishedAt: 5,
      }),
    ];
    agentState.llmActivities = [
      { id: 'llm-1', label: 'Generating title', status: 'running', startedAt: 1 },
      { id: 'llm-2', label: 'Summarizing results', status: 'done', startedAt: 1, finishedAt: 2 },
      { id: 'llm-3', label: 'Retry failed', status: 'error', startedAt: 1, finishedAt: 2 },
    ];

    render(<ConversationManagerPanel />);

    expect(screen.getByText('Agent running')).toBeInTheDocument();
    expect(screen.getByText('2 calls · 3 llm')).toBeInTheDocument();
    expect(screen.getAllByTestId('tool-activity-row-mock')).toHaveLength(2);
    expect(screen.getByText('Generating title')).toBeInTheDocument();
    expect(screen.getByText('Summarizing results')).toBeInTheDocument();
    expect(screen.getByText('Retry failed')).toBeInTheDocument();
  });

  it('does not report a running agent from a stale global streaming flag alone', () => {
    render(<ConversationManagerPanel />);

    expect(screen.getByText(/No active agent runs/i)).toBeInTheDocument();
    expect(screen.queryByText('Agent running')).not.toBeInTheDocument();
  });

  it('lets the user remove inactive finished activity from the active panel', () => {
    agentState.toolActivities = [
      makeToolActivity({ callId: 'call-running', toolName: 'web_search', status: 'running' }),
      makeToolActivity({
        callId: 'call-done',
        toolName: 'memory_search',
        status: 'success',
        finishedAt: 5,
      }),
    ];
    agentState.llmActivities = [
      { id: 'llm-1', label: 'Generating title', status: 'running', startedAt: 1 },
      { id: 'llm-2', label: 'Summarizing results', status: 'done', startedAt: 1, finishedAt: 2 },
    ];

    render(<ConversationManagerPanel />);

    fireEvent.click(screen.getByTestId('clear-inactive-agents'));
    expect(agentState.clearInactiveActivities).toHaveBeenCalledTimes(1);
  });
});
