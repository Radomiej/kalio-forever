import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
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
    scope?: 'chat' | 'subagent' | 'agent-flow-branch';
    usedIterations: number;
    currentLimit: number;
    suggestedNextLimit?: number;
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

const {
  stopTurn,
  resumeAgentFlowRun,
  approveRaApp,
  cancelRaApp,
  identifySession,
  approveAgentBudget,
  getPendingRAAppApprovals,
  agentState,
  sessionState,
} = vi.hoisted(() => ({
  stopTurn: vi.fn(),
  resumeAgentFlowRun: vi.fn(),
  approveRaApp: vi.fn(),
  cancelRaApp: vi.fn(),
  identifySession: vi.fn(),
  approveAgentBudget: vi.fn(),
  getPendingRAAppApprovals: vi.fn().mockResolvedValue([]),
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
      scope?: 'chat' | 'subagent' | 'agent-flow-branch';
      usedIterations: number;
      currentLimit: number;
      suggestedNextLimit?: number;
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
    approveRaApp,
    cancelRaApp,
    identifySession,
    approveAgentBudget,
  },
}));

vi.mock('../../services/apiClient', () => ({
  getPendingRAAppApprovals,
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

function makePersistedRuntimeSession(id: string, title: string, updatedAt: number): ChatSession {
  return {
    ...makeSession(id, title),
    kind: 'subagent',
    updatedAt,
  };
}

function makeRuntimeErrorMessage(
  sessionId: string,
  createdAt: number,
  detail = 'Runtime error',
): ChatMessage {
  return {
    id: `runtime-error-${sessionId}`,
    sessionId,
    role: 'tool_result',
    content: JSON.stringify({
      toolResultErrorCode: 'TOOL_RUNTIME_ERROR',
      toolResultErrorMessage: detail,
    }),
    createdAt,
  };
}

function makeWaitingRuntimeSnapshot(sessionId: string): RuntimeActivitySnapshot {
  const now = Date.now();
  return {
    sessionId,
    active: false,
    turnId: 'turn-1',
    queueLength: 0,
    pendingConfirmations: [],
    pendingBudgetApprovals: [],
    toolActivities: [],
    childExecutions: [],
    updatedAt: now,
    run: {
      id: 'run-1',
      sessionId,
      turnId: 'turn-1',
      phase: 'tool_running',
      status: 'waiting_on_orchestrator',
      retryCount: 0,
      safeResume: true,
      startedAt: 1,
      updatedAt: now,
      lastHeartbeatAt: now,
    } as unknown as RuntimeActivitySnapshot['run'],
  };
}

function makeInterruptedRuntimeSnapshot(sessionId: string): RuntimeActivitySnapshot {
  const now = Date.now();
  return {
    sessionId,
    active: false,
    turnId: 'turn-1',
    queueLength: 0,
    pendingConfirmations: [],
    pendingBudgetApprovals: [],
    toolActivities: [],
    childExecutions: [],
    updatedAt: now,
    run: {
      id: 'run-1',
      sessionId,
      turnId: 'turn-1',
      phase: 'tool_running',
      status: 'interrupted_needs_retry',
      retryCount: 1,
      safeResume: false,
      startedAt: 1,
      updatedAt: now,
      lastHeartbeatAt: now,
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

  afterEach(() => {
    vi.useRealTimers();
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

  it('renders RA-App pending approvals in the HITL inbox and resolves them through raapp events', () => {
    const onOpenSession = vi.fn();
    sessionState.sessions = [makeSession('session-raapp', 'Interactive RA-App')];
    sessionState.sessionMessages = {
      'session-raapp': [{
        id: 'raapp-tool-result',
        sessionId: 'session-raapp',
        role: 'tool_result',
        toolCallId: 'call-raapp',
        content: JSON.stringify({
          status: 'ready',
          type: 'html',
          mode: 'interactive',
          content: '<p>Approve operation</p>',
          pendingApprovals: [
            {
              id: 'approval-raapp-approve',
              system: 'vfs_write',
              displayLabel: 'write architecture.md',
              args: { path: 'architecture.md' },
            },
            {
              id: 'approval-raapp-reject',
              system: 'vfs_write',
              displayLabel: 'write draft.md',
              args: { path: 'draft.md' },
            },
          ],
        }),
        createdAt: 2,
      }],
    };

    render(<ConversationManagerPanel onOpenSession={onOpenSession} />);

    expect(screen.getByTestId('home-hitl-inbox')).toHaveTextContent('RA-App approval');
    expect(screen.getByTestId('home-hitl-inbox')).toHaveTextContent('write architecture.md');

    fireEvent.click(screen.getByTestId('home-hitl-open-raapp-approval-raapp-approve'));
    expect(onOpenSession).toHaveBeenCalledWith('session-raapp');

    fireEvent.click(screen.getByTestId('home-hitl-approve-raapp-approval-raapp-approve'));
    expect(identifySession).toHaveBeenCalledWith('session-raapp');
    expect(approveRaApp).toHaveBeenCalledWith({
      sessionId: 'session-raapp',
      requestIds: ['approval-raapp-approve'],
    });

    fireEvent.click(screen.getByTestId('home-hitl-reject-raapp-approval-raapp-reject'));
    expect(identifySession).toHaveBeenCalledWith('session-raapp');
    expect(cancelRaApp).toHaveBeenCalledWith({
      sessionId: 'session-raapp',
      requestIds: ['approval-raapp-reject'],
    });
  });

  it('hydrates RA-App pending approvals from the backend when the session transcript is not loaded', async () => {
    const onOpenSession = vi.fn();
    getPendingRAAppApprovals.mockResolvedValueOnce([{
      id: 'approval-from-api',
      sessionId: 'session-raapp-api',
      toolCallId: 'call-raapp-api',
      system: 'vfs_write',
      displayLabel: 'write from durable pending table',
      args: { path: 'durable.md' },
      status: 'pending',
      createdAt: 2,
    }]);
    sessionState.sessions = [makeSession('session-raapp-api', 'Durable RA-App')];

    render(<ConversationManagerPanel onOpenSession={onOpenSession} />);

    expect(await screen.findByTestId('home-hitl-open-raapp-approval-from-api')).toBeInTheDocument();
    expect(screen.getByTestId('home-hitl-inbox')).toHaveTextContent('write from durable pending table');
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

  it('renders tool-loop budget progress from runtime snapshots', () => {
    sessionState.sessions = [makeSession('session-budget', 'Goal Guard')];
    agentState.runtimeActivitySnapshots = {
      'session-budget': {
        sessionId: 'session-budget',
        active: true,
        turnId: 'turn-1',
        queueLength: 0,
        pendingConfirmations: [],
        pendingBudgetApprovals: [],
        toolBudgetProgress: {
          sessionId: 'session-budget',
          turnId: 'turn-1',
          usedIterations: 6,
          currentLimit: 8,
          status: 'running',
          runtimeKind: 'subagent',
          updatedAt: 10,
        },
        toolActivities: [],
        childExecutions: [],
        updatedAt: 10,
      },
    };

    render(<ConversationManagerPanel />);

    expect(screen.getByTestId('tool-budget-progress-session-budget')).toHaveTextContent('Goal Guard');
    expect(screen.getByTestId('tool-budget-progress-session-budget')).toHaveTextContent('6/8');
  });

  it('renders pending budget approvals as actionable HITL cards and approves +10', () => {
    const onOpenSession = vi.fn();
    sessionState.sessions = [makeSession('session-budget', 'Goal Guard Budget')];
    agentState.pendingBudgetApprovals = {
      'session-budget': [{
        requestId: 'budget-1',
        sessionId: 'session-budget',
        scope: 'agent-flow-branch',
        usedIterations: 30,
        currentLimit: 30,
      }],
    };
    agentState.runtimeActivitySnapshots = {
      'session-budget': {
        sessionId: 'session-budget',
        active: true,
        turnId: 'turn-budget',
        queueLength: 0,
        pendingConfirmations: [],
        pendingBudgetApprovals: [{
          requestId: 'budget-1',
          sessionId: 'session-budget',
          scope: 'agent-flow-branch',
          usedIterations: 30,
          currentLimit: 30,
          suggestedNextLimit: 40,
        }],
        toolActivities: [],
        childExecutions: [],
        updatedAt: 10,
      },
    };

    render(<ConversationManagerPanel onOpenSession={onOpenSession} />);

    expect(screen.getByTestId('home-hitl-inbox')).toHaveTextContent('Agent budget approval');
    expect(screen.getByTestId('home-hitl-inbox')).toHaveTextContent('30/30');
    expect(screen.getByTestId('home-hitl-inbox')).toHaveTextContent('+10 to 40');

    fireEvent.click(screen.getByTestId('home-hitl-open-budget-budget-1'));
    expect(onOpenSession).toHaveBeenCalledWith('session-budget');

    fireEvent.click(screen.getByTestId('home-hitl-approve-budget-budget-1'));
    expect(approveAgentBudget).toHaveBeenCalledWith({
      requestId: 'budget-1',
      sessionId: 'session-budget',
      decision: 'allow_ten',
    });
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

  it('renders a resumable AgentFlow action and posts a generic resume request', async () => {
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
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Resume AgentFlow' }));
      await Promise.resolve();
    });

    expect(resumeAgentFlowRun).toHaveBeenCalledWith('flow-run-1', { input: 'Continue.' });
  });

  it('surfaces typed timeout evidence instead of leaving the active panel empty behind a warning badge', () => {
    sessionState.sessions = [makeSession('session-1', 'Architecture Debate: Orchestrator')];
    sessionState.sessionMessages = {
      'session-1': [{
        id: 'tool-timeout',
        sessionId: 'session-1',
        role: 'tool_result',
        content: JSON.stringify({
          toolResultErrorCode: 'SUBAGENT_TIMEOUT',
          toolResultErrorMessage: 'Sub-agent timed out after 300000ms.',
        }),
        createdAt: 2,
      }],
    };
    agentState.runtimeActivitySnapshots = {
      'session-1': {
        ...makeWaitingRuntimeSnapshot('session-1'),
        updatedAt: Date.now(),
      },
    };

    render(<ConversationManagerPanel />);

    expect(screen.getByTestId('runtime-attention-session-1')).toHaveTextContent('Sub-agent timed out');
    expect(screen.queryByText(/No active agent runs/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Resume AgentFlow' })).not.toBeInTheDocument();
    expect(resumeAgentFlowRun).not.toHaveBeenCalled();
  });

  it('does not render generic assistant summary text as runtime attention detail', () => {
    sessionState.sessions = [makeSession('session-1', 'AI capabilities inquiry')];
    sessionState.sessionMessages = {
      'session-1': [{
        id: 'assistant-summary',
        sessionId: 'session-1',
        role: 'assistant',
        content: 'Escalate critical events to you immediately (e.g., errors, blockers, decisions needed).',
        createdAt: 2,
      }],
    };
    agentState.runtimeActivitySnapshots = {
      'session-1': makeWaitingRuntimeSnapshot('session-1'),
    };

    render(<ConversationManagerPanel />);

    const row = screen.getByTestId('runtime-attention-session-1');
    expect(row).toHaveTextContent('Waiting on orchestrator');
    expect(row).not.toHaveTextContent('Escalate critical events');
  });

  it('keeps long typed runtime attention details compact while exposing the full detail in the accessible name', () => {
    const longDetail = 'Runtime failed: ' + 'The child run exhausted the browser tool window. '.repeat(6).trim();
    sessionState.sessions = [makeSession('session-1', 'QA Guard')];
    sessionState.sessionMessages = {
      'session-1': [{
        id: 'tool-runtime-error',
        sessionId: 'session-1',
        role: 'tool_result',
        content: JSON.stringify({
          toolResultErrorCode: 'TOOL_RUNTIME_ERROR',
          toolResultErrorMessage: longDetail,
        }),
        createdAt: 2,
      }],
    };
    agentState.runtimeActivitySnapshots = {
      'session-1': makeWaitingRuntimeSnapshot('session-1'),
    };

    render(<ConversationManagerPanel />);

    const row = screen.getByTestId('runtime-attention-session-1');
    expect(row).toHaveAttribute('aria-label', `QA Guard. ${longDetail}`);
    expect(screen.getByTestId('runtime-attention-detail-session-1')).toHaveClass('max-h-14', 'overflow-hidden');
  });

  it('renders runtime attention as a dismissible recent notice limited to the latest items', () => {
    const now = 60 * 60 * 1000;
    vi.useFakeTimers();
    vi.setSystemTime(now);
    sessionState.sessions = [
      makePersistedRuntimeSession('session-newest', 'Strategic Decision Council: Analyst', now - 1_000),
      makePersistedRuntimeSession('session-second', 'Strategic Decision Council: Shadow', now - 2_000),
      makePersistedRuntimeSession('session-third', 'Strategic Decision Council: User Advocate', now - 3_000),
      makePersistedRuntimeSession('session-fourth', 'Architecture Debate: Orchestrator', now - 4_000),
      makePersistedRuntimeSession('session-old', 'Old recovered run', now - (6 * 60 * 1000)),
    ];
    sessionState.sessionMessages = {
      'session-newest': [makeRuntimeErrorMessage('session-newest', now - 1_000, 'NOT_A_FILE: C:\\Project\\packages\\shared')],
      'session-second': [makeRuntimeErrorMessage('session-second', now - 2_000, 'NOT_A_FILE: C:\\Project\\apps\\backend')],
      'session-third': [makeRuntimeErrorMessage('session-third', now - 3_000, 'NOT_A_DIRECTORY: C:\\Project\\apps\\backend\\src')],
      'session-fourth': [makeRuntimeErrorMessage('session-fourth', now - 4_000, 'Runtime error')],
      'session-old': [makeRuntimeErrorMessage('session-old', now - (6 * 60 * 1000), 'Runtime error')],
    };
    render(<ConversationManagerPanel />);

    expect(screen.getByTestId('runtime-attention-notice')).toHaveTextContent('4 runtime issues in the last 5 minutes');
    expect(screen.getAllByTestId(/^runtime-attention-row-/)).toHaveLength(3);
    expect(screen.getByTestId('runtime-attention-row-session-newest')).toHaveTextContent('Strategic Decision Council: Analyst');
    expect(screen.getByTestId('runtime-attention-row-session-second')).toHaveTextContent('Strategic Decision Council: Shadow');
    expect(screen.getByTestId('runtime-attention-row-session-third')).toHaveTextContent('Strategic Decision Council: User Advocate');
    expect(screen.queryByTestId('runtime-attention-row-session-fourth')).not.toBeInTheDocument();
    expect(screen.queryByTestId('runtime-attention-row-session-old')).not.toBeInTheDocument();
    expect(screen.getByText('Needs attention')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss runtime attention notice' }));

    expect(screen.queryByTestId('runtime-attention-notice')).not.toBeInTheDocument();
    expect(screen.getByText('Needs attention')).toBeInTheDocument();
  });

  it('persists reviewed runtime notices across reload while keeping active approvals visible', () => {
    const now = 60 * 60 * 1000;
    vi.useFakeTimers();
    vi.setSystemTime(now);
    sessionState.sessions = [
      makePersistedRuntimeSession('session-issue', 'Failed workflow', now - 1_000),
    ];
    sessionState.sessionMessages = {
      'session-issue': [makeRuntimeErrorMessage('session-issue', now - 1_000, 'Runtime error')],
    };
    const firstRender = render(<ConversationManagerPanel />);

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss runtime attention notice' }));
    expect(screen.queryByTestId('runtime-attention-notice')).not.toBeInTheDocument();

    firstRender.unmount();
    const secondRender = render(<ConversationManagerPanel />);

    expect(screen.queryByTestId('runtime-attention-notice')).not.toBeInTheDocument();

    agentState.pendingConfirmations = {
      'session-hitl': [{
        requestId: 'req-hitl',
        toolCallId: 'call-hitl',
        sessionId: 'session-hitl',
        toolName: 'fs_write',
        args: { path: 'architecture.md' },
        timeoutMs: 0,
      }],
    };
    sessionState.sessions.push(makeSession('session-hitl', 'Tool approval'));

    secondRender.rerender(<ConversationManagerPanel />);

    expect(screen.getByTestId('home-hitl-inbox')).toBeInTheDocument();
    expect(screen.getByTestId('home-hitl-approve-req-hitl')).toBeInTheDocument();
  });

  it('auto-expires recent runtime attention notice after the recent window elapses', () => {
    const now = 60 * 60 * 1000;
    vi.useFakeTimers();
    vi.setSystemTime(now);
    sessionState.sessions = [
      makePersistedRuntimeSession('session-expiring', 'Expiring runtime run', now - ((5 * 60 * 1000) - 500)),
    ];
    sessionState.sessionMessages = {
      'session-expiring': [makeRuntimeErrorMessage('session-expiring', now - ((5 * 60 * 1000) - 500), 'Runtime error')],
    };

    render(<ConversationManagerPanel />);

    expect(screen.getByTestId('runtime-attention-notice')).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(1_000);
    });

    expect(screen.queryByTestId('runtime-attention-notice')).not.toBeInTheDocument();
    expect(screen.getByText('Needs attention')).toBeInTheDocument();
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

  it('does not keep stale tool activity running after typed runtime recovery', () => {
    sessionState.sessions = [makeSession('session-retry', 'Codex Live Tool HITL')];
    agentState.runtimeActivitySnapshots = {
      'session-retry': makeInterruptedRuntimeSnapshot('session-retry'),
    };
    agentState.toolActivities = [
      makeToolActivity({
        callId: 'call-retry',
        sessionId: 'session-retry',
        toolName: 'vfs_write',
        status: 'running',
      }),
    ];

    render(<ConversationManagerPanel />);

    expect(screen.getByTestId('runtime-attention-session-retry')).toHaveTextContent(
      'Backend restarted during tool execution',
    );
    expect(screen.getByText('Needs attention')).toBeInTheDocument();
    expect(screen.queryByText('Agent running')).not.toBeInTheDocument();
    expect(screen.getByTestId('tool-activity-row-mock')).toHaveTextContent('vfs_write:expired');
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
