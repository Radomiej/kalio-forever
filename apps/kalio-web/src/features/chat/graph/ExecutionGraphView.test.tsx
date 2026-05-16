import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatSession } from '@kalio/types';
import type { ToolActivity } from '../../../store/agentStore';
import { ExecutionGraphView } from './ExecutionGraphView';

type SessionStateShape = {
  activeSessionId: string | null;
  messages: unknown[];
  agentTurns: unknown[];
  sessions: ChatSession[];
  sessionMessages: Record<string, unknown[]>;
  setActiveSession: ReturnType<typeof vi.fn>;
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
};

const { sessionState, agentState } = vi.hoisted(() => ({
  sessionState: {
    activeSessionId: null as string | null,
    messages: [] as unknown[],
    agentTurns: [] as unknown[],
    sessions: [] as ChatSession[],
    sessionMessages: {} as Record<string, unknown[]>,
    setActiveSession: vi.fn(),
  },
  agentState: {
    toolActivities: [] as ToolActivity[],
    activeAgentLoops: {} as Record<string, AgentLoopShape>,
  },
}));

vi.mock('../../../store/sessionStore', () => ({
  useSessionStore: (selector?: (state: SessionStateShape) => unknown) => selector ? selector(sessionState) : sessionState,
}));

vi.mock('../../../store/agentStore', () => ({
  useAgentStore: (selector?: (state: AgentStateShape) => unknown) => selector ? selector(agentState) : agentState,
}));

describe('ExecutionGraphView empty-session state', () => {
  beforeEach(() => {
    sessionState.activeSessionId = null;
    sessionState.messages = [];
    sessionState.agentTurns = [];
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
  });

  it('shows session suggestions and live agent activity when no session is selected', () => {
    render(<ExecutionGraphView />);

    expect(screen.getByText('Pick a session or inspect live activity')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open session Main UI task from graph overview' })).toBeInTheDocument();
    expect(screen.getAllByText('UX Designer').length).toBeGreaterThan(0);
    expect(screen.getAllByText('run_subagent').length).toBeGreaterThan(0);
  });

  it('opens a suggested session from the empty graph state', () => {
    render(<ExecutionGraphView />);

    fireEvent.click(screen.getByRole('button', { name: 'Open session Main UI task from graph overview' }));

    expect(sessionState.setActiveSession).toHaveBeenCalledWith('session-1');
  });

  it('keeps the graph shell visible when the active session has no execution nodes yet', () => {
    sessionState.activeSessionId = 'session-1';

    render(<ExecutionGraphView />);

    expect(screen.getByRole('heading', { name: 'Execution Graph' })).toBeInTheDocument();
    expect(screen.getByText('No execution nodes yet for this session.')).toBeInTheDocument();
  });
});