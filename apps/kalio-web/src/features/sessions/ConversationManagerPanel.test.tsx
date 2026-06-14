import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { ChatSession } from '@kalio/types';
import type { LlmActivity, ToolActivity } from '../../store/agentStore';

type AgentStateShape = {
  pendingConfirmations: Record<string, {
    requestId: string;
    toolCallId: string;
    sessionId: string;
    toolName: string;
    args: Record<string, unknown>;
    timeoutMs: number;
    agentRun?: { label?: string };
  }>;
  toolActivities: ToolActivity[];
  llmActivities: LlmActivity[];
  sessionToolActivities: Record<string, ToolActivity[]>;
  activeAgentLoops: Record<string, {
    sessionId: string;
    turnId: string;
    startedAt: number;
  }>;
  clearInactiveActivities: () => void;
};

type SessionStateShape = {
  sessions: ChatSession[];
};

const { stopTurn, agentState, sessionState } = vi.hoisted(() => ({
  stopTurn: vi.fn(),
  agentState: {
    pendingConfirmations: {} as Record<string, {
      requestId: string;
      toolCallId: string;
      sessionId: string;
      toolName: string;
      args: Record<string, unknown>;
      timeoutMs: number;
      agentRun?: { label?: string };
    }>,
    toolActivities: [] as ToolActivity[],
    llmActivities: [] as LlmActivity[],
    sessionToolActivities: {} as Record<string, ToolActivity[]>,
    activeAgentLoops: {} as Record<string, {
      sessionId: string;
      turnId: string;
      startedAt: number;
    }>,
    clearInactiveActivities: vi.fn(),
  } satisfies AgentStateShape,
  sessionState: {
    sessions: [] as ChatSession[],
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

describe('ConversationManagerPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    agentState.pendingConfirmations = {};
    agentState.toolActivities = [];
    agentState.llmActivities = [];
    agentState.sessionToolActivities = {};
    agentState.activeAgentLoops = {};
    agentState.clearInactiveActivities = vi.fn();
    sessionState.sessions = [];
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
      'session-hitl': {
        requestId: 'req-open',
        toolCallId: 'call-open',
        sessionId: 'session-hitl',
        toolName: 'fs_write',
        args: { filePath: 'README.md' },
        timeoutMs: 0,
        agentRun: { label: 'Implementer' },
      },
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
    agentState.activeAgentLoops = {
      'session-1': {
        sessionId: 'session-1',
        turnId: 'turn-1',
        startedAt: 1,
      },
    };

    render(<ConversationManagerPanel />);

    expect(screen.getByTestId('active-loop-session-1')).toHaveTextContent('Cats Session');
    fireEvent.click(screen.getByTestId('stop-loop-session-1'));
    expect(stopTurn).toHaveBeenCalledWith('session-1');
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
