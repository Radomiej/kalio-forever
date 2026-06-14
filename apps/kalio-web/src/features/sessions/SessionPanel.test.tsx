import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { SessionPanel } from './SessionPanel';
import { formatRelativeTime } from './session.utils';
import type { ChatMessage, ChatSession, Persona } from '@kalio/types';
import { DEFAULT_TEST_PERSONA_AVATAR } from '../../test/personaFixtures';
import type { AgentTurn } from '../../store/sessionStore';

// ── Mocks ─────────────────────────────────────────────────────────────────────

const mockSetSessions = vi.fn();
const mockSetActiveSession = vi.fn();
const mockAddSession = vi.fn();
const mockSetMessages = vi.fn();
const mockSetAgentTurns = vi.fn();
const mockRemoveSession = vi.fn();
const mockUpdateSession = vi.fn();

const mockSessions: ChatSession[] = [
  { id: 's1', personaId: 'p1', title: 'Chat about React', createdAt: 1000, updatedAt: Date.now() - 2 * 60_000 },
  { id: 's2', personaId: 'default', title: 'New Chat', createdAt: 2000, updatedAt: Date.now() - 30_000 },
  { id: 'sub-1', personaId: 'default', title: 'Sub-agent: Landing page', kind: 'subagent', parentSessionId: 's1', createdAt: 2500, updatedAt: Date.now() - 90_000 },
];

function chooseOriginFilter(filterId: 'all' | 'user' | 'agent' | 'archived'): void {
  fireEvent.click(screen.getByTestId('session-origin-filter-trigger'));
  fireEvent.click(screen.getByTestId(`session-origin-filter-${filterId}`));
}

const mockPersonas: Persona[] = [
  { id: 'p1', name: 'Dev Assistant', systemPrompt: 'You are…', model: 'claude', allowedTools: [], skillIds: [], mcpPolicy: 'allow_all', ...DEFAULT_TEST_PERSONA_AVATAR, createdAt: 0, updatedAt: 0 },
];

const mockState: {
  sessions: ChatSession[];
  activeSessionId: string | null;
  setSessions: typeof mockSetSessions;
  setActiveSession: typeof mockSetActiveSession;
  addSession: typeof mockAddSession;
  setMessages: typeof mockSetMessages;
  setAgentTurns: typeof mockSetAgentTurns;
  sessionAgentTurns: Record<string, AgentTurn[]>;
  sessionMessages: Record<string, ChatMessage[]>;
  getSessionMessages: (sessionId: string | null) => ChatMessage[];
  getSessionActiveTurnId: (sessionId: string | null) => string | null;
  removeSession: typeof mockRemoveSession;
  updateSession: typeof mockUpdateSession;
} = {
  sessions: mockSessions,
  activeSessionId: 's1',
  setSessions: mockSetSessions,
  setActiveSession: mockSetActiveSession,
  addSession: mockAddSession,
  setMessages: mockSetMessages,
  setAgentTurns: mockSetAgentTurns,
  sessionAgentTurns: {},
  sessionMessages: {},
  getSessionMessages: (sessionId) => (sessionId ? (mockState.sessionMessages[sessionId] ?? []) : []),
  getSessionActiveTurnId: () => null,
  removeSession: mockRemoveSession,
  updateSession: mockUpdateSession,
};

vi.mock('../../store/sessionStore', () => ({
  useSessionStore: Object.assign(
    (selector?: (s: typeof mockState) => unknown) =>
      selector ? selector(mockState) : mockState,
    {
      getState: () => mockState,
    },
  ),
}));

const mockApiGet = vi.fn();
const mockApiPost = vi.fn();
const mockApiDelete = vi.fn();
const mockApiPatch = vi.fn();

vi.mock('../../services/apiClient', () => ({
  apiClient: {
    get: (...args: unknown[]) => mockApiGet(...args),
    post: (...args: unknown[]) => mockApiPost(...args),
    delete: (...args: unknown[]) => mockApiDelete(...args),
    patch: (...args: unknown[]) => mockApiPatch(...args),
  },
}));

// ── agentStore mock ───────────────────────────────────────────────────────────

const mockSetPendingConfirmation = vi.hoisted(() => vi.fn());
const mockSetPendingBudgetApproval = vi.hoisted(() => vi.fn());
const mockClearSessionStatusSnapshot = vi.hoisted(() => vi.fn());
const mockAgentState = vi.hoisted(() => ({
  pendingConfirmations: {} as Record<string, unknown>,
  pendingBudgetApprovals: {} as Record<string, unknown>,
  activeAgentLoops: {} as Record<string, { sessionId: string }>,
  queuedDepthBySession: {} as Record<string, number>,
  sessionStatusSnapshots: {} as Record<string, import('@kalio/types').SocketEvents['session:status']>,
  sessionToolActivities: {} as Record<string, import('../../store/agentStore').ToolActivity[]>,
  hasActiveLoopForSession: () => false,
  setPendingConfirmation: mockSetPendingConfirmation,
  setPendingBudgetApproval: mockSetPendingBudgetApproval,
  clearSessionStatusSnapshot: mockClearSessionStatusSnapshot,
}));

vi.mock('../../store/agentStore', () => ({
  useAgentStore: Object.assign(
    (selector?: (s: {
      pendingConfirmations: Record<string, unknown>;
      pendingBudgetApprovals: Record<string, unknown>;
      activeAgentLoops: Record<string, { sessionId: string }>;
      queuedDepthBySession: Record<string, number>;
      sessionStatusSnapshots: Record<string, import('@kalio/types').SocketEvents['session:status']>;
      sessionToolActivities: Record<string, import('../../store/agentStore').ToolActivity[]>;
      hasActiveLoopForSession: (sessionId: string | null) => boolean;
      setPendingConfirmation: typeof mockSetPendingConfirmation;
      setPendingBudgetApproval: typeof mockSetPendingBudgetApproval;
      clearSessionStatusSnapshot: typeof mockClearSessionStatusSnapshot;
    }) => unknown) => {
      return selector ? selector(mockAgentState) : mockAgentState;
    },
    {
      getState: () => mockAgentState,
    },
  ),
}));

// ── formatRelativeTime unit tests ─────────────────────────────────────────────

describe('formatRelativeTime', () => {
  it('returns "just now" for < 1 minute', () => {
    expect(formatRelativeTime(Date.now() - 30_000)).toBe('just now');
  });

  it('returns "Xm ago" for < 1 hour', () => {
    expect(formatRelativeTime(Date.now() - 5 * 60_000)).toBe('5m ago');
    expect(formatRelativeTime(Date.now() - 59 * 60_000)).toBe('59m ago');
  });

  it('returns "Xh ago" for < 24 hours', () => {
    expect(formatRelativeTime(Date.now() - 3 * 3_600_000)).toBe('3h ago');
  });

  it('returns "yesterday" for ~24h ago', () => {
    expect(formatRelativeTime(Date.now() - 25 * 3_600_000)).toBe('yesterday');
  });

  it('returns "Xd ago" for 2-6 days ago', () => {
    expect(formatRelativeTime(Date.now() - 3 * 86_400_000)).toBe('3d ago');
  });

  it('returns locale date string for 7+ days ago', () => {
    const ts = Date.now() - 10 * 86_400_000;
    expect(formatRelativeTime(ts)).toBe(new Date(ts).toLocaleDateString());
  });
});

// ── SessionPanel component tests ──────────────────────────────────────────────

