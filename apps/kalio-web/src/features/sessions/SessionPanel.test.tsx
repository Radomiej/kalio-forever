import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { SessionPanel } from './SessionPanel';
import { formatRelativeTime } from './session.utils';
import type { ChatSession, Persona } from '@kalio/types';
import { DEFAULT_TEST_PERSONA_AVATAR } from '../../test/personaFixtures';

// ── Mocks ─────────────────────────────────────────────────────────────────────

const mockSetSessions = vi.fn();
const mockSetActiveSession = vi.fn();
const mockAddSession = vi.fn();
const mockSetMessages = vi.fn();
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
  removeSession: typeof mockRemoveSession;
  updateSession: typeof mockUpdateSession;
} = {
  sessions: mockSessions,
  activeSessionId: 's1',
  setSessions: mockSetSessions,
  setActiveSession: mockSetActiveSession,
  addSession: mockAddSession,
  setMessages: mockSetMessages,
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

vi.mock('../../store/agentStore', () => ({
  useAgentStore: Object.assign(
    (selector?: (s: { pendingConfirmations: Record<string, unknown>; setPendingConfirmation: typeof mockSetPendingConfirmation }) => unknown) => {
      const state = { pendingConfirmations: {}, setPendingConfirmation: mockSetPendingConfirmation };
      return selector ? selector(state) : state;
    },
    {
      getState: () => ({ pendingConfirmations: {}, setPendingConfirmation: mockSetPendingConfirmation }),
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
});

