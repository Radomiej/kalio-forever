import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { App } from './App';
import type { LLMConfigWithSource } from './features/settings/llm-panel.types';
import type { RuntimeActivitySnapshot } from '@kalio/types';

const CONFIG_WITH_API_KEY: LLMConfigWithSource = {
  provider: 'mock',
  model: 'test-model',
  baseUrl: 'http://localhost',
  apiKey: '',
  contextWindowSize: 32000,
  maxToolAttempts: 4,
  source: 'env',
};

const {
  setCanvasOpen,
  setBackendConfig,
  loadConversationSessions,
  loadRuntimeWatchlist,
  preloadRuntimeWatchSessionHistory,
  identifyWatchedSession,
  replaceBaselineWatchedSessions,
  resetSessionWatchConnectionEpoch,
  onReconnect,
  reconnectHandlers,
  agentStoreState,
  setActiveSession,
  setSessions,
  sessionStoreState,
} = vi.hoisted(() => ({
  setCanvasOpen: vi.fn(),
  setBackendConfig: vi.fn(),
  loadConversationSessions: vi.fn(),
  loadRuntimeWatchlist: vi.fn(),
  preloadRuntimeWatchSessionHistory: vi.fn().mockResolvedValue(undefined),
  identifyWatchedSession: vi.fn(),
  replaceBaselineWatchedSessions: vi.fn(),
  resetSessionWatchConnectionEpoch: vi.fn(),
  reconnectHandlers: [] as Array<() => void>,
  onReconnect: vi.fn((handler: () => void) => {
    reconnectHandlers.push(handler);
    return () => undefined;
  }),
  setActiveSession: vi.fn(),
  setSessions: vi.fn(),
  agentStoreState: {
    pendingConfirmations: {} as Record<string, unknown>,
    pendingBudgetApprovals: {} as Record<string, unknown>,
    runtimeActivitySnapshots: {} as Record<string, unknown>,
  },
  sessionStoreState: {
    sessions: [] as Array<{ id: string; updatedAt: number; title?: string; kind?: string; parentSessionId?: string }>,
    activeSessionId: null as string | null,
    messages: [] as Array<{ id: string }>,
    agentTurns: [] as Array<{ id: string }>,
    sessionMessages: {} as Record<string, Array<{ id: string; sessionId: string; role: string; content: string; createdAt: number }>>,
  },
}));

vi.mock('./features/chat/ChatInterface', () => ({
  ChatInterface: () => <div data-testid="chat-interface">Chat</div>,
}));

vi.mock('./features/chat/CanvasPanel', () => ({
  CanvasPanel: () => <div data-testid="canvas-panel">Canvas</div>,
}));

vi.mock('./features/chat/graph/ExecutionGraphView', () => ({
  ExecutionGraphView: ({ onOpenSessionInConversation }: { onOpenSessionInConversation?: (sessionId: string) => void }) => (
    <div data-testid="execution-graph-view">
      Graph
      <button
        type="button"
        data-testid="mock-open-child-chat"
        onClick={() => onOpenSessionInConversation?.('cli-child-1')}
      >
        Open child chat
      </button>
    </div>
  ),
}));

vi.mock('./features/sessions/ConversationPanel', () => ({
  ConversationPanel: ({
    onSelect,
    viewSwitcher,
  }: {
    onSelect?: () => void;
    viewSwitcher?: React.ReactNode;
  }) => (
    <div data-testid="conversation-panel">
      Conversations
      <button
        type="button"
        data-testid="mock-select-conversation"
        onClick={() => onSelect?.()}
      >
        Select conversation
      </button>
      {viewSwitcher}
    </div>
  ),
}));

vi.mock('./features/sessions/ConversationManagerPanel', () => ({
  ConversationManagerPanel: ({
    onNavigate,
    onOpenSession,
  }: {
    onNavigate?: () => void;
    onOpenSession?: (sessionId: string) => void;
  }) => (
    <div data-testid="conversation-manager-panel">
      Active
      <button
        type="button"
        data-testid="mock-open-agent-session"
        onClick={() => onOpenSession?.('agent-child-1')}
      >
        Open agent session
      </button>
      <button
        type="button"
        data-testid="mock-navigate-conversations"
        onClick={() => onNavigate?.()}
      >
        Go conversations
      </button>
    </div>
  ),
}));

vi.mock('./features/persona/PersonaPanel', () => ({
  PersonaPanel: () => <div data-testid="persona-panel">Personas</div>,
}));

vi.mock('./features/settings/SettingsModal', () => ({
  SettingsModal: () => <div data-testid="settings-modal">Settings</div>,
}));

vi.mock('./features/workspaces/WorkspacePanel', () => ({
  WorkspacePanel: () => <div data-testid="workspace-panel">Files</div>,
}));

vi.mock('./features/mcp/MCPPanel', () => ({
  MCPPanel: () => <div data-testid="mcp-panel">MCP</div>,
}));

vi.mock('./features/tools/ToolPanel', () => ({
  ToolPanel: () => <div data-testid="tool-panel">Native tools</div>,
}));

vi.mock('./features/raapp/RAAppManager', () => ({
  RAAppManager: () => <div data-testid="raapp-manager">RAApps</div>,
}));

vi.mock('./features/skills/SkillListPanel', () => ({
  SkillListPanel: () => <div data-testid="skill-list-panel">Skill list</div>,
}));

vi.mock('./features/skills/SkillEditorPanel', () => ({
  SkillEditorPanel: () => <div data-testid="skill-editor-panel">Skill editor</div>,
}));

vi.mock('./features/memory/MemoryPage', () => ({
  MemoryPage: () => <div data-testid="memory-page">Memory</div>,
}));

vi.mock('./features/landing/LandingPage', () => ({
  LandingPage: ({ onNavigateToChat }: { onNavigateToChat: () => void }) => (
    <div data-testid="landing-page">
      Landing
      <button data-testid="landing-to-chat" onClick={onNavigateToChat}>Open chat</button>
    </div>
  ),
}));

vi.mock('./components/ui/BackendStatusBadge', () => ({
  BackendStatusBadge: () => <div data-testid="backend-status-badge">Backend badge</div>,
}));

vi.mock('./features/observability/ObservabilityPage', () => ({
  ObservabilityPage: () => <div data-testid="observability-page">Observability</div>,
}));

vi.mock('./features/architect', () => ({
  ArchitectPage: () => <div data-testid="architect-page">Architect editor</div>,
}));

vi.mock('./store/sessionStore', () => ({
  useSessionStore: Object.assign((selector?: (state: {
    sessions: Array<{ id: string; updatedAt: number; title?: string }>;
    activeSessionId: string | null;
    messages: Array<{ id: string }>;
    agentTurns: Array<{ id: string }>;
    sessionMessages: Record<string, Array<{ id: string; sessionId: string; role: string; content: string; createdAt: number }>>;
    setActiveSession: typeof setActiveSession;
    setSessions: typeof setSessions;
  }) => unknown) => {
    const now = Date.now();
    const state = {
      sessions: [
        ...sessionStoreState.sessions,
        ...(sessionStoreState.activeSessionId === 'new-chat-session'
          ? [{ id: 'new-chat-session', title: 'New Chat', updatedAt: now }]
          : []),
      ],
      activeSessionId: sessionStoreState.activeSessionId,
      messages: sessionStoreState.messages,
      agentTurns: sessionStoreState.agentTurns,
      sessionMessages: sessionStoreState.sessionMessages,
      setActiveSession,
      setSessions,
    };
    return selector ? selector(state) : state;
  }, {
    getState: () => ({
      sessions: sessionStoreState.sessions,
      activeSessionId: sessionStoreState.activeSessionId,
      sessionMessages: sessionStoreState.sessionMessages,
    }),
  }),
}));

vi.mock('./services/apiClient', () => ({
  apiClient: {
    get: vi.fn((url: string) => {
      if (url === '/api/llm/config') {
        return Promise.resolve({ data: CONFIG_WITH_API_KEY });
      }
      return Promise.resolve({ data: [] });
    }),
  },
}));

vi.mock('./services/sessionBootstrap', () => ({
  loadConversationSessions,
  loadRuntimeWatchlist,
}));

vi.mock('./features/chat/runtimeWatchHistoryBootstrap', () => ({
  preloadRuntimeWatchSessionHistory,
}));

vi.mock('./services/sessionWatchRegistry', () => ({
  identifyWatchedSession,
  replaceBaselineWatchedSessions,
  resetSessionWatchConnectionEpoch,
}));

vi.mock('./services/eventBus', () => ({
  eventBus: {
    connected: true,
    onReconnect,
  },
}));