describe('SessionPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    mockState.sessions = mockSessions;
    mockState.activeSessionId = 's1';
    mockState.sessionAgentTurns = {};
    mockState.sessionMessages = {};
    mockAgentState.pendingConfirmations = {};
    mockAgentState.pendingBudgetApprovals = {};
    mockAgentState.activeAgentLoops = {};
    mockAgentState.queuedDepthBySession = {};
    mockAgentState.sessionStatusSnapshots = {};
    mockAgentState.sessionToolActivities = {};
    mockAgentState.hasActiveLoopForSession = () => false;
    mockSetActiveSession.mockImplementation((id: string | null) => {
      mockState.activeSessionId = id;
    });
    mockApiGet.mockImplementation((url: string) => {
      if (url === '/api/sessions') return Promise.resolve({ data: mockSessions });
      if (url === '/api/personas') return Promise.resolve({ data: mockPersonas });
      return Promise.resolve({ data: [] });
    });
  });

  it('renders session titles', async () => {
    render(<SessionPanel />);
    await waitFor(() => expect(mockSetSessions).toHaveBeenCalledWith(mockSessions));
    expect(screen.getByText('Chat about React')).toBeTruthy();
    expect(screen.getByText('New Chat')).toBeTruthy();
    expect(screen.getByTestId('session-kind-icon-s1')).toHaveAttribute('aria-label', 'Root chat');
    expect(screen.getByTestId('session-kind-icon-s2')).toHaveAttribute('aria-label', 'Root chat');
  });

  it('shows persona badge for non-default persona', async () => {
    render(<SessionPanel />);
    await waitFor(() => expect(screen.getAllByText('Dev Assistant').length).toBeGreaterThanOrEqual(1));
  });

  it('does not show badge for default persona (no name found)', async () => {
    render(<SessionPanel />);
    await waitFor(() => expect(mockApiGet).toHaveBeenCalledWith('/api/personas'));
    // s2 uses personaId 'default' which has no persona in mockPersonas → no badge
    const badges = screen.queryAllByText('default');
    expect(badges).toHaveLength(0);
  });

  it('shows relative timestamps', async () => {
    render(<SessionPanel />);
    await waitFor(() => expect(screen.getAllByText('2m ago').length).toBeGreaterThan(0));
  });

  it('hides child subagent sessions from the default conversation list', async () => {
    render(<SessionPanel />);
    await waitFor(() => expect(mockSetSessions).toHaveBeenCalledWith(mockSessions));

    expect(screen.queryByText('Sub-agent: Landing page')).toBeNull();
    expect(screen.queryByTestId('subagent-session-badge-sub-1')).toBeNull();
    expect(screen.getByText('2 chats')).toBeTruthy();
  });

  it('expands child conversations from a parent in the default conversation list', async () => {
    render(<SessionPanel />);
    await waitFor(() => expect(mockSetSessions).toHaveBeenCalledWith(mockSessions));

    expect(screen.queryByText('Sub-agent: Landing page')).toBeNull();
    const toggle = screen.getByTestId('toggle-session-children-s1');
    expect(toggle).toHaveTextContent('1');
    expect(toggle).toHaveClass('shrink-0');

    fireEvent.click(toggle);

    expect(screen.getByText('Sub-agent: Landing page')).toBeTruthy();
    expect(screen.getByTestId('subagent-session-badge-sub-1')).toBeTruthy();
  });

  it('does not show a child toggle when a workflow host only has technical descendants', async () => {
    const now = Date.now();
    const workflowSessions: ChatSession[] = [
      {
        id: 'host',
        personaId: 'default',
        title: 'New Chat',
        createdAt: now - 5_000,
        updatedAt: now - 5_000,
        runtimeContext: {
          runtimeKind: 'chat',
          architectureContext: {
            schemaId: 'strategic-decision-council',
            schemaName: 'Strategic Decision Council',
            displayLabel: 'Strategic Decision Council',
          },
        },
      },
      {
        id: 'arch-root',
        personaId: 'default',
        title: 'Architecture: Strategic Decision Council',
        kind: 'chat',
        parentSessionId: 'host',
        createdAt: now - 4_000,
        updatedAt: now - 4_000,
        runtimeContext: {
          runtimeKind: 'chat',
          architectureContext: {
            architectureRunId: 'run-live',
            schemaId: 'strategic-decision-council',
            schemaName: 'Strategic Decision Council',
            displayLabel: 'Strategic Decision Council',
          },
        },
      },
      {
        id: 'arch-router',
        personaId: 'orchestrator',
        title: 'Strategic Decision Council: Router',
        kind: 'subagent',
        parentSessionId: 'arch-root',
        createdAt: now - 3_000,
        updatedAt: now - 3_000,
        runtimeContext: {
          runtimeKind: 'agent-flow-branch',
          architectureSlotId: 'router',
          architectureContext: {
            architectureRunId: 'run-live',
            roleSlotId: 'router',
            roleSlotType: 'router',
            displayLabel: 'Router',
          },
        },
      },
    ];

    mockState.sessions = workflowSessions;
    mockState.sessionMessages = {
      host: [
        {
          id: 'host-summary',
          sessionId: 'host',
          role: 'assistant',
          content: '',
          createdAt: now - 1_000,
          architectureRun: {
            runId: 'run-live',
            schemaId: 'Strategic Decision Council',
            status: 'running',
            routeHops: [],
            trace: [],
            graphNodes: [
              { id: 'router', label: 'Router', kind: 'router', status: 'running', eventIds: ['event-router'] },
            ],
            graphEdges: [],
          } as ChatMessage['architectureRun'],
        },
      ],
      'arch-root': [],
      'arch-router': [],
    };
    mockApiGet.mockImplementation((url: string) => {
      if (url === '/api/sessions') return Promise.resolve({ data: workflowSessions });
      if (url === '/api/personas') return Promise.resolve({ data: mockPersonas });
      return Promise.resolve({ data: [] });
    });

    render(<SessionPanel />);
    await waitFor(() => expect(mockSetSessions).toHaveBeenCalledWith(workflowSessions));

    expect(screen.queryByTestId('toggle-session-children-host')).toBeNull();
    expect(screen.queryByText('Strategic Decision Council: Router')).toBeNull();
  });

  it('expands the full agent tree without replacing the parent chat title', async () => {
    const now = Date.now();
    const architectureSessions: ChatSession[] = [
      { id: 'host', personaId: 'default', title: 'New Chat', createdAt: now - 5000, updatedAt: now - 5000 },
      { id: 'flow-root', personaId: 'default', title: 'Architecture: Runtime MVP proof', kind: 'agent-flow', parentSessionId: 'host', createdAt: now - 4000, updatedAt: now - 4000 },
      { id: 'orchestrator', personaId: 'orchestrator', title: 'Goal Master Delivery Loop: Orchestrator', kind: 'subagent', parentSessionId: 'flow-root', createdAt: now - 3000, updatedAt: now - 3000 },
      { id: 'implementer', personaId: 'dev', title: 'Goal Master Delivery Loop: Implementer', kind: 'subagent', parentSessionId: 'flow-root', createdAt: now - 2000, updatedAt: now - 2000 },
      { id: 'cli-proof', personaId: 'dev', title: 'codex CLI: Write proof file', kind: 'cli-agent', parentSessionId: 'implementer', createdAt: now - 1000, updatedAt: now - 1000 },
    ];
    mockState.sessions = architectureSessions;
    mockApiGet.mockImplementation((url: string) => {
      if (url === '/api/sessions') return Promise.resolve({ data: architectureSessions });
      if (url === '/api/personas') return Promise.resolve({ data: mockPersonas });
      return Promise.resolve({ data: [] });
    });

    render(<SessionPanel />);
    await waitFor(() => expect(mockSetSessions).toHaveBeenCalledWith(architectureSessions));

    expect(screen.getByText('New Chat')).toBeTruthy();
    const toggle = screen.getByTestId('toggle-session-children-host');
    expect(toggle).toHaveTextContent('4');

    fireEvent.click(toggle);

    expect(screen.getByText('Architecture: Runtime MVP proof')).toBeTruthy();
    expect(screen.getByText('Goal Master Delivery Loop: Orchestrator')).toBeTruthy();
    expect(screen.getByText('Goal Master Delivery Loop: Implementer')).toBeTruthy();
    expect(screen.getByText('codex CLI: Write proof file')).toBeTruthy();
    expect(screen.getByTestId('session-kind-icon-flow-root')).toHaveAttribute('aria-label', 'AgentFlow');
    expect(screen.getByTestId('session-kind-icon-orchestrator')).toHaveAttribute('aria-label', 'Sub-agent');
    expect(screen.getByTestId('session-kind-icon-cli-proof')).toHaveAttribute('aria-label', 'CLI agent');
    expect(screen.getByTestId('cli-agent-session-badge-cli-proof')).toBeTruthy();
  });

  it('keeps large child counts compact in the conversation list', async () => {
    const now = Date.now();
    const manyChildren: ChatSession[] = [
      { id: 'root-many', personaId: 'default', title: 'Large orchestration root', createdAt: now, updatedAt: now },
      ...Array.from({ length: 120 }, (_, index) => ({
        id: `child-${index}`,
        personaId: 'default',
        title: `Sub-agent: ${index}`,
        kind: 'subagent' as const,
        parentSessionId: 'root-many',
        createdAt: now - index,
        updatedAt: now - index,
      })),
    ];
    mockState.sessions = manyChildren;
    mockApiGet.mockImplementation((url: string) => {
      if (url === '/api/sessions') return Promise.resolve({ data: manyChildren });
      if (url === '/api/personas') return Promise.resolve({ data: mockPersonas });
      return Promise.resolve({ data: [] });
    });

    render(<SessionPanel />);
    await waitFor(() => expect(mockSetSessions).toHaveBeenCalledWith(manyChildren));

    const toggle = screen.getByTestId('toggle-session-children-root-many');
    expect(toggle).toHaveTextContent('99+');
    expect(toggle).toHaveClass('shrink-0');
  });

  it('shows architecture branch statuses from parent run metadata after reload', async () => {
    const now = Date.now();
    const architectureSessions: ChatSession[] = [
      { id: 'host', personaId: 'default', title: 'Czym Jest Ten Projekt', createdAt: now - 6000, updatedAt: now - 6000 },
      {
        id: 'arch-run-root',
        personaId: 'default',
        title: 'Strategic Decision Council',
        kind: 'agent-flow',
        parentSessionId: 'host',
        runtimeContext: {
          runtimeKind: 'agent-flow-branch',
          architectureContext: {
            architectureRunId: 'run-live',
            schemaName: 'Strategic Decision Council',
            displayLabel: 'Strategic Decision Council',
          },
        },
        createdAt: now - 5000,
        updatedAt: now - 5000,
      },
      {
        id: 'arch-run-pragmatist',
        personaId: 'dev',
        title: 'Strategic Decision Council: Pragmatist',
        kind: 'subagent',
        parentSessionId: 'arch-run-root',
        runtimeContext: {
          runtimeKind: 'agent-flow-branch',
          parentToolCallId: 'architecture:run-live:pragmatist',
          architectureSlotId: 'pragmatist',
          architectureContext: { roleSlotId: 'pragmatist', displayLabel: 'Pragmatist' },
        },
        createdAt: now - 4000,
        updatedAt: now - 4000,
      },
      {
        id: 'arch-run-innovator',
        personaId: 'jony',
        title: 'Strategic Decision Council: Innovator',
        kind: 'subagent',
        parentSessionId: 'arch-run-root',
        runtimeContext: {
          runtimeKind: 'agent-flow-branch',
          parentToolCallId: 'architecture:run-live:innovator',
          architectureSlotId: 'innovator',
          architectureContext: { roleSlotId: 'innovator', displayLabel: 'Innovator' },
        },
        createdAt: now - 3000,
        updatedAt: now - 3000,
      },
      {
        id: 'arch-run-analyst',
        personaId: 'web-research',
        title: 'Strategic Decision Council: Analyst',
        kind: 'subagent',
        parentSessionId: 'arch-run-root',
        runtimeContext: {
          runtimeKind: 'agent-flow-branch',
          parentToolCallId: 'architecture:run-live:analyst',
          architectureSlotId: 'analyst',
          architectureContext: { roleSlotId: 'analyst', displayLabel: 'Analyst' },
        },
        createdAt: now - 2000,
        updatedAt: now - 2000,
      },
      {
        id: 'arch-run-shadow',
        personaId: 'orchestrator',
        title: 'Strategic Decision Council: Shadow',
        kind: 'subagent',
        parentSessionId: 'arch-run-root',
        runtimeContext: {
          runtimeKind: 'agent-flow-branch',
          parentToolCallId: 'architecture:run-live:shadow',
          architectureSlotId: 'shadow',
          architectureContext: { roleSlotId: 'shadow', displayLabel: 'Shadow' },
        },
        createdAt: now - 1000,
        updatedAt: now - 1000,
      },
    ];
    mockState.sessions = architectureSessions;
    mockState.sessionMessages = {
      host: [
        {
          id: 'architecture-run',
          sessionId: 'host',
          role: 'assistant',
          content: '',
          createdAt: now,
          architectureRun: {
            runId: 'run-live',
            schemaId: 'Strategic Decision Council',
            status: 'running',
            routeHops: [],
            trace: [
              {
                speaker: 'participant',
                content: 'Pragmatist answer.',
                eventId: 'event-pragmatist',
                nodeId: 'pragmatist',
                stream: {
                  streamGroupId: 'architecture:run-live:pragmatist',
                  branchSessionId: 'arch-run-pragmatist',
                  status: 'completed',
                  chunkCount: 3,
                  text: 'Pragmatist answer.',
                },
              },
              {
                speaker: 'participant',
                content: 'Shadow failed.',
                eventId: 'event-shadow',
                nodeId: 'shadow',
                incompleteReason: 'CLI child failed.',
                stream: {
                  streamGroupId: 'architecture:run-live:shadow',
                  branchSessionId: 'arch-run-shadow',
                  status: 'failed',
                  chunkCount: 1,
                  text: 'Shadow failed.',
                },
              },
            ],
            graphNodes: [
              { id: 'pragmatist', label: 'Pragmatist', kind: 'role', status: 'completed', eventIds: ['event-pragmatist'] },
              { id: 'innovator', label: 'Innovator', kind: 'role', status: 'running', eventIds: ['event-innovator'] },
              { id: 'analyst', label: 'Analyst', kind: 'role', status: 'pending', eventIds: [] },
              { id: 'shadow', label: 'Shadow', kind: 'role', status: 'completed', eventIds: ['event-shadow'] },
            ],
            graphEdges: [],
          } as ChatMessage['architectureRun'],
        },
      ],
    };
    mockApiGet.mockImplementation((url: string) => {
      if (url === '/api/sessions') return Promise.resolve({ data: architectureSessions });
      if (url === '/api/personas') return Promise.resolve({ data: mockPersonas });
      return Promise.resolve({ data: [] });
    });

    render(<SessionPanel />);
    await waitFor(() => expect(mockSetSessions).toHaveBeenCalledWith(architectureSessions));

    fireEvent.click(screen.getByTestId('toggle-session-children-host'));

    expect(screen.getByTestId('toggle-session-children-host')).toHaveTextContent('4');
    expect(screen.queryByText('Strategic Decision Council')).toBeNull();
    expect(screen.getByTestId('session-done-arch-run-pragmatist')).toBeTruthy();
    expect(screen.getByTestId('session-running-arch-run-innovator')).toBeTruthy();
    expect(screen.getByTestId('session-pending-arch-run-analyst')).toBeTruthy();
    expect(screen.getByTestId('session-error-arch-run-shadow')).toBeTruthy();
  });

  it('keeps workflow container sessions out of the top-level conversation list', async () => {
    const now = Date.now();
    const sessions: ChatSession[] = [
      { id: 'host', personaId: 'default', title: 'Workflow host', createdAt: now - 4000, updatedAt: now - 4000 },
      {
        id: 'arch-run-root',
        personaId: 'default',
        title: 'Architecture: Strategic Decision Council',
        kind: 'agent-flow',
        parentSessionId: 'host',
        runtimeContext: {
          runtimeKind: 'agent-flow-branch',
          architectureContext: {
            architectureRunId: 'run-live',
            schemaName: 'Strategic Decision Council',
            displayLabel: 'Strategic Decision Council',
          },
        },
        createdAt: now - 3000,
        updatedAt: now - 3000,
      },
      {
        id: 'arch-legacy-root',
        personaId: 'default',
        title: 'Strategic Decision Council',
        runtimeContext: {
          runtimeKind: 'chat',
          architectureContext: {
            architectureRunId: 'run-legacy',
            schemaName: 'Strategic Decision Council',
            displayLabel: 'Strategic Decision Council',
          },
        },
        createdAt: now - 2000,
        updatedAt: now - 2000,
      },
    ];

    mockState.sessions = sessions;
    mockState.activeSessionId = 'host';
    mockApiGet.mockImplementation((url: string) => {
      if (url === '/api/sessions') return Promise.resolve({ data: sessions });
      if (url === '/api/personas') return Promise.resolve({ data: mockPersonas });
      if (url === '/api/sessions/host/messages') return Promise.resolve({ data: [] });
      return Promise.resolve({ data: [] });
    });

    render(<SessionPanel />);
    await waitFor(() => expect(mockSetSessions).toHaveBeenCalledWith(sessions));

    expect(screen.getByText('Workflow host')).toBeTruthy();
    expect(screen.queryByTestId('session-title-arch-run-root')).toBeNull();
    expect(screen.queryByTestId('session-title-arch-legacy-root')).toBeNull();
    expect(screen.getByText('1 chat')).toBeTruthy();
  });

  it('shows a replayed backend branch session immediately with its live waiting state', async () => {
    const now = Date.now();
    const architectureSessions: ChatSession[] = [
      { id: 'host', personaId: 'default', title: 'Workflow host', createdAt: now - 3000, updatedAt: now - 3000 },
      {
        id: 'arch-run-root',
        personaId: 'default',
        title: 'Strategic Decision Council',
        kind: 'agent-flow',
        parentSessionId: 'host',
        runtimeContext: {
          runtimeKind: 'agent-flow-branch',
          architectureContext: { architectureRunId: 'run-live', displayLabel: 'Strategic Decision Council' },
        },
        createdAt: now - 2000,
        updatedAt: now - 2000,
      },
      {
        id: 'arch-run-analyst',
        personaId: 'web-research',
        title: 'Strategic Decision Council: Analyst',
        kind: 'subagent',
        parentSessionId: 'arch-run-root',
        runtimeContext: {
          runtimeKind: 'agent-flow-branch',
          parentToolCallId: 'architecture:run-live:analyst',
          architectureSlotId: 'analyst',
          architectureContext: { roleSlotId: 'analyst', displayLabel: 'Analyst' },
        },
        createdAt: now - 1000,
        updatedAt: now - 1000,
      },
    ];
    mockState.sessions = architectureSessions;
    mockAgentState.sessionStatusSnapshots = {
      'arch-run-analyst': {
        sessionId: 'arch-run-analyst',
        active: true,
        turnId: 'turn-analyst',
        queueLength: 0,
        run: {
          id: 'run-snapshot',
          sessionId: 'arch-run-analyst',
          turnId: 'turn-analyst',
          phase: 'tool_pending',
          status: 'active',
          retryCount: 0,
          safeResume: true,
          startedAt: now,
          updatedAt: now,
          lastHeartbeatAt: now,
        },
      },
    };
    mockApiGet.mockImplementation((url: string) => {
      if (url === '/api/sessions') return Promise.resolve({ data: architectureSessions });
      if (url === '/api/personas') return Promise.resolve({ data: mockPersonas });
      return Promise.resolve({ data: [] });
    });

    render(<SessionPanel />);
    await waitFor(() => expect(mockSetSessions).toHaveBeenCalledWith(architectureSessions));

    const toggle = screen.getByTestId('toggle-session-children-host');
    expect(toggle).toHaveTextContent('1');
    fireEvent.click(toggle);

    expect(screen.getByText('Strategic Decision Council: Analyst')).toBeTruthy();
    expect(screen.getByTestId('session-pending-confirmation-arch-run-analyst')).toBeTruthy();
  });

  it('shows real architecture descendants as pending before reload metadata hydrates', async () => {
    const now = Date.now();
    const architectureSessions: ChatSession[] = [
      { id: 'host', personaId: 'default', title: 'Workflow host', createdAt: now - 3000, updatedAt: now - 3000 },
      {
        id: 'arch-run-root',
        personaId: 'default',
        title: 'Strategic Decision Council',
        kind: 'agent-flow',
        parentSessionId: 'host',
        runtimeContext: {
          runtimeKind: 'agent-flow-branch',
          architectureContext: { architectureRunId: 'run-live', displayLabel: 'Strategic Decision Council' },
        },
        createdAt: now - 2000,
        updatedAt: now - 2000,
      },
      {
        id: 'arch-run-analyst',
        personaId: 'web-research',
        title: 'Strategic Decision Council: Analyst',
        kind: 'subagent',
        parentSessionId: 'arch-run-root',
        runtimeContext: {
          runtimeKind: 'agent-flow-branch',
          parentToolCallId: 'architecture:run-live:analyst',
          architectureSlotId: 'analyst',
          architectureContext: { roleSlotId: 'analyst', displayLabel: 'Analyst' },
        },
        createdAt: now - 1000,
        updatedAt: now - 1000,
      },
    ];
    mockState.sessions = architectureSessions;
    mockState.sessionMessages = {};
    mockAgentState.sessionStatusSnapshots = {};
    mockApiGet.mockImplementation((url: string) => {
      if (url === '/api/sessions') return Promise.resolve({ data: architectureSessions });
      if (url === '/api/personas') return Promise.resolve({ data: mockPersonas });
      return Promise.resolve({ data: [] });
    });

    render(<SessionPanel />);
    await waitFor(() => expect(mockSetSessions).toHaveBeenCalledWith(architectureSessions));

    const toggle = screen.getByTestId('toggle-session-children-host');
    expect(toggle).toHaveTextContent('1');
    fireEvent.click(toggle);
    expect(screen.queryByTestId('session-pending-arch-run-root')).toBeNull();
    expect(screen.getByTestId('session-pending-arch-run-analyst')).toBeTruthy();
    expect(screen.getByTestId('session-descendant-activity-host')).toHaveTextContent('1 pending');
  });

  it('shows the host row as pending when workflow descendants exist but only fallback status is available', async () => {
    const now = Date.now();
    const architectureSessions: ChatSession[] = [
      { id: 'host', personaId: 'default', title: 'Workflow host', createdAt: now - 3000, updatedAt: now - 3000 },
      {
        id: 'arch-run-root',
        personaId: 'default',
        title: 'Strategic Decision Council',
        kind: 'agent-flow',
        parentSessionId: 'host',
        runtimeContext: {
          runtimeKind: 'agent-flow-branch',
          architectureContext: { architectureRunId: 'run-live', displayLabel: 'Strategic Decision Council' },
        },
        createdAt: now - 2000,
        updatedAt: now - 2000,
      },
      {
        id: 'arch-run-analyst',
        personaId: 'web-research',
        title: 'Strategic Decision Council: Analyst',
        kind: 'subagent',
        parentSessionId: 'arch-run-root',
        runtimeContext: {
          runtimeKind: 'agent-flow-branch',
          parentToolCallId: 'architecture:run-live:analyst',
          architectureSlotId: 'analyst',
          architectureContext: { roleSlotId: 'analyst', displayLabel: 'Analyst' },
        },
        createdAt: now - 1000,
        updatedAt: now - 1000,
      },
    ];
    mockState.sessions = architectureSessions;
    mockState.sessionMessages = {};
    mockState.sessionAgentTurns = {
      host: [{ id: 'host-turn', sessionId: 'host', items: [], done: true }],
    };
    mockAgentState.sessionStatusSnapshots = {};
    mockApiGet.mockImplementation((url: string) => {
      if (url === '/api/sessions') return Promise.resolve({ data: architectureSessions });
      if (url === '/api/personas') return Promise.resolve({ data: mockPersonas });
      return Promise.resolve({ data: [] });
    });

    render(<SessionPanel />);
    await waitFor(() => expect(mockSetSessions).toHaveBeenCalledWith(architectureSessions));

    expect(screen.getByTestId('session-pending-host')).toBeTruthy();
    expect(screen.getByTestId('session-descendant-activity-host')).toHaveTextContent('1 pending');
  });

  it('keeps the host row running while workflow-envelope metadata still reports a live run', async () => {
    const now = Date.now();
    const architectureSessions: ChatSession[] = [
      {
        id: 'host',
        personaId: 'default',
        title: 'Workflow host',
        createdAt: now - 3000,
        updatedAt: now - 100,
        runtimeContext: {
          runtimeKind: 'chat',
          architectureContext: {
            schemaId: 'strategic-decision-council',
            schemaName: 'Strategic Decision Council',
            displayLabel: 'Strategic Decision Council',
          },
        },
      },
      {
        id: 'arch-run-root',
        personaId: 'default',
        title: 'Strategic Decision Council',
        kind: 'agent-flow',
        parentSessionId: 'host',
        runtimeContext: {
          runtimeKind: 'agent-flow-branch',
          architectureContext: { architectureRunId: 'run-live', displayLabel: 'Strategic Decision Council' },
        },
        createdAt: now - 2000,
        updatedAt: now - 100,
      },
    ];
    mockState.sessions = architectureSessions;
    mockState.sessionMessages = {
      host: [
        {
          id: 'workflow-live',
          sessionId: 'host',
          role: 'assistant',
          content: 'Architecture run is starting.',
          architectureRun: {
            runId: 'run-live',
            schemaId: 'Strategic Decision Council',
            status: 'running',
            hostProjectionKind: 'workflow-envelope',
            trace: [],
            routeHops: [],
          } as ChatMessage['architectureRun'],
          createdAt: now - 50,
        },
      ],
    };
    mockState.sessionAgentTurns = {
      host: [{ id: 'host-turn', sessionId: 'host', turnKind: 'workflow-envelope', items: [], done: true }],
    };
    mockAgentState.sessionStatusSnapshots = {};
    mockApiGet.mockImplementation((url: string) => {
      if (url === '/api/sessions') return Promise.resolve({ data: architectureSessions });
      if (url === '/api/personas') return Promise.resolve({ data: mockPersonas });
      return Promise.resolve({ data: [] });
    });

    render(<SessionPanel />);
    await waitFor(() => expect(mockSetSessions).toHaveBeenCalledWith(architectureSessions));

    expect(screen.getByTestId('session-running-host')).toBeTruthy();
    expect(screen.queryByTestId('session-done-host')).toBeNull();
  });

  it('auto-expands the active running workflow host and shows the latest branch tool activity', async () => {
    const now = Date.now();
    const architectureSessions: ChatSession[] = [
      {
        id: 'host',
        personaId: 'default',
        title: 'Workflow host',
        createdAt: now - 4000,
        updatedAt: now - 100,
        runtimeContext: {
          runtimeKind: 'chat',
          architectureContext: {
            schemaId: 'strategic-decision-council',
            schemaName: 'Strategic Decision Council',
            displayLabel: 'Strategic Decision Council',
          },
        },
      },
      {
        id: 'arch-run-root',
        personaId: 'default',
        title: 'Strategic Decision Council',
        kind: 'agent-flow',
        parentSessionId: 'host',
        runtimeContext: {
          runtimeKind: 'agent-flow-branch',
          architectureContext: { architectureRunId: 'run-live', displayLabel: 'Strategic Decision Council' },
        },
        createdAt: now - 3000,
        updatedAt: now - 100,
      },
      {
        id: 'arch-run-implementer',
        personaId: 'dev',
        title: 'Goal Master Delivery Loop: Implementer',
        kind: 'subagent',
        parentSessionId: 'arch-run-root',
        runtimeContext: {
          runtimeKind: 'agent-flow-branch',
          architectureSlotId: 'implementer',
          architectureContext: { architectureRunId: 'run-live', roleSlotId: 'implementer', displayLabel: 'Implementer' },
        },
        createdAt: now - 2000,
        updatedAt: now - 100,
      },
    ];
    mockState.sessions = architectureSessions;
    mockState.activeSessionId = 'host';
    mockState.sessionMessages = {
      host: [
        {
          id: 'workflow-live',
          sessionId: 'host',
          role: 'assistant',
          content: '',
          createdAt: now - 50,
          architectureRun: {
            runId: 'run-live',
            schemaId: 'Goal Master Delivery Loop',
            status: 'running',
            hostProjectionKind: 'workflow-envelope',
            trace: [],
            routeHops: [],
          } as ChatMessage['architectureRun'],
        },
      ],
      'arch-run-implementer': [],
    };
    mockState.sessionAgentTurns = {
      host: [{ id: 'host-turn', sessionId: 'host', turnKind: 'workflow-envelope', items: [], done: true }],
    };
    mockAgentState.sessionToolActivities = {
      'arch-run-implementer': [{
        callId: 'call-1',
        toolName: 'fs_read',
        args: {},
        sessionId: 'arch-run-implementer',
        status: 'running',
        startedAt: now - 25,
      }],
    };
    mockApiGet.mockImplementation((url: string) => {
      if (url === '/api/sessions') return Promise.resolve({ data: architectureSessions });
      if (url === '/api/personas') return Promise.resolve({ data: mockPersonas });
      return Promise.resolve({ data: [] });
    });

    render(<SessionPanel />);
    await waitFor(() => expect(mockSetSessions).toHaveBeenCalledWith(architectureSessions));

    expect(screen.getByText('Goal Master Delivery Loop: Implementer')).toBeTruthy();
    expect(screen.getByTestId('session-pending-arch-run-implementer')).toBeTruthy();
    expect(screen.getByTestId('session-last-tool-arch-run-implementer')).toHaveTextContent('fs_read running');
  });

  it('shows pending architecture branches immediately when the backend already created real branch sessions', async () => {
    const now = Date.now();
    const architectureSessions: ChatSession[] = [
      { id: 'host', personaId: 'default', title: 'Workflow host', createdAt: now - 3000, updatedAt: now - 3000 },
      {
        id: 'arch-run-root',
        personaId: 'default',
        title: 'Strategic Decision Council',
        kind: 'agent-flow',
        parentSessionId: 'host',
        runtimeContext: {
          runtimeKind: 'agent-flow-branch',
          architectureContext: { architectureRunId: 'run-live', displayLabel: 'Strategic Decision Council' },
        },
        createdAt: now - 2000,
        updatedAt: now - 2000,
      },
      {
        id: 'arch-run-innovator',
        personaId: 'jony',
        title: 'Strategic Decision Council: Innovator',
        kind: 'subagent',
        parentSessionId: 'arch-run-root',
        runtimeContext: {
          runtimeKind: 'agent-flow-branch',
          parentToolCallId: 'architecture:run-live:innovator',
          architectureSlotId: 'innovator',
          architectureContext: { displayLabel: 'Innovator' },
        },
        createdAt: now - 1000,
        updatedAt: now - 1000,
      },
    ];
    mockState.sessions = architectureSessions;
    mockState.sessionMessages = {
      host: [
        {
          id: 'architecture-run',
          sessionId: 'host',
          role: 'assistant',
          content: '',
          createdAt: now,
          architectureRun: {
            runId: 'run-live',
            schemaId: 'Strategic Decision Council',
            status: 'running',
            routeHops: [],
            trace: [],
            graphNodes: [
              { id: 'innovator', label: 'Innovator', kind: 'role', status: 'pending', eventIds: [] },
            ],
          } as ChatMessage['architectureRun'],
        },
      ],
    };
    mockAgentState.sessionStatusSnapshots = {};
    mockApiGet.mockImplementation((url: string) => {
      if (url === '/api/sessions') return Promise.resolve({ data: architectureSessions });
      if (url === '/api/personas') return Promise.resolve({ data: mockPersonas });
      return Promise.resolve({ data: [] });
    });

    render(<SessionPanel />);
    await waitFor(() => expect(mockSetSessions).toHaveBeenCalledWith(architectureSessions));

    const toggle = screen.getByTestId('toggle-session-children-host');
    expect(toggle).toHaveTextContent('1');
    fireEvent.click(toggle);
    expect(screen.getByText('Strategic Decision Council: Innovator')).toBeTruthy();
    expect(screen.getByTestId('session-pending-arch-run-innovator')).toBeTruthy();
  });

  it('hides technical router and finalizer architecture sessions from the conversation tree', async () => {
    const now = Date.now();
    const architectureSessions: ChatSession[] = [
      { id: 'host', personaId: 'default', title: 'Workflow host', createdAt: now - 5000, updatedAt: now - 5000 },
      {
        id: 'arch-run-root',
        personaId: 'default',
        title: 'Strategic Decision Council',
        kind: 'agent-flow',
        parentSessionId: 'host',
        runtimeContext: {
          runtimeKind: 'agent-flow-branch',
          architectureContext: { architectureRunId: 'run-live', displayLabel: 'Strategic Decision Council' },
        },
        createdAt: now - 4000,
        updatedAt: now - 4000,
      },
      {
        id: 'arch-run-router',
        personaId: 'orchestrator',
        title: 'Strategic Decision Council: Router',
        kind: 'subagent',
        parentSessionId: 'arch-run-root',
        runtimeContext: {
          runtimeKind: 'agent-flow-branch',
          architectureContext: { roleSlotType: 'router', displayLabel: 'Router' },
        },
        createdAt: now - 3000,
        updatedAt: now - 3000,
      },
      {
        id: 'arch-run-finalizer',
        personaId: 'dev',
        title: 'Strategic Decision Council: Finalizer',
        kind: 'subagent',
        parentSessionId: 'arch-run-root',
        runtimeContext: {
          runtimeKind: 'agent-flow-branch',
          architectureSlotId: 'finalizer',
          architectureContext: { displayLabel: 'Finalizer' },
        },
        createdAt: now - 2000,
        updatedAt: now - 2000,
      },
      {
        id: 'arch-run-pragmatist',
        personaId: 'dev',
        title: 'Strategic Decision Council: Pragmatist',
        kind: 'subagent',
        parentSessionId: 'arch-run-root',
        runtimeContext: {
          runtimeKind: 'agent-flow-branch',
          parentToolCallId: 'architecture:run-live:pragmatist',
          architectureSlotId: 'pragmatist',
          architectureContext: { roleSlotId: 'pragmatist', displayLabel: 'Pragmatist' },
        },
        createdAt: now - 1000,
        updatedAt: now - 1000,
      },
    ];
    mockState.sessions = architectureSessions;
    mockState.sessionMessages = {
      host: [
        {
          id: 'architecture-run',
          sessionId: 'host',
          role: 'assistant',
          content: '',
          createdAt: now,
          architectureRun: {
            runId: 'run-live',
            schemaId: 'Strategic Decision Council',
            status: 'running',
            routeHops: [],
            trace: [
              {
                speaker: 'participant',
                content: 'Pragmatist answer.',
                eventId: 'event-pragmatist',
                nodeId: 'pragmatist',
                stream: {
                  streamGroupId: 'architecture:run-live:pragmatist',
                  branchSessionId: 'arch-run-pragmatist',
                  status: 'completed',
                  chunkCount: 1,
                  text: 'Pragmatist answer.',
                },
              },
            ],
          },
        },
      ],
    };
    mockApiGet.mockImplementation((url: string) => {
      if (url === '/api/sessions') return Promise.resolve({ data: architectureSessions });
      if (url === '/api/personas') return Promise.resolve({ data: mockPersonas });
      return Promise.resolve({ data: [] });
    });

    render(<SessionPanel />);
    await waitFor(() => expect(mockSetSessions).toHaveBeenCalledWith(architectureSessions));

    fireEvent.click(screen.getByTestId('toggle-session-children-host'));

    expect(screen.queryByText('Strategic Decision Council: Router')).toBeNull();
    expect(screen.queryByText('Strategic Decision Council: Finalizer')).toBeNull();
    expect(screen.getByText('Strategic Decision Council: Pragmatist')).toBeTruthy();
  });

  it('shows pending real architecture branches while still hiding technical nodes', async () => {
    const now = Date.now();
    const architectureSessions: ChatSession[] = [
      { id: 'host', personaId: 'default', title: 'Workflow host', createdAt: now - 5_000, updatedAt: now - 5_000 },
      {
        id: 'arch-run-root',
        personaId: 'default',
        title: 'Strategic Decision Council',
        kind: 'agent-flow',
        parentSessionId: 'host',
        runtimeContext: {
          runtimeKind: 'agent-flow-branch',
          architectureContext: { architectureRunId: 'run-live', displayLabel: 'Strategic Decision Council' },
        },
        createdAt: now - 4_000,
        updatedAt: now - 4_000,
      },
      {
        id: 'arch-run-pragmatist',
        personaId: 'dev',
        title: 'Strategic Decision Council: Pragmatist',
        kind: 'subagent',
        parentSessionId: 'arch-run-root',
        runtimeContext: {
          runtimeKind: 'agent-flow-branch',
          architectureSlotId: 'pragmatist',
          architectureContext: { roleSlotId: 'pragmatist', displayLabel: 'Pragmatist' },
        },
        createdAt: now - 3_000,
        updatedAt: now - 3_000,
      },
      {
        id: 'arch-run-innovator',
        personaId: 'jony',
        title: 'Strategic Decision Council: Innovator',
        kind: 'subagent',
        parentSessionId: 'arch-run-root',
        runtimeContext: {
          runtimeKind: 'agent-flow-branch',
          parentToolCallId: 'architecture:run-live:innovator',
          architectureSlotId: 'innovator',
          architectureContext: { roleSlotId: 'innovator', displayLabel: 'Innovator' },
        },
        createdAt: now - 2_000,
        updatedAt: now - 2_000,
      },
      {
        id: 'arch-run-finalizer',
        personaId: 'dev',
        title: 'Strategic Decision Council: Finalizer',
        kind: 'subagent',
        parentSessionId: 'arch-run-root',
        runtimeContext: {
          runtimeKind: 'agent-flow-branch',
          architectureSlotId: 'finalizer',
          architectureContext: { displayLabel: 'Finalizer' },
        },
        createdAt: now - 1_000,
        updatedAt: now - 1_000,
      },
    ];
    mockState.sessions = architectureSessions;
    mockState.sessionMessages = {
      host: [
        {
          id: 'architecture-run',
          sessionId: 'host',
          role: 'assistant',
          content: '',
          createdAt: now,
          architectureRun: {
            runId: 'run-live',
            schemaId: 'Strategic Decision Council',
            status: 'running',
            routeHops: [],
            trace: [
              {
                speaker: 'participant',
                content: 'Pragmatist answer.',
                eventId: 'event-pragmatist',
                nodeId: 'pragmatist',
                stream: {
                  streamGroupId: 'architecture:run-live:pragmatist',
                  branchSessionId: 'arch-run-pragmatist',
                  status: 'completed',
                  chunkCount: 1,
                  text: 'Pragmatist answer.',
                },
              },
            ],
            graphNodes: [
              { id: 'pragmatist', label: 'Pragmatist', kind: 'role', status: 'completed', eventIds: ['event-pragmatist'] },
              { id: 'innovator', label: 'Innovator', kind: 'role', status: 'pending', eventIds: [] },
              { id: 'finalizer', label: 'Finalizer', kind: 'artifact', status: 'pending', eventIds: [] },
            ],
            graphEdges: [],
          } as ChatMessage['architectureRun'],
        },
      ],
    };
    mockApiGet.mockImplementation((url: string) => {
      if (url === '/api/sessions') return Promise.resolve({ data: architectureSessions });
      if (url === '/api/personas') return Promise.resolve({ data: mockPersonas });
      return Promise.resolve({ data: [] });
    });

    render(<SessionPanel />);
    await waitFor(() => expect(mockSetSessions).toHaveBeenCalledWith(architectureSessions));

    const toggle = screen.getByTestId('toggle-session-children-host');
    expect(toggle).toHaveTextContent('2');
    fireEvent.click(toggle);

    expect(screen.getByText('Strategic Decision Council: Pragmatist')).toBeTruthy();
    expect(screen.getByText('Strategic Decision Council: Innovator')).toBeTruthy();
    expect(screen.getByTestId('session-done-arch-run-pragmatist')).toBeTruthy();
    expect(screen.getByTestId('session-pending-arch-run-innovator')).toBeTruthy();
    expect(screen.queryByText('Strategic Decision Council: Finalizer')).toBeNull();
  });

  it('collapses the live architecture envelope session and shows real branch chats directly under the host chat', async () => {
    const now = Date.now();
    const architectureSessions: ChatSession[] = [
      { id: 'host', personaId: 'default', title: 'Architecture E2E 1781400893970', kind: 'chat', createdAt: now - 5_000, updatedAt: now - 5_000 },
      {
        id: 'arch-run-root',
        personaId: 'default',
        title: 'Architecture: What can you do?',
        kind: 'chat',
        parentSessionId: 'host',
        runtimeContext: {
          runtimeKind: 'agent-flow-branch',
          architectureContext: {
            architectureRunId: 'run-live',
            schemaName: 'Strategic Decision Council',
            displayLabel: 'Strategic Decision Council',
          },
        },
        createdAt: now - 4_000,
        updatedAt: now - 4_000,
      },
      {
        id: 'arch-run-pragmatist',
        personaId: 'dev',
        title: 'Strategic Decision Council: Pragmatist',
        kind: 'subagent',
        parentSessionId: 'arch-run-root',
        runtimeContext: {
          runtimeKind: 'agent-flow-branch',
          parentToolCallId: 'architecture:run-live:pragmatist',
          architectureSlotId: 'pragmatist',
          architectureContext: { parentSessionId: 'host' },
        },
        createdAt: now - 3_000,
        updatedAt: now - 2_500,
      },
      {
        id: 'arch-run-finalizer',
        personaId: 'dev',
        title: 'Strategic Decision Council: Finalizer',
        kind: 'subagent',
        parentSessionId: 'arch-run-root',
        runtimeContext: {
          runtimeKind: 'agent-flow-branch',
          parentToolCallId: 'architecture:run-live:finalizer',
          architectureSlotId: 'finalizer',
          architectureContext: { parentSessionId: 'host' },
        },
        createdAt: now - 2_000,
        updatedAt: now - 2_000,
      },
    ];
    mockState.sessions = architectureSessions;
    mockState.sessionMessages = {
      host: [
        {
          id: 'arch-summary',
          sessionId: 'host',
          role: 'assistant',
          content: '',
          createdAt: now - 1_000,
          architectureRun: {
            runId: 'run-live',
            schemaId: 'Strategic Decision Council',
            status: 'running',
            routeHops: [],
            trace: [
              {
                speaker: 'participant',
                content: 'Pragmatist branch started',
                eventId: 'event-pragmatist',
                nodeId: 'pragmatist',
                stream: {
                  streamGroupId: 'run-live',
                  branchSessionId: 'arch-run-pragmatist',
                  status: 'started',
                  chunkCount: 0,
                  text: '',
                },
              },
            ],
          },
        },
      ],
    };
    mockApiGet.mockImplementation((url: string) => {
      if (url === '/api/sessions') return Promise.resolve({ data: architectureSessions });
      if (url === '/api/personas') return Promise.resolve({ data: mockPersonas });
      return Promise.resolve({ data: [] });
    });

    render(<SessionPanel />);
    await waitFor(() => expect(mockSetSessions).toHaveBeenCalledWith(architectureSessions));

    const toggle = screen.getByTestId('toggle-session-children-host');
    expect(toggle).toHaveTextContent('1');
    fireEvent.click(toggle);

    expect(screen.queryByText('Architecture: What can you do?')).toBeNull();
    expect(screen.getByText('Strategic Decision Council: Pragmatist')).toBeTruthy();
    expect(screen.queryByText('Strategic Decision Council: Finalizer')).toBeNull();
  });

  it('hides legacy technical architecture sessions when only the id/title still marks them as router or finalizer', async () => {
    const now = Date.now();
    const architectureSessions: ChatSession[] = [
      { id: 'host', personaId: 'default', title: 'Workflow host', createdAt: now - 5_000, updatedAt: now - 5_000 },
      {
        id: 'arch-legacy-root',
        personaId: 'default',
        title: 'Architecture: Legacy debate',
        kind: 'chat',
        parentSessionId: 'host',
        createdAt: now - 4_000,
        updatedAt: now - 4_000,
      },
      {
        id: 'arch-legacy-orchestrator',
        personaId: 'agent-orchestrator',
        title: 'Architecture Debate: Orchestrator',
        kind: 'subagent',
        parentSessionId: 'arch-legacy-root',
        createdAt: now - 3_000,
        updatedAt: now - 3_000,
      },
      {
        id: 'arch-legacy-finalizer',
        personaId: 'agent-synthesizer',
        title: 'Architecture Debate: Finalizer',
        kind: 'subagent',
        parentSessionId: 'arch-legacy-root',
        createdAt: now - 2_000,
        updatedAt: now - 2_000,
      },
      {
        id: 'arch-legacy-analyst',
        personaId: 'web-research',
        title: 'Architecture Debate: Analyst',
        kind: 'subagent',
        parentSessionId: 'arch-legacy-root',
        createdAt: now - 1_000,
        updatedAt: now - 1_000,
      },
    ];
    mockState.sessions = architectureSessions;
    mockState.sessionMessages = {};
    mockApiGet.mockImplementation((url: string) => {
      if (url === '/api/sessions') return Promise.resolve({ data: architectureSessions });
      if (url === '/api/personas') return Promise.resolve({ data: mockPersonas });
      return Promise.resolve({ data: [] });
    });

    render(<SessionPanel />);
    await waitFor(() => expect(mockSetSessions).toHaveBeenCalledWith(architectureSessions));

    fireEvent.click(screen.getByTestId('toggle-session-children-host'));

    expect(screen.queryByText('Architecture Debate: Orchestrator')).toBeNull();
    expect(screen.queryByText('Architecture Debate: Finalizer')).toBeNull();
    expect(screen.getByText('Architecture Debate: Analyst')).toBeTruthy();
  });

  it('hides cli-agent child sessions from the default conversation list', async () => {
    const sessionsWithCliChild: ChatSession[] = [
      ...mockSessions,
      {
        id: 'cli-1',
        personaId: 'default',
        title: 'Codex CLI: inspect repository',
        kind: 'cli-agent',
        parentSessionId: 's1',
        parentToolCallId: 'call-cli',
        createdAt: 2_600,
        updatedAt: Date.now() - 45_000,
      },
    ];

    mockState.sessions = sessionsWithCliChild;
    mockApiGet.mockImplementation((url: string) => {
      if (url === '/api/sessions') return Promise.resolve({ data: sessionsWithCliChild });
      if (url === '/api/personas') return Promise.resolve({ data: mockPersonas });
      return Promise.resolve({ data: [] });
    });

    render(<SessionPanel />);
    await waitFor(() => expect(mockSetSessions).toHaveBeenCalledWith(sessionsWithCliChild));

    expect(screen.queryByText('Codex CLI: inspect repository')).toBeNull();
    expect(screen.queryByTestId('cli-agent-session-badge-cli-1')).toBeNull();
  });

  it('keeps the master session visible when its child subagent sessions are hidden', async () => {
    render(<SessionPanel />);
    await waitFor(() => expect(mockSetSessions).toHaveBeenCalledWith(mockSessions));

    const orderedItems = screen.getAllByTestId('session-item').map((item) => item.textContent ?? '');
    const masterIndex = orderedItems.findIndex((text) => text.includes('Chat about React'));
    const subagentIndex = orderedItems.findIndex((text) => text.includes('Sub-agent: Landing page'));

    expect(masterIndex).toBeGreaterThanOrEqual(0);
    expect(subagentIndex).toBe(-1);
  });

  it('keeps an explicitly active child session visible for direct branch inspection', async () => {
    const orderedSessions: ChatSession[] = [
      { id: 'master', personaId: 'orchestrator', title: 'Main orchestration chat', createdAt: 1_000, updatedAt: 5_000 },
      { id: 'child-older', personaId: 'default', title: 'Sub-agent: older child', kind: 'subagent', parentSessionId: 'master', createdAt: 2_000, updatedAt: 6_000 },
      { id: 'child-newer', personaId: 'default', title: 'Sub-agent: newer child', kind: 'subagent', parentSessionId: 'master', createdAt: 3_000, updatedAt: 7_000 },
    ];

    mockState.sessions = orderedSessions;
    mockState.activeSessionId = 'child-older';
    mockApiGet.mockImplementation((url: string) => {
      if (url === '/api/sessions') return Promise.resolve({ data: orderedSessions });
      if (url === '/api/personas') return Promise.resolve({ data: mockPersonas });
      return Promise.resolve({ data: [] });
    });

    render(<SessionPanel />);
    await waitFor(() => expect(mockSetSessions).toHaveBeenCalledWith(orderedSessions));

    const orderedItems = screen.getAllByTestId('session-item').map((item) => item.textContent ?? '');

    expect(orderedItems.slice(0, 2)).toEqual([
      expect.stringContaining('Main orchestration chat'),
      expect.stringContaining('Sub-agent: older child'),
    ]);
    expect(orderedItems.some((text) => text.includes('Sub-agent: newer child'))).toBe(false);
  });

  it('does not render persona filter chips in the conversation list', async () => {
    render(<SessionPanel />);
    await waitFor(() => expect(mockSetSessions).toHaveBeenCalled());

    await waitFor(() => expect(mockApiGet).toHaveBeenCalledWith('/api/personas'));
    expect(screen.queryByRole('button', { name: 'Dev Assistant' })).toBeNull();
  });

  it('filters the conversation list to user-started sessions', async () => {
    render(<SessionPanel />);
    await waitFor(() => expect(mockSetSessions).toHaveBeenCalledWith(mockSessions));

    chooseOriginFilter('user');

    expect(screen.getByText('Chat about React')).toBeTruthy();
    expect(screen.getByText('New Chat')).toBeTruthy();
    expect(screen.queryByText('Sub-agent: Landing page')).toBeNull();
  });

  it('filters the conversation list to agent-started sessions', async () => {
    render(<SessionPanel />);
    await waitFor(() => expect(mockSetSessions).toHaveBeenCalledWith(mockSessions));

    chooseOriginFilter('agent');

    expect(screen.getByTestId('session-tree-root')).toHaveTextContent('Chat about React');
    expect(screen.queryByText('New Chat')).toBeNull();
    expect(screen.getByText('Sub-agent: Landing page')).toBeTruthy();
    expect(screen.getByTestId('subagent-session-badge-sub-1')).toBeTruthy();
    expect(screen.queryByTestId('new-session-btn')).toBeNull();
  });

  it('falls back for a blank agent tree root title', async () => {
    const now = Date.now();
    const sessions: ChatSession[] = [
      { id: 'root-abcdef', personaId: 'default', title: '   ', createdAt: now - 2000, updatedAt: now - 2000 },
      { id: 'sub-agent', personaId: 'default', title: 'Sub-agent: work', kind: 'subagent', parentSessionId: 'root-abcdef', createdAt: now - 1000, updatedAt: now - 1000 },
    ];

    mockState.sessions = sessions;
    mockApiGet.mockImplementation((url: string) => {
      if (url === '/api/sessions') return Promise.resolve({ data: sessions });
      if (url === '/api/personas') return Promise.resolve({ data: mockPersonas });
      return Promise.resolve({ data: [] });
    });

    render(<SessionPanel />);
    await waitFor(() => expect(mockSetSessions).toHaveBeenCalledWith(sessions));

    chooseOriginFilter('agent');

    expect(screen.getByTestId('session-tree-root')).toHaveTextContent('Session root-a');
  });

  it('renders nested agent-started sessions as a tree', async () => {
    const now = Date.now();
    const nestedSessions: ChatSession[] = [
      { id: 'root', personaId: 'default', title: 'Main task', createdAt: now - 3000, updatedAt: now - 3000 },
      { id: 'sub-outer', personaId: 'default', title: 'Sub-agent: outer', kind: 'subagent', parentSessionId: 'root', createdAt: now - 2000, updatedAt: now - 2000 },
      { id: 'sub-inner', personaId: 'default', title: 'Sub-agent: inner', kind: 'subagent', parentSessionId: 'sub-outer', createdAt: now - 1000, updatedAt: now - 1000 },
    ];

    mockState.sessions = nestedSessions;
    mockApiGet.mockImplementation((url: string) => {
      if (url === '/api/sessions') return Promise.resolve({ data: nestedSessions });
      if (url === '/api/personas') return Promise.resolve({ data: mockPersonas });
      return Promise.resolve({ data: [] });
    });

    render(<SessionPanel />);
    await waitFor(() => expect(mockSetSessions).toHaveBeenCalledWith(nestedSessions));

    chooseOriginFilter('agent');

    expect(screen.getByTestId('session-tree-root')).toHaveTextContent('Main task');
    const items = screen.getAllByTestId('session-item');
    expect(items.map((item) => item.textContent ?? '')).toEqual([
      expect.stringContaining('Sub-agent: outer'),
      expect.stringContaining('Sub-agent: inner'),
    ]);
    expect(items[1]).toHaveStyle({ paddingLeft: '40px' });
  });

  it('hides inactive older agent sessions from the agent filter', async () => {
    const now = Date.now();
    const staleSessions: ChatSession[] = [
      { id: 'root', personaId: 'default', title: 'Main task', createdAt: now - 3 * 86_400_000, updatedAt: now - 3 * 86_400_000 },
      { id: 'old-sub', personaId: 'default', title: 'Sub-agent: stale', kind: 'subagent', parentSessionId: 'root', createdAt: now - 3 * 86_400_000, updatedAt: now - 3 * 86_400_000 },
      { id: 'fresh-sub', personaId: 'default', title: 'Sub-agent: fresh', kind: 'subagent', parentSessionId: 'root', createdAt: now - 60_000, updatedAt: now - 60_000 },
    ];

    mockState.sessions = staleSessions;
    mockApiGet.mockImplementation((url: string) => {
      if (url === '/api/sessions') return Promise.resolve({ data: staleSessions });
      if (url === '/api/personas') return Promise.resolve({ data: mockPersonas });
      return Promise.resolve({ data: [] });
    });

    render(<SessionPanel />);
    await waitFor(() => expect(mockSetSessions).toHaveBeenCalledWith(staleSessions));

    chooseOriginFilter('agent');

    expect(screen.queryByText('Sub-agent: stale')).toBeNull();
    expect(screen.getByText('Sub-agent: fresh')).toBeTruthy();
  });

  it('hides architecture envelope sessions from the agent filter and counts only real branch chats', async () => {
    const now = Date.now();
    const architectureSessions: ChatSession[] = [
      { id: 'host', personaId: 'default', title: 'Workflow host', createdAt: now - 5_000, updatedAt: now - 5_000 },
      {
        id: 'arch-run-root',
        personaId: 'default',
        title: 'Architecture: Assess repo',
        kind: 'chat',
        parentSessionId: 'host',
        runtimeContext: {
          runtimeKind: 'agent-flow-branch',
          architectureContext: {
            architectureRunId: 'run-live',
            schemaName: 'Strategic Decision Council',
            displayLabel: 'Strategic Decision Council',
          },
        },
        createdAt: now - 4_000,
        updatedAt: now - 4_000,
      },
      {
        id: 'arch-run-router',
        personaId: 'default',
        title: 'Strategic Decision Council: Router',
        kind: 'subagent',
        parentSessionId: 'arch-run-root',
        runtimeContext: {
          runtimeKind: 'agent-flow-branch',
          architectureSlotId: 'router',
          architectureContext: { roleSlotId: 'router', displayLabel: 'Router' },
        },
        createdAt: now - 3_000,
        updatedAt: now - 3_000,
      },
      {
        id: 'arch-run-pragmatist',
        personaId: 'default',
        title: 'Strategic Decision Council: Pragmatist',
        kind: 'subagent',
        parentSessionId: 'arch-run-root',
        runtimeContext: {
          runtimeKind: 'agent-flow-branch',
          architectureSlotId: 'pragmatist',
          architectureContext: { roleSlotId: 'pragmatist', displayLabel: 'Pragmatist' },
        },
        createdAt: now - 2_000,
        updatedAt: now - 2_000,
      },
      {
        id: 'arch-run-finalizer',
        personaId: 'default',
        title: 'Strategic Decision Council: Finalizer',
        kind: 'subagent',
        parentSessionId: 'arch-run-root',
        runtimeContext: {
          runtimeKind: 'agent-flow-branch',
          architectureSlotId: 'finalizer',
          architectureContext: { roleSlotId: 'finalizer', displayLabel: 'Finalizer' },
        },
        createdAt: now - 1_000,
        updatedAt: now - 1_000,
      },
    ];

    mockState.sessions = architectureSessions;
    mockState.sessionMessages = {
      host: [
        {
          id: 'arch-summary',
          sessionId: 'host',
          role: 'assistant',
          content: '',
          createdAt: now - 500,
          architectureRun: {
            runId: 'run-live',
            schemaId: 'Strategic Decision Council',
            status: 'running',
            routeHops: [],
            trace: [
              {
                speaker: 'participant',
                content: 'Pragmatist branch started',
                eventId: 'event-pragmatist',
                nodeId: 'pragmatist',
                stream: {
                  streamGroupId: 'run-live',
                  branchSessionId: 'arch-run-pragmatist',
                  status: 'started',
                  chunkCount: 0,
                  text: '',
                },
              },
            ],
          },
        },
      ],
    };
    mockApiGet.mockImplementation((url: string) => {
      if (url === '/api/sessions') return Promise.resolve({ data: architectureSessions });
      if (url === '/api/personas') return Promise.resolve({ data: mockPersonas });
      return Promise.resolve({ data: [] });
    });

    render(<SessionPanel />);
    await waitFor(() => expect(mockSetSessions).toHaveBeenCalledWith(architectureSessions));

    chooseOriginFilter('agent');

    expect(screen.getByTestId('session-tree-root')).toHaveTextContent('Workflow host');
    expect(screen.getByTestId('session-tree-root')).toHaveTextContent('1 child run');
    expect(screen.queryByText('Architecture: Assess repo')).toBeNull();
    expect(screen.queryByText('Strategic Decision Council: Router')).toBeNull();
    expect(screen.queryByText('Strategic Decision Council: Finalizer')).toBeNull();
    expect(screen.getByText('Strategic Decision Council: Pragmatist')).toBeTruthy();
  });

  it('archives agent sessions without hard deletion from the agent filter', async () => {
    render(<SessionPanel />);
    await waitFor(() => expect(mockSetSessions).toHaveBeenCalledWith(mockSessions));

    chooseOriginFilter('agent');
    fireEvent.click(screen.getByTestId('archive-session-sub-1'));

    await waitFor(() => expect(mockApiPost).toHaveBeenCalledWith('/api/sessions/sub-1/archive'));
    expect(mockRemoveSession).toHaveBeenCalledWith('sub-1');
    expect(mockApiDelete).not.toHaveBeenCalledWith('/api/sessions/sub-1');
  });

  it('loads archived agent sessions and restores them from the archived filter', async () => {
    const archivedSession: ChatSession = {
      id: 'archived-sub',
      personaId: 'default',
      title: 'Archived Sub-agent',
      kind: 'subagent',
      parentSessionId: 's1',
      createdAt: Date.now() - 60_000,
      updatedAt: Date.now() - 60_000,
    };
    mockApiGet.mockImplementation((url: string) => {
      if (url === '/api/sessions') return Promise.resolve({ data: mockSessions });
      if (url === '/api/sessions?includeArchived=true') {
        return Promise.resolve({ data: [...mockSessions, archivedSession] });
      }
      if (url === '/api/personas') return Promise.resolve({ data: mockPersonas });
      return Promise.resolve({ data: [] });
    });

    render(<SessionPanel />);
    await waitFor(() => expect(mockSetSessions).toHaveBeenCalledWith(mockSessions));

    chooseOriginFilter('archived');
    await waitFor(() => expect(screen.getByText('Archived Sub-agent')).toBeTruthy());
    fireEvent.click(screen.getByTestId('restore-session-archived-sub'));

    await waitFor(() => expect(mockApiPost).toHaveBeenCalledWith('/api/sessions/archived-sub/restore'));
    expect(mockAddSession).toHaveBeenCalledWith(archivedSession);
  });

  it('keeps all sessions visible regardless of persona', async () => {
    render(<SessionPanel />);
    await waitFor(() => expect(mockSetSessions).toHaveBeenCalled());

    expect(screen.getByText('Chat about React')).toBeTruthy();
    expect(screen.getByText('New Chat')).toBeTruthy();
  });

  it('new session button creates session with title "New Chat"', async () => {
    mockApiPost.mockResolvedValue({ data: { id: 's3', personaId: 'default', title: 'New Chat', createdAt: 3000, updatedAt: 3000 } });
    render(<SessionPanel />);
    await waitFor(() => expect(mockSetSessions).toHaveBeenCalled());

    const newBtn = screen.getByTestId('new-session-btn');
    fireEvent.click(newBtn);

    await waitFor(() => expect(mockApiPost).toHaveBeenCalledWith('/api/sessions', expect.objectContaining({ title: 'New Chat' })));
  });

  it('new session button uses the first available persona instead of hardcoded default', async () => {
    mockApiPost.mockResolvedValue({ data: { id: 's3', personaId: 'p1', title: 'New Chat', createdAt: 3000, updatedAt: 3000 } });
    render(<SessionPanel />);
    await waitFor(() => expect(mockSetSessions).toHaveBeenCalled());

    fireEvent.click(screen.getByTestId('new-session-btn'));

    await waitFor(() => expect(mockApiPost).toHaveBeenCalledWith('/api/sessions', expect.objectContaining({
      personaId: 'p1',
      title: 'New Chat',
    })));
  });

  it('falls back to default persona when personas are unavailable during new session creation', async () => {
    mockApiGet.mockImplementation((url: string) => {
      if (url === '/api/sessions') return Promise.resolve({ data: mockSessions });
      if (url === '/api/personas') return Promise.resolve({ data: [] });
      return Promise.resolve({ data: [] });
    });
    mockApiPost.mockResolvedValue({ data: { id: 's3', personaId: 'default', title: 'New Chat', createdAt: 3000, updatedAt: 3000 } });

    render(<SessionPanel />);
    await waitFor(() => expect(mockSetSessions).toHaveBeenCalled());

    fireEvent.click(screen.getByTestId('new-session-btn'));

    await waitFor(() => expect(mockApiPost).toHaveBeenCalledWith('/api/sessions', expect.objectContaining({
      personaId: 'default',
      title: 'New Chat',
    })));
  });

  it('calls onSelect when a session is clicked', async () => {
    mockApiGet.mockImplementation((url: string) => {
      if (url === '/api/sessions') return Promise.resolve({ data: mockSessions });
      if (url === '/api/personas') return Promise.resolve({ data: mockPersonas });
      if (url.includes('/messages')) return Promise.resolve({ data: [] });
      return Promise.resolve({ data: [] });
    });

    const onSelect = vi.fn();
    render(<SessionPanel onSelect={onSelect} />);
    await waitFor(() => expect(mockSetSessions).toHaveBeenCalled());

    const items = screen.getAllByTestId('session-item');
    fireEvent.click(items[0]!);

    await waitFor(() => expect(onSelect).toHaveBeenCalledTimes(1));
  });

  it('restores the last active session from sessionStorage before falling back to recency', async () => {
    mockState.activeSessionId = null;
    sessionStorage.setItem('kalio:last-active-session-id', 's1');
    mockApiGet.mockImplementation((url: string) => {
      if (url === '/api/sessions') return Promise.resolve({ data: mockSessions });
      if (url === '/api/personas') return Promise.resolve({ data: mockPersonas });
      if (url === '/api/sessions/s1/messages') return Promise.resolve({ data: [] });
      return Promise.resolve({ data: [] });
    });

    render(<SessionPanel />);

    await waitFor(() => expect(mockSetActiveSession).toHaveBeenCalledWith('s1'));
    expect(mockApiGet).toHaveBeenCalledWith('/api/sessions/s1/messages');
  });

  it('rehydrates architecture timeline metadata when restoring the last active host session after reload', async () => {
    const now = Date.now();
    const architectureSessions: ChatSession[] = [
      { id: 'host', personaId: 'default', title: 'Parent chat', createdAt: now - 5000, updatedAt: now - 5000 },
      {
        id: 'arch-root',
        personaId: 'default',
        title: 'Architecture: Strategic Decision Council',
        kind: 'agent-flow',
        parentSessionId: 'host',
        runtimeContext: {
          runtimeKind: 'agent-flow-branch',
          architectureContext: {
            architectureRunId: 'run-live',
            schemaName: 'Strategic Decision Council',
            displayLabel: 'Strategic Decision Council',
          },
        },
        createdAt: now - 4000,
        updatedAt: now - 4000,
      },
    ];
    mockState.sessions = architectureSessions;
    mockState.activeSessionId = null;
    mockState.sessionMessages = { host: [], 'arch-root': [] };
    sessionStorage.setItem('kalio:last-active-session-id', 'host');
    mockApiGet.mockImplementation((url: string) => {
      if (url === '/api/sessions') return Promise.resolve({ data: architectureSessions });
      if (url === '/api/personas') return Promise.resolve({ data: mockPersonas });
      if (url === '/api/sessions/host/messages') {
        return Promise.resolve({
          data: [
            { id: 'user-1', sessionId: 'host', role: 'user', content: 'Plan it.', createdAt: now - 3000 },
          ],
        });
      }
      if (url === '/api/sessions/arch-root/messages') {
        return Promise.resolve({
          data: [
            {
              id: 'arch-summary',
              sessionId: 'arch-root',
              role: 'assistant',
              content: '',
              architectureRun: {
                runId: 'run-live',
                schemaId: 'Strategic Decision Council',
                status: 'running',
                trace: [],
                routeHops: [],
                graphNodes: [
                  { id: 'router', label: 'Router', kind: 'router', status: 'running', eventIds: ['event-router'] },
                  { id: 'analyst', label: 'Analyst', kind: 'role', status: 'pending', eventIds: [] },
                ],
                graphEdges: [],
              },
              createdAt: now - 2000,
            },
          ],
        });
      }
      return Promise.resolve({ data: [] });
    });

    render(<SessionPanel />);

    await waitFor(() => expect(mockSetActiveSession).toHaveBeenCalledWith('host'));
    await waitFor(() => expect(mockSetMessages).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'architecture-rehydrate:host:run-live',
          architectureRun: expect.objectContaining({
            runId: 'run-live',
            status: 'running',
          }),
        }),
      ]),
      'host',
    ));
    expect(mockSetMessages).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ id: 'arch-summary', sessionId: 'arch-root' }),
      ]),
      'arch-root',
    );
  });

  it('normalizes a stored architecture envelope selection back to the host session before reload hydration', async () => {
    const now = Date.now();
    const architectureSessions: ChatSession[] = [
      { id: 'host', personaId: 'default', title: 'Parent chat', createdAt: now - 5000, updatedAt: now - 5000 },
      {
        id: 'arch-root',
        personaId: 'default',
        title: 'Architecture: What can you do?',
        kind: 'agent-flow',
        parentSessionId: 'host',
        runtimeContext: {
          runtimeKind: 'agent-flow-branch',
          architectureContext: {
            architectureRunId: 'run-live',
            schemaName: 'Strategic Decision Council',
            displayLabel: 'Strategic Decision Council',
          },
        },
        createdAt: now - 4000,
        updatedAt: now - 4000,
      },
    ];

    mockState.sessions = architectureSessions;
    mockState.activeSessionId = null;
    mockState.sessionMessages = { host: [], 'arch-root': [] };
    sessionStorage.setItem('kalio:last-active-session-id', 'arch-root');
    mockApiGet.mockImplementation((url: string) => {
      if (url === '/api/sessions') return Promise.resolve({ data: architectureSessions });
      if (url === '/api/personas') return Promise.resolve({ data: mockPersonas });
      if (url === '/api/sessions/host/messages') {
        return Promise.resolve({
          data: [{ id: 'user-1', sessionId: 'host', role: 'user', content: 'Plan it.', createdAt: now - 3000 }],
        });
      }
      if (url === '/api/sessions/arch-root/messages') {
        return Promise.resolve({
          data: [
            {
              id: 'arch-summary',
              sessionId: 'arch-root',
              role: 'assistant',
              content: '',
              architectureRun: {
                runId: 'run-live',
                schemaId: 'Strategic Decision Council',
                status: 'running',
                trace: [],
                routeHops: [],
                graphNodes: [
                  { id: 'router', label: 'Router', kind: 'router', status: 'running', eventIds: ['event-router'] },
                ],
                graphEdges: [],
              },
              createdAt: now - 2000,
            },
          ],
        });
      }
      return Promise.resolve({ data: [] });
    });

    render(<SessionPanel />);

    await waitFor(() => expect(mockSetActiveSession).toHaveBeenCalledWith('host'));
    expect(mockApiGet).toHaveBeenCalledWith('/api/sessions/host/messages');
    expect(mockApiGet).toHaveBeenCalledWith('/api/sessions/arch-root/messages');
    await waitFor(() => expect(sessionStorage.getItem('kalio:last-active-session-id')).toBe('host'));
  });

  it('restores a stored architecture branch selection on cold load instead of falling back to the first root chat', async () => {
    const now = Date.now();
    const architectureSessions: ChatSession[] = [
      { id: 'host', personaId: 'default', title: 'Parent chat', createdAt: now - 5_000, updatedAt: now - 5_000 },
      {
        id: 'arch-root',
        personaId: 'default',
        title: 'Architecture: Strategic Decision Council',
        kind: 'agent-flow',
        parentSessionId: 'host',
        runtimeContext: {
          runtimeKind: 'chat',
          architectureContext: {
            architectureRunId: 'run-live',
            schemaName: 'Strategic Decision Council',
            displayLabel: 'Strategic Decision Council',
          },
        },
        createdAt: now - 4_000,
        updatedAt: now - 4_000,
      },
      {
        id: 'arch-analyst',
        personaId: 'web-research',
        title: 'Strategic Decision Council: Analyst',
        kind: 'subagent',
        parentSessionId: 'arch-root',
        runtimeContext: {
          runtimeKind: 'agent-flow-branch',
          parentToolCallId: 'architecture:run-live:analyst',
          architectureSlotId: 'analyst',
          architectureContext: {
            architectureRunId: 'run-live',
            roleSlotId: 'analyst',
            displayLabel: 'Analyst',
          },
        },
        createdAt: now - 3_000,
        updatedAt: now - 3_000,
      },
    ];

    mockState.sessions = architectureSessions;
    mockState.activeSessionId = null;
    mockState.sessionMessages = { host: [], 'arch-root': [], 'arch-analyst': [] };
    sessionStorage.setItem('kalio:last-active-session-id', 'arch-analyst');
    mockApiGet.mockImplementation((url: string) => {
      if (url === '/api/sessions') return Promise.resolve({ data: architectureSessions });
      if (url === '/api/personas') return Promise.resolve({ data: mockPersonas });
      if (url === '/api/sessions/arch-analyst/messages') {
        return Promise.resolve({
          data: [
            { id: 'branch-user-1', sessionId: 'arch-analyst', role: 'user', content: 'Inspect repo.', createdAt: now - 2_000 },
            { id: 'branch-assistant-1', sessionId: 'arch-analyst', role: 'assistant', content: 'Analyst answer.', createdAt: now - 1_000 },
          ],
        });
      }
      return Promise.resolve({ data: [] });
    });

    render(<SessionPanel />);

    await waitFor(() => expect(mockSetActiveSession).toHaveBeenCalledWith('arch-analyst'));
    expect(mockApiGet).toHaveBeenCalledWith('/api/sessions/arch-analyst/messages');
    await waitFor(() => expect(sessionStorage.getItem('kalio:last-active-session-id')).toBe('arch-analyst'));
  });

  it('rehydrates the active host timeline once real architecture descendants appear after an initial user-only reload', async () => {
    const now = Date.now();
    const architectureSessions: ChatSession[] = [
      {
        id: 'host',
        personaId: 'default',
        title: 'Parent chat',
        createdAt: now - 5_000,
        updatedAt: now - 5_000,
        runtimeContext: {
          runtimeKind: 'chat',
          architectureContext: {
            schemaId: 'strategic-decision-council',
            schemaName: 'Strategic Decision Council',
            displayLabel: 'Strategic Decision Council',
          },
        },
      },
      {
        id: 'arch-root',
        personaId: 'default',
        title: 'Architecture: Strategic Decision Council',
        kind: 'chat',
        parentSessionId: 'host',
        runtimeContext: {
          runtimeKind: 'chat',
          architectureContext: {
            architectureRunId: 'run-live',
            schemaId: 'strategic-decision-council',
            schemaName: 'Strategic Decision Council',
            displayLabel: 'Strategic Decision Council',
          },
        },
        createdAt: now - 4_000,
        updatedAt: now - 4_000,
      },
      {
        id: 'arch-pragmatist',
        personaId: 'dev',
        title: 'Strategic Decision Council: Pragmatist',
        kind: 'subagent',
        parentSessionId: 'arch-root',
        runtimeContext: {
          runtimeKind: 'agent-flow-branch',
          architectureSlotId: 'pragmatist',
          parentToolCallId: 'architecture:run-live:pragmatist',
          architectureContext: {
            parentSessionId: 'host',
            roleSlotId: 'pragmatist',
            displayLabel: 'Pragmatist',
          },
        },
        createdAt: now - 3_000,
        updatedAt: now - 3_000,
      },
    ];

    mockState.sessions = architectureSessions;
    mockState.activeSessionId = 'host';
    mockState.sessionMessages = {
      host: [
        { id: 'user-1', sessionId: 'host', role: 'user', content: 'Assess this repository.', createdAt: now - 2_000 },
      ],
      'arch-root': [],
      'arch-pragmatist': [],
    };

    mockApiGet.mockImplementation((url: string) => {
      if (url === '/api/sessions') return Promise.resolve({ data: architectureSessions });
      if (url === '/api/personas') return Promise.resolve({ data: mockPersonas });
      if (url === '/api/sessions/host/messages') {
        return Promise.resolve({
          data: [
            { id: 'user-1', sessionId: 'host', role: 'user', content: 'Assess this repository.', createdAt: now - 2_000 },
            {
              id: 'assistant-tools',
              sessionId: 'host',
              role: 'assistant',
              content: '',
              createdAt: now - 1_500,
              toolCalls: [
                {
                  id: 'architecture:run-live:event-pragmatist',
                  name: 'run_subagent',
                  args: {
                    architectureRunId: 'run-live',
                    schemaName: 'Strategic Decision Council',
                    nodeId: 'pragmatist',
                    childSessionId: 'arch-pragmatist',
                  },
                },
              ],
            },
            {
              id: 'tool-result-pragmatist',
              sessionId: 'host',
              role: 'tool_result',
              content: JSON.stringify({
                result: 'Pragmatist answer',
                taskId: 'run-live:event-pragmatist',
                childSessionId: 'arch-pragmatist',
                parentSessionId: 'host',
                vfsMode: 'shared',
                vfsSessionId: 'arch-root',
                copiedFiles: [],
                durationMs: 0,
              }),
              toolCallId: 'architecture:run-live:event-pragmatist',
              createdAt: now - 1_400,
            },
            {
              id: 'router-text',
              sessionId: 'host',
              role: 'assistant',
              content: '### Router\n\nRouter selected the final path.',
              createdAt: now - 1_300,
            },
            {
              id: 'finalizer-text',
              sessionId: 'host',
              role: 'assistant',
              content: '### Finalizer\n\nFinal answer.',
              createdAt: now - 1_200,
            },
          ],
        });
      }
      return Promise.resolve({ data: [] });
    });

    render(<SessionPanel />);

    await waitFor(() => expect(mockSetSessions).toHaveBeenCalledWith(architectureSessions));
    await waitFor(() => expect(mockApiGet).toHaveBeenCalledWith('/api/sessions/host/messages'));
    await waitFor(() => expect(mockSetMessages).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'architecture-rehydrate:host:run-live',
          architectureRun: expect.objectContaining({
            runId: 'run-live',
            hostProjectionKind: 'workflow-envelope',
          }),
        }),
      ]),
      'host',
    ));
    await waitFor(() => expect(mockSetAgentTurns).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          sessionId: 'host',
          turnKind: 'workflow-envelope',
        }),
      ]),
      'host',
    ));
  });

  it('rehydrates the active host timeline even before branch session events arrive', async () => {
    const now = Date.now();
    const architectureSessions: ChatSession[] = [
      {
        id: 'host',
        personaId: 'default',
        title: 'Parent chat',
        createdAt: now - 5_000,
        updatedAt: now,
        runtimeContext: {
          runtimeKind: 'chat',
          architectureContext: {
            schemaId: 'strategic-decision-council',
            schemaName: 'Strategic Decision Council',
            displayLabel: 'Strategic Decision Council',
          },
        },
      },
      {
        id: 'arch-root',
        personaId: 'default',
        title: 'Architecture: Strategic Decision Council',
        kind: 'chat',
        parentSessionId: 'host',
        runtimeContext: {
          runtimeKind: 'chat',
          architectureContext: {
            architectureRunId: 'run-live',
            schemaId: 'strategic-decision-council',
            schemaName: 'Strategic Decision Council',
            displayLabel: 'Strategic Decision Council',
          },
        },
        createdAt: now - 4_000,
        updatedAt: now - 4_000,
      },
    ];

    mockState.sessions = architectureSessions;
    mockState.activeSessionId = 'host';
    mockState.sessionMessages = {
      host: [
        { id: 'user-1', sessionId: 'host', role: 'user', content: 'Assess this repository.', createdAt: now - 2_000 },
      ],
      'arch-root': [],
    };

    let hostMessageLoads = 0;
    mockApiGet.mockImplementation((url: string) => {
      if (url === '/api/sessions') return Promise.resolve({ data: architectureSessions });
      if (url === '/api/personas') return Promise.resolve({ data: mockPersonas });
      if (url === '/api/sessions/host/messages') {
        hostMessageLoads += 1;
        if (hostMessageLoads === 1) {
          return Promise.resolve({
            data: [
              { id: 'user-1', sessionId: 'host', role: 'user', content: 'Assess this repository.', createdAt: now - 2_000 },
            ],
          });
        }
        return Promise.resolve({
          data: [
            { id: 'user-1', sessionId: 'host', role: 'user', content: 'Assess this repository.', createdAt: now - 2_000 },
            {
              id: 'assistant-tools',
              sessionId: 'host',
              role: 'assistant',
              content: '',
              createdAt: now - 1_500,
              toolCalls: [
                {
                  id: 'architecture:run-live:event-pragmatist',
                  name: 'run_subagent',
                  args: {
                    architectureRunId: 'run-live',
                    schemaName: 'Strategic Decision Council',
                    nodeId: 'pragmatist',
                    childSessionId: 'arch-pragmatist',
                  },
                },
              ],
            },
            {
              id: 'tool-result-pragmatist',
              sessionId: 'host',
              role: 'tool_result',
              content: JSON.stringify({
                result: 'Pragmatist answer',
                taskId: 'run-live:event-pragmatist',
                childSessionId: 'arch-pragmatist',
                parentSessionId: 'host',
                vfsMode: 'shared',
                vfsSessionId: 'arch-root',
                copiedFiles: [],
                durationMs: 0,
              }),
              toolCallId: 'architecture:run-live:event-pragmatist',
              createdAt: now - 1_400,
            },
            {
              id: 'router-text',
              sessionId: 'host',
              role: 'assistant',
              content: '### Router\n\nRouter selected the final path.',
              createdAt: now - 1_300,
            },
            {
              id: 'finalizer-text',
              sessionId: 'host',
              role: 'assistant',
              content: '### Finalizer\n\nFinal answer.',
              createdAt: now - 1_200,
            },
          ],
        });
      }
      return Promise.resolve({ data: [] });
    });

    render(<SessionPanel />);

    await waitFor(() => expect(mockSetSessions).toHaveBeenCalledWith(architectureSessions));
    await waitFor(() => expect(hostMessageLoads).toBeGreaterThanOrEqual(2), { timeout: 5_000 });
    await waitFor(() => expect(mockSetMessages).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'architecture-rehydrate:host:run-live',
          architectureRun: expect.objectContaining({
            runId: 'run-live',
            hostProjectionKind: 'workflow-envelope',
          }),
        }),
      ]),
      'host',
    ));
  });

  it('persists the active session id when a session is clicked', async () => {
    mockApiGet.mockImplementation((url: string) => {
      if (url === '/api/sessions') return Promise.resolve({ data: mockSessions });
      if (url === '/api/personas') return Promise.resolve({ data: mockPersonas });
      if (url === '/api/sessions/s2/messages') return Promise.resolve({ data: [] });
      return Promise.resolve({ data: [] });
    });

    render(<SessionPanel />);
    await waitFor(() => expect(mockSetSessions).toHaveBeenCalled());

    const items = screen.getAllByTestId('session-item');
    fireEvent.click(items[0]!);

    await waitFor(() => expect(sessionStorage.getItem('kalio:last-active-session-id')).toBe('s2'));
  });

  it('rebuilds agent turns from fetched history when the selected session has no live turn', async () => {
    mockApiGet.mockImplementation((url: string) => {
      if (url === '/api/sessions') return Promise.resolve({ data: mockSessions });
      if (url === '/api/personas') return Promise.resolve({ data: mockPersonas });
      if (url === '/api/sessions/s2/messages') {
        return Promise.resolve({
          data: [
            { id: 'u1', sessionId: 's2', role: 'user', content: 'What can you do?', createdAt: 1 },
            { id: 'a1', sessionId: 's2', role: 'assistant', content: 'Answer', createdAt: 2 },
          ],
        });
      }
      return Promise.resolve({ data: [] });
    });

    render(<SessionPanel />);
    await waitFor(() => expect(mockSetSessions).toHaveBeenCalled());

    const items = screen.getAllByTestId('session-item');
    fireEvent.click(items[0]!);

    await waitFor(() => expect(mockSetAgentTurns).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ done: true, sessionId: 's2' })]),
      's2',
    ));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// REGRESSION: orphaned pendingConfirmations on session deletion
