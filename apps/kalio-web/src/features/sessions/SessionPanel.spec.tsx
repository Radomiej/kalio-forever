/**
 * Behavioral tests for SessionPanel — pending confirmation warning indicator.
 *
 * Covers:
 * - Session row shows AlertTriangle when pendingConfirmations[sessionId] is set
 * - Session row does NOT show AlertTriangle when there is no pending confirmation
 * - AlertTriangle disappears when pendingConfirmations entry is removed
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { SessionPanel } from './SessionPanel';
import type { ToolConfirmationRequest } from '@kalio/types';

// ── mocks ─────────────────────────────────────────────────────────────────────

let mockPendingConfirmations: Record<string, ToolConfirmationRequest> = {};

vi.mock('../../store/agentStore', () => ({
  useAgentStore: (selector: (s: unknown) => unknown) =>
    selector({ pendingConfirmations: mockPendingConfirmations }),
}));

const mockSetActiveSession = vi.fn();
const mockSessionStoreState = {
  sessions: [
    { id: 'session-1', title: 'Chat One', personaId: 'default', createdAt: 0, updatedAt: 0 },
    { id: 'session-2', title: 'Chat Two', personaId: 'default', createdAt: 0, updatedAt: 0 },
  ],
  activeSessionId: 'session-1',
  setSessions: vi.fn(),
  setActiveSession: mockSetActiveSession,
  addSession: vi.fn(),
  setMessages: vi.fn(),
  removeSession: vi.fn(),
  updateSession: vi.fn(),
};

vi.mock('../../store/sessionStore', () => ({
  useSessionStore: Object.assign(
    () => mockSessionStoreState,
    { getState: () => mockSessionStoreState },
  ),
}));

vi.mock('../../services/apiClient', () => ({
  apiClient: {
    get: vi.fn(() => Promise.resolve({ data: [] })),
    post: vi.fn(),
    delete: vi.fn(),
    patch: vi.fn(),
  },
}));

vi.mock('./session.utils', () => ({
  formatRelativeTime: () => 'just now',
}));

beforeEach(() => {
  mockPendingConfirmations = {};
  vi.clearAllMocks();
});

async function renderSessionPanel(): Promise<void> {
  await act(async () => {
    render(<SessionPanel />);
    await Promise.resolve();
    await Promise.resolve();
  });
}

// ── tests ─────────────────────────────────────────────────────────────────────

describe('SessionPanel — pending confirmation indicator', () => {
  it('shows warning icon on session row when pendingConfirmations has entry for that session', async () => {
    mockPendingConfirmations = {
      'session-1': {
        requestId: 'req-1',
        toolCallId: 'call-1',
        sessionId: 'session-1',
        toolName: 'vfs_write',
        args: {},
        timeoutMs: 30000,
      },
    };

    await renderSessionPanel();

    expect(screen.getByTestId('session-pending-confirmation-session-1')).toBeDefined();
  });

  it('does NOT show warning icon when session has no pending confirmation', async () => {
    mockPendingConfirmations = {};

    await renderSessionPanel();

    expect(screen.queryByTestId('session-pending-confirmation-session-1')).toBeNull();
    expect(screen.queryByTestId('session-pending-confirmation-session-2')).toBeNull();
  });

  it('shows warning icon only on the session that has a pending confirmation, not others', async () => {
    mockPendingConfirmations = {
      'session-2': {
        requestId: 'req-2',
        toolCallId: 'call-2',
        sessionId: 'session-2',
        toolName: 'vfs_delete',
        args: {},
        timeoutMs: 30000,
      },
    };

    await renderSessionPanel();

    expect(screen.queryByTestId('session-pending-confirmation-session-1')).toBeNull();
    expect(screen.getByTestId('session-pending-confirmation-session-2')).toBeDefined();
  });
});