vi.mock('./store/agentStore', () => ({
  useAgentStore: (selector: (state: {
    pendingConfirmations: Record<string, unknown>;
    pendingBudgetApprovals: Record<string, unknown>;
    runtimeActivitySnapshots: Record<string, unknown>;
    setCanvasOpen: typeof setCanvasOpen;
  }) => unknown) => selector({
    pendingConfirmations: agentStoreState.pendingConfirmations,
    pendingBudgetApprovals: agentStoreState.pendingBudgetApprovals,
    runtimeActivitySnapshots: agentStoreState.runtimeActivitySnapshots,
    setCanvasOpen,
  }),
}));

vi.mock('./services/backendHealth', () => ({
  backendHealth: {
    start: vi.fn(),
  },
}));

vi.mock('./features/settings/settingsStore', () => ({
  useSettingsStore: (selector: (state: { setBackendConfig: typeof setBackendConfig }) => unknown) => selector({ setBackendConfig }),
}));

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
    updatedAt: 2,
    run: {
      id: 'run-1',
      sessionId,
      turnId: 'turn-1',
      phase: 'tool_running',
      status: 'waiting_on_orchestrator',
      retryCount: 0,
      safeResume: true,
      startedAt: 1,
      updatedAt: 2,
      lastHeartbeatAt: 2,
    } as unknown as RuntimeActivitySnapshot['run'],
  };
}