//
// Root cause: removeSession() removes the session from the list but does NOT
// clean up the corresponding pendingConfirmations entry in agentStore. The
// dangling entry leaks memory and could cause key errors if the session id is
// ever reused or if the store is iterated.
// ─────────────────────────────────────────────────────────────────────────────

describe('REGRESSION: pendingConfirmations cleaned up on session delete', () => {
  it('deleting a session calls setPendingConfirmation(id, null)', async () => {
    mockApiDelete.mockResolvedValue({});
    mockApiGet.mockImplementation((url: string) => {
      if (url === '/api/sessions') return Promise.resolve({ data: mockSessions });
      if (url === '/api/personas') return Promise.resolve({ data: mockPersonas });
      return Promise.resolve({ data: [] });
    });

    render(<SessionPanel />);
    await waitFor(() => expect(mockSetSessions).toHaveBeenCalled());

    // Click delete on the first session (s2, sorted newest-first by updatedAt)
    const deleteButtons = screen.getAllByTitle('Delete');
    fireEvent.click(deleteButtons[0]!);

    // Wait for the async delete + cleanup chain to finish
    await waitFor(() => expect(mockSetPendingConfirmation).toHaveBeenCalledWith('s2', null));
  });

  it('deleting or archiving a session also clears pending budget approvals', async () => {
    mockApiDelete.mockResolvedValue({});
    mockApiPost.mockResolvedValue({});
    mockApiGet.mockImplementation((url: string) => {
      if (url === '/api/sessions') return Promise.resolve({ data: mockSessions });
      if (url === '/api/personas') return Promise.resolve({ data: mockPersonas });
      return Promise.resolve({ data: [] });
    });

    render(<SessionPanel />);
    await waitFor(() => expect(mockSetSessions).toHaveBeenCalled());

    const deleteButtons = screen.getAllByTitle('Delete');
    fireEvent.click(deleteButtons[0]!);
    await waitFor(() => expect(mockSetPendingBudgetApproval).toHaveBeenCalledWith('s2', null));

    chooseOriginFilter('agent');
    const archiveButtons = screen.getAllByTitle('Archive');
    fireEvent.click(archiveButtons[0]!);
    await waitFor(() => expect(mockSetPendingBudgetApproval).toHaveBeenCalledWith('s2', null));
  });
});

