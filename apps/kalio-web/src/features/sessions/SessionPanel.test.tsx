import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { SessionPanel, formatRelativeTime } from './SessionPanel';
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
];

const mockPersonas: Persona[] = [
  { id: 'p1', name: 'Dev Assistant', systemPrompt: 'You are…', model: 'claude', skills: [], createdAt: 0, updatedAt: 0 },
];

const mockState = {
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
  useSessionStore: (selector?: (s: typeof mockState) => unknown) =>
    selector ? selector(mockState) : mockState,
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
    await waitFor(() => expect(screen.getByText('Dev Assistant')).toBeTruthy());
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

  it('filter button toggles filter row', async () => {
    render(<SessionPanel />);
    await waitFor(() => expect(mockSetSessions).toHaveBeenCalled());

    // Filter row not visible initially
    expect(screen.queryByText('All')).toBeNull();

    // Click filter toggle
    const filterBtn = screen.getByTitle('Filters');
    fireEvent.click(filterBtn);

    expect(screen.getByText('All')).toBeTruthy();
    // 'Dev Assistant' appears in both filter chip and session badge
    expect(screen.getAllByText('Dev Assistant').length).toBeGreaterThanOrEqual(1);
  });

  it('persona filter chips filter sessions', async () => {
    render(<SessionPanel />);
    await waitFor(() => expect(mockSetSessions).toHaveBeenCalled());

    fireEvent.click(screen.getByTitle('Filters'));
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
});
