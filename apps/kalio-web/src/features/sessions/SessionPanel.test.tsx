import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { SessionPanel } from './SessionPanel';
import { formatRelativeTime } from './session.utils';
import type { ChatSession, Persona } from '@kalio/types';

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

const mockPersonas: Persona[] = [
  { id: 'p1', name: 'Dev Assistant', systemPrompt: 'You are…', model: 'claude', allowedTools: [], skillIds: [], mcpPolicy: 'allow_all', createdAt: 0, updatedAt: 0 },
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

  it('renders subagent sessions with a badge', async () => {
    render(<SessionPanel />);
    await waitFor(() => expect(mockSetSessions).toHaveBeenCalledWith(mockSessions));

    expect(screen.getByText('Sub-agent: Landing page')).toBeTruthy();
    expect(screen.getByTestId('subagent-session-badge-sub-1')).toHaveTextContent('Sub-agent');
  });

  it('renders cli-agent child sessions with a badge', async () => {
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

    expect(screen.getByText('Codex CLI: inspect repository')).toBeTruthy();
    expect(screen.getByTestId('cli-agent-session-badge-cli-1')).toHaveTextContent('CLI agent');
  });

  it('keeps the master session above its grouped subagent sessions', async () => {
    render(<SessionPanel />);
    await waitFor(() => expect(mockSetSessions).toHaveBeenCalledWith(mockSessions));

    const orderedItems = screen.getAllByTestId('session-item').map((item) => item.textContent ?? '');
    const masterIndex = orderedItems.findIndex((text) => text.includes('Chat about React'));
    const subagentIndex = orderedItems.findIndex((text) => text.includes('Sub-agent: Landing page'));

    expect(masterIndex).toBeGreaterThanOrEqual(0);
    expect(subagentIndex).toBe(masterIndex + 1);
  });

  it('REGRESSION: keeps sibling subagent sessions in creation order under the master session', async () => {
    const orderedSessions: ChatSession[] = [
      { id: 'master', personaId: 'orchestrator', title: 'Main orchestration chat', createdAt: 1_000, updatedAt: 5_000 },
      { id: 'child-older', personaId: 'default', title: 'Sub-agent: older child', kind: 'subagent', parentSessionId: 'master', createdAt: 2_000, updatedAt: 6_000 },
      { id: 'child-newer', personaId: 'default', title: 'Sub-agent: newer child', kind: 'subagent', parentSessionId: 'master', createdAt: 3_000, updatedAt: 7_000 },
    ];

    mockState.sessions = orderedSessions;
    mockApiGet.mockImplementation((url: string) => {
      if (url === '/api/sessions') return Promise.resolve({ data: orderedSessions });
      if (url === '/api/personas') return Promise.resolve({ data: mockPersonas });
      return Promise.resolve({ data: [] });
    });

    render(<SessionPanel />);
    await waitFor(() => expect(mockSetSessions).toHaveBeenCalledWith(orderedSessions));

    const orderedItems = screen.getAllByTestId('session-item').map((item) => item.textContent ?? '');

    expect(orderedItems.slice(0, 3)).toEqual([
      expect.stringContaining('Main orchestration chat'),
      expect.stringContaining('Sub-agent: older child'),
      expect.stringContaining('Sub-agent: newer child'),
    ]);
  });

  it('filter button toggles filter row', async () => {
    render(<SessionPanel />);
    await waitFor(() => expect(mockSetSessions).toHaveBeenCalled());

    // Filter row is always visible when personas are available
    await waitFor(() => expect(screen.getByText('All')).toBeTruthy());
    expect(screen.getAllByText('Dev Assistant').length).toBeGreaterThanOrEqual(1);
  });

  it('persona filter chips filter sessions', async () => {
    render(<SessionPanel />);
    await waitFor(() => expect(mockSetSessions).toHaveBeenCalled());

    await waitFor(() => expect(screen.getAllByText('Dev Assistant').length).toBeGreaterThanOrEqual(1));

    // Click the filter chip button (not the persona badge span)
    fireEvent.click(screen.getByRole('button', { name: 'Dev Assistant' }));
    // Only s1 (personaId=p1) should show; s2 (personaId=default) hidden
    expect(screen.getByText('Chat about React')).toBeTruthy();
    expect(screen.queryByText('New Chat')).toBeNull();
  });

  it('new session button creates session with title "New Chat"', async () => {
    mockApiPost.mockResolvedValue({ data: { id: 's3', personaId: 'default', title: 'New Chat', createdAt: 3000, updatedAt: 3000 } });
    render(<SessionPanel />);
    await waitFor(() => expect(mockSetSessions).toHaveBeenCalled());

    const newBtn = screen.getByTestId('new-session-btn');
    fireEvent.click(newBtn);

    await waitFor(() => expect(mockApiPost).toHaveBeenCalledWith('/api/sessions', expect.objectContaining({ title: 'New Chat' })));
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

