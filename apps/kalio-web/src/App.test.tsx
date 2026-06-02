import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { App } from './App';
import type { LLMConfigWithSource } from './features/settings/llm-panel.types';

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
  fetchMock,
  agentStoreState,
  setActiveSession,
} = vi.hoisted(() => ({
  setCanvasOpen: vi.fn(),
  setBackendConfig: vi.fn(),
  fetchMock: vi.fn(),
  setActiveSession: vi.fn(),
  agentStoreState: {
    pendingConfirmations: {} as Record<string, unknown>,
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
  ConversationPanel: ({ viewSwitcher }: { viewSwitcher?: React.ReactNode }) => (
    <div data-testid="conversation-panel">
      Conversations
      {viewSwitcher}
    </div>
  ),
}));

vi.mock('./features/sessions/ConversationManagerPanel', () => ({
  ConversationManagerPanel: () => <div data-testid="conversation-manager-panel">Active</div>,
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
  useSessionStore: (selector?: (state: { sessions: Array<{ id: string; updatedAt: number }>; setActiveSession: typeof setActiveSession }) => unknown) => {
    const now = Date.now();
    const state = {
      sessions: [
        { id: 'session-1', updatedAt: now - 60_000 },
        { id: 'session-2', updatedAt: now - 48 * 60 * 60 * 1000 },
      ],
      setActiveSession,
    };
    return selector ? selector(state) : state;
  },
}));

vi.mock('./store/agentStore', () => ({
  useAgentStore: (selector: (state: {
    pendingConfirmations: Record<string, unknown>;
    setCanvasOpen: typeof setCanvasOpen;
  }) => unknown) => selector({ pendingConfirmations: agentStoreState.pendingConfirmations, setCanvasOpen }),
}));

vi.mock('./services/backendHealth', () => ({
  backendHealth: {
    start: vi.fn(),
  },
}));

vi.mock('./features/settings/settingsStore', () => ({
  useSettingsStore: (selector: (state: { setBackendConfig: typeof setBackendConfig }) => unknown) => selector({ setBackendConfig }),
}));

describe('App view state persistence', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    localStorage.clear();
    agentStoreState.pendingConfirmations = {};
    setActiveSession.mockReset();
    fetchMock.mockResolvedValue({
      json: async () => ({
        provider: 'mock',
        model: 'test-model',
        baseUrl: 'http://localhost',
        contextWindowSize: 32000,
        maxToolAttempts: 4,
      }),
    });
    vi.stubGlobal('fetch', fetchMock);
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
    expect(screen.queryByTestId('chat-interface')).not.toBeInTheDocument();
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
    expect(screen.queryByTestId('chat-interface')).not.toBeInTheDocument();
  });

  it('shows a dedicated graph entry in the Talk sidebar and switches views without creating a session first', () => {
    render(<App />);

    fireEvent.click(screen.getByTestId('landing-to-chat'));
    fireEvent.click(screen.getByTestId('talk-sidebar-graph-entry'));

    expect(screen.getByTestId('execution-graph-view')).toBeInTheDocument();
    expect(screen.queryByTestId('chat-interface')).not.toBeInTheDocument();
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
      requestA: {},
      requestB: {},
    };

    render(<App />);

    const badge = screen.getByTestId('nav-talk-activity-count');
    expect(badge).toHaveTextContent('2');
    expect(badge).toHaveAttribute('title', '2 approvals waiting');
    expect(badge).toHaveClass('badge-warning');
    expect(badge).toHaveClass('animate-pulse');
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
