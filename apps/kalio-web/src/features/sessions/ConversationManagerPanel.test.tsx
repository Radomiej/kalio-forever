import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { ChatSession } from '@kalio/types';
import type { LlmActivity, ToolActivity } from '../../store/agentStore';

type AgentStateShape = {
  isStreaming: boolean;
  toolActivities: ToolActivity[];
  llmActivities: LlmActivity[];
  activeAgentLoops: Record<string, {
    sessionId: string;
    turnId: string;
    startedAt: number;
  }>;
};

type SessionStateShape = {
  sessions: ChatSession[];
};

const { stopTurn, agentState, sessionState } = vi.hoisted(() => ({
  stopTurn: vi.fn(),
  agentState: {
    isStreaming: false as boolean,
    toolActivities: [] as ToolActivity[],
    llmActivities: [] as LlmActivity[],
    activeAgentLoops: {} as Record<string, {
      sessionId: string;
      turnId: string;
      startedAt: number;
    }>,
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
    agentState.isStreaming = false;
    agentState.toolActivities = [];
    agentState.llmActivities = [];
    agentState.activeAgentLoops = {};
    sessionState.sessions = [];
  });

  it('shows the empty state and lets the user navigate back to chat', () => {
    const onNavigate = vi.fn();

    render(<ConversationManagerPanel onNavigate={onNavigate} />);

    expect(screen.getByText(/No active agent runs/i)).toBeInTheDocument();
    fireEvent.click(screen.getByText(/Go to chat/i));
    expect(onNavigate).toHaveBeenCalledTimes(1);
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
    agentState.isStreaming = true;
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
});