describe('App view state persistence', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    localStorage.clear();
    agentStoreState.pendingConfirmations = {};
    agentStoreState.pendingBudgetApprovals = {};
    agentStoreState.runtimeActivitySnapshots = {};
    sessionStoreState.sessions = [
      { id: 'session-1', title: 'Session 1', updatedAt: Date.now() - 60_000 },
      { id: 'session-2', updatedAt: Date.now() - 48 * 60 * 60 * 1000 },
    ];
    sessionStoreState.activeSessionId = null;
    sessionStoreState.messages = [];
    sessionStoreState.agentTurns = [];
    sessionStoreState.sessionMessages = {};
    setActiveSession.mockReset();
    setSessions.mockReset();
    identifyWatchedSession.mockReset();
    replaceBaselineWatchedSessions.mockReset();
    resetSessionWatchConnectionEpoch.mockReset();
    onReconnect.mockClear();
    reconnectHandlers.length = 0;
    loadConversationSessions.mockReset();
    loadRuntimeWatchlist.mockReset();
    preloadRuntimeWatchSessionHistory.mockReset();
    preloadRuntimeWatchSessionHistory.mockResolvedValue(undefined);
    loadConversationSessions.mockResolvedValue([
      { id: 'session-1', title: 'Session 1', updatedAt: Date.now() },
      { id: 'agent-child-1', title: 'Agent child', updatedAt: Date.now(), kind: 'subagent', parentSessionId: 'session-1' },
    ]);
    loadRuntimeWatchlist.mockResolvedValue([
      { sessionId: 'session-1', reasons: ['active'] },
    ]);
  });

  it('hydrates the stored section and nested tab on first mount', () => {
    sessionStorage.setItem('kalio:app-view-state', JSON.stringify({
      activeSection: 'mind',
      talkTab: 'agents',
      toolsTab: 'mcp',
      mindTab: 'personas',
      selectedSkillId: 'skill-42',
    }));

    render(<App />);

    expect(screen.getByTestId('persona-panel')).toBeInTheDocument();
    expect(screen.queryByTestId('landing-page')).not.toBeInTheDocument();
    expect(screen.queryByTestId('memory-page')).not.toBeInTheDocument();
  });

  it('restores the active section and nested tab after remount', async () => {
    const firstRender = render(<App />);

    fireEvent.click(screen.getByTestId('nav-tools'));
    fireEvent.click(screen.getByTestId('tools-tab-raapps'));

    expect(screen.getByTestId('raapp-manager')).toBeInTheDocument();

    firstRender.unmount();

    render(<App />);

    expect(screen.getByTestId('raapp-manager')).toBeInTheDocument();
    expect(screen.queryByTestId('landing-page')).not.toBeInTheDocument();
    expect(screen.queryByTestId('tool-panel')).not.toBeInTheDocument();
  });

  it('hydrates the stored talk graph view on first mount', () => {
    sessionStorage.setItem('kalio:app-view-state', JSON.stringify({
      activeSection: 'talk',
      talkTab: 'conversations',
      talkView: 'graph',
      toolsTab: 'native',
      mindTab: 'memory',
      selectedSkillId: null,
    }));

    render(<App />);

    expect(screen.getByTestId('execution-graph-view')).toBeInTheDocument();
    expect(screen.getByTestId('chat-interface')).toBeInTheDocument();
    expect(screen.queryByTestId('canvas-panel')).not.toBeInTheDocument();
  });

  it('persists the selected talk graph view after remount', () => {
    const firstRender = render(<App />);

    fireEvent.click(screen.getByTestId('landing-to-chat'));
    fireEvent.click(screen.getByTestId('talk-sidebar-graph-entry'));

    expect(screen.getByTestId('execution-graph-view')).toBeInTheDocument();

    firstRender.unmount();

    render(<App />);

    expect(screen.getByTestId('execution-graph-view')).toBeInTheDocument();
    expect(screen.getByTestId('chat-interface')).toBeInTheDocument();
  });

  it('shows a dedicated graph entry in the Talk sidebar and switches views without creating a session first', () => {
    render(<App />);

    fireEvent.click(screen.getByTestId('landing-to-chat'));
    fireEvent.click(screen.getByTestId('talk-sidebar-graph-entry'));

    expect(screen.getByTestId('execution-graph-view')).toBeInTheDocument();
    expect(screen.getByTestId('chat-interface')).toBeInTheDocument();
  });

  it('collapses and restores the Talk sidebar so the graph can use the full workspace', () => {
    sessionStorage.setItem('kalio:app-view-state', JSON.stringify({
      activeSection: 'talk',
      talkTab: 'conversations',
      talkView: 'graph',
      toolsTab: 'native',
      mindTab: 'memory',
      selectedSkillId: null,
    }));

    render(<App />);

    fireEvent.click(screen.getByTestId('talk-sidebar-collapse'));

    expect(screen.getByTestId('talk-sidebar-collapsed')).toBeInTheDocument();
    expect(screen.queryByTestId('conversation-panel')).not.toBeInTheDocument();
    expect(screen.getByTestId('execution-graph-view')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('talk-sidebar-expand'));

    expect(screen.getByTestId('conversation-panel')).toBeInTheDocument();
    expect(screen.queryByTestId('talk-sidebar-collapsed')).not.toBeInTheDocument();
  });

  it('switches to the graph view from the collapsed Talk sidebar rail', () => {
    sessionStorage.setItem('kalio:app-view-state', JSON.stringify({
      activeSection: 'talk',
      talkTab: 'conversations',
      talkView: 'conversation',
      toolsTab: 'native',
      mindTab: 'memory',
      selectedSkillId: null,
    }));

    render(<App />);

    fireEvent.click(screen.getByTestId('talk-sidebar-collapse'));
    const collapsedRail = screen.getByTestId('talk-sidebar-collapsed');
    fireEvent.click(collapsedRail.querySelector('[data-testid="talk-sidebar-graph-entry"]')!);

    expect(screen.getByTestId('execution-graph-view')).toBeInTheDocument();
    expect(screen.getByTestId('chat-interface')).toBeInTheDocument();
  });

  it('shows the conversation view when landing starts a chat from a stored graph view', () => {
    sessionStorage.setItem('kalio:app-view-state', JSON.stringify({
      activeSection: 'landing',
      talkTab: 'conversations',
      talkView: 'graph',
      toolsTab: 'native',
      mindTab: 'memory',
      selectedSkillId: null,
    }));

    render(<App />);

    fireEvent.click(screen.getByTestId('landing-to-chat'));

    expect(screen.getByTestId('chat-interface')).toBeInTheDocument();
    expect(screen.queryByTestId('execution-graph-view')).not.toBeInTheDocument();
  });

  it('keeps the graph view active for an empty New Chat session', () => {
    sessionStorage.setItem('kalio:app-view-state', JSON.stringify({
      activeSection: 'talk',
      talkTab: 'conversations',
      talkView: 'graph',
      toolsTab: 'native',
      mindTab: 'memory',
      selectedSkillId: null,
    }));
    sessionStoreState.activeSessionId = 'new-chat-session';
    sessionStoreState.messages = [];
    sessionStoreState.agentTurns = [];

    render(<App />);

    expect(screen.getByTestId('execution-graph-view')).toBeInTheDocument();
    expect(screen.getByTestId('chat-interface')).toBeInTheDocument();
  });

  it('opens graph child sessions in the conversation view', () => {
    sessionStorage.setItem('kalio:app-view-state', JSON.stringify({
      activeSection: 'talk',
      talkTab: 'conversations',
      talkView: 'graph',
      toolsTab: 'native',
      mindTab: 'memory',
      selectedSkillId: null,
    }));

    render(<App />);

    fireEvent.click(screen.getByTestId('mock-open-child-chat'));

    expect(setActiveSession).toHaveBeenCalledWith('cli-child-1');
    expect(screen.getByTestId('chat-interface')).toBeInTheDocument();
    expect(screen.queryByTestId('execution-graph-view')).not.toBeInTheDocument();
  });

  it('returns to the conversation view when the sidebar selects a conversation while graph is active', () => {
    sessionStorage.setItem('kalio:app-view-state', JSON.stringify({
      activeSection: 'talk',
      talkTab: 'conversations',
      talkView: 'graph',
      toolsTab: 'native',
      mindTab: 'memory',
      selectedSkillId: null,
    }));

    render(<App />);

    expect(screen.getByTestId('execution-graph-view')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('mock-select-conversation'));

    expect(screen.getByTestId('chat-interface')).toBeInTheDocument();
    expect(screen.queryByTestId('execution-graph-view')).not.toBeInTheDocument();
  });

  it('opens agent-run sessions in the conversation view from the agent sidebar', () => {
    sessionStorage.setItem('kalio:app-view-state', JSON.stringify({
      activeSection: 'talk',
      talkTab: 'agents',
      talkView: 'graph',
      toolsTab: 'native',
      mindTab: 'memory',
      selectedSkillId: null,
    }));

    render(<App />);

    expect(screen.getByTestId('conversation-manager-panel')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('mock-open-agent-session'));

    expect(setActiveSession).toHaveBeenCalledWith('agent-child-1');
    expect(screen.getByTestId('chat-interface')).toBeInTheDocument();
    expect(screen.queryByTestId('execution-graph-view')).not.toBeInTheDocument();
  });

  it('shows recent completed talk activity badge instead of total conversation count', () => {
    localStorage.setItem('kalio:last-talk-active-at', String(Date.now() - 10 * 60_000));

    render(<App />);

    const badge = screen.getByTestId('nav-talk-activity-count');
    expect(badge).toHaveTextContent('1');
    expect(badge).toHaveAttribute('title', '1 completed or updated chat since last Talk activity');
    expect(badge).not.toHaveTextContent('2');
  });

  it('prioritizes pending approval badge over completed talk activity', () => {
    localStorage.setItem('kalio:last-talk-active-at', String(Date.now() - 10 * 60_000));
    agentStoreState.pendingConfirmations = {
      'session-1': [
        {
          requestId: 'request-a',
          toolCallId: 'call-a',
          sessionId: 'session-1',
          toolName: 'fs_write',
          args: {},
          timeoutMs: 30_000,
        },
        {
          requestId: 'request-b',
          toolCallId: 'call-b',
          sessionId: 'session-1',
          toolName: 'fs_write',
          args: {},
          timeoutMs: 30_000,
        },
      ],
    };
    agentStoreState.pendingBudgetApprovals = {};

    render(<App />);

    const badge = screen.getByTestId('nav-talk-activity-count');
    expect(badge).toHaveTextContent('2');
    expect(badge).toHaveAttribute('title', '2 approvals waiting');
    expect(badge).toHaveClass('badge-warning');
    expect(badge).toHaveClass('animate-pulse');
  });

  it('uses runtime attention count for the Talk badge when a child session is waiting on the orchestrator', () => {
    agentStoreState.runtimeActivitySnapshots = {
      'session-1': makeWaitingRuntimeSnapshot('session-1'),
    };

    render(<App />);

    const badge = screen.getByTestId('nav-talk-activity-count');
    expect(badge).toHaveTextContent('1');
    expect(badge).toHaveAttribute('title', '1 runtime item needs attention');
    expect(badge).toHaveClass('badge-warning');
  });

  it('identifies only watched roots during bootstrap so Home can replay live HITL state', async () => {
    sessionStoreState.sessions = [];
    const sessionsFromApi = [
      { id: 'session-1', title: 'Session 1', updatedAt: 1 },
      { id: 'agent-child-1', title: 'Agent child', updatedAt: 2, kind: 'subagent', parentSessionId: 'session-1' },
    ];
    loadConversationSessions.mockResolvedValue(sessionsFromApi);
    loadRuntimeWatchlist.mockResolvedValue([
      { sessionId: 'session-1', reasons: ['pending_confirmation'] },
    ]);

    render(<App />);

    await waitFor(() => {
      expect(loadConversationSessions).toHaveBeenCalledWith();
    });
    expect(setSessions).toHaveBeenCalledWith([
      sessionsFromApi[0],
      sessionsFromApi[1],
    ]);
    expect(replaceBaselineWatchedSessions).toHaveBeenCalledWith(['session-1'], 'bootstrap-watchlist');
    expect(preloadRuntimeWatchSessionHistory).toHaveBeenCalledWith(expect.objectContaining({
      sessions: expect.arrayContaining([
        sessionsFromApi[0],
        sessionsFromApi[1],
      ]),
      runtimeWatchTargets: [{ sessionId: 'session-1', reasons: ['pending_confirmation'] }],
    }));
    expect(identifyWatchedSession).not.toHaveBeenCalledWith('agent-child-1', expect.any(String), expect.anything());
  });

  it('re-identifies only watched sessions after socket reconnect for Home HITL replay', () => {
    render(<App />);

    identifyWatchedSession.mockClear();
    reconnectHandlers[0]?.();

    return waitFor(() => {
      expect(resetSessionWatchConnectionEpoch).toHaveBeenCalledWith('socket-reconnect');
      expect(loadRuntimeWatchlist).toHaveBeenCalledWith({ force: true });
      expect(replaceBaselineWatchedSessions).toHaveBeenCalledWith(['session-1'], 'reconnect-watchlist');
      expect(preloadRuntimeWatchSessionHistory).toHaveBeenCalledWith(expect.objectContaining({
        sessions: expect.arrayContaining([
          expect.objectContaining({ id: 'agent-child-1', kind: 'subagent', parentSessionId: 'session-1' }),
          expect.objectContaining({ id: 'session-1', title: 'Session 1' }),
        ]),
        runtimeWatchTargets: [{ sessionId: 'session-1', reasons: ['active'] }],
        force: true,
      }));
    });
  });

  it('re-identifies the active session on reconnect so HITL replay restores pending approvals', () => {
    sessionStoreState.activeSessionId = 'session-1';

    render(<App />);

    identifyWatchedSession.mockClear();
    reconnectHandlers[0]?.();

    return waitFor(() => {
      expect(identifyWatchedSession).toHaveBeenCalledWith('session-1', 'reconnect-active-session', { sticky: true });
    });
  });

  it('preserves pending host sessions when the bootstrap response arrives late', async () => {
    let resolveSessions!: (value: Array<{ id: string; updatedAt: number; title?: string; kind?: string; parentSessionId?: string }>) => void;
    loadConversationSessions.mockImplementation(() => new Promise((resolve) => {
      resolveSessions = resolve;
    }));
    sessionStoreState.sessions = [];

    render(<App />);

    sessionStoreState.sessions = [
      { id: 'pending-host-session:temp-1', title: 'Local New', updatedAt: 10 },
    ];

    const delayedSessions = [
      { id: 'session-1', title: 'Session 1', updatedAt: 1 },
    ];

    await act(async () => {
      resolveSessions(delayedSessions);
    });

    await waitFor(() => {
      expect(setSessions).toHaveBeenCalledWith([
        { id: 'pending-host-session:temp-1', title: 'Local New', updatedAt: 10 },
        ...delayedSessions,
      ]);
    });
  });

  it('clears recent talk badge when user opens Talk', () => {
    localStorage.setItem('kalio:last-talk-active-at', String(Date.now() - 10 * 60_000));

    render(<App />);
    expect(screen.getByTestId('nav-talk-activity-count')).toHaveTextContent('1');

    fireEvent.click(screen.getByTestId('nav-talk'));

    expect(screen.queryByTestId('nav-talk-activity-count')).not.toBeInTheDocument();
  });

  it('opens the Architect section from the app rail', () => {
    render(<App />);

    fireEvent.click(screen.getByTestId('nav-architect'));

    expect(screen.getByTestId('architect-page')).toBeInTheDocument();
    expect(screen.queryByTestId('landing-page')).not.toBeInTheDocument();
  });

  it('opens the Observability section from the app rail', () => {
    render(<App />);

    fireEvent.click(screen.getByTestId('nav-observe'));

    expect(screen.getByTestId('observability-page')).toBeInTheDocument();
    expect(screen.queryByTestId('landing-page')).not.toBeInTheDocument();
  });

  it('REGRESSION: runtime config type accepts backend responses that include apiKey', () => {
    expect(CONFIG_WITH_API_KEY.apiKey).toBe('');
  });
});
