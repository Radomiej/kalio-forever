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
import type { AgentBudgetApprovalRequest, RuntimeActivitySnapshot, ToolConfirmationRequest } from '@kalio/types';

// ── mocks ─────────────────────────────────────────────────────────────────────

let mockPendingConfirmations: Record<string, ToolConfirmationRequest> = {};
let mockPendingBudgetApprovals: Record<string, AgentBudgetApprovalRequest> = {};
let mockActiveAgentLoops: Record<string, { sessionId: string; turnId: string; startedAt: number }> = {};
let mockQueuedDepthBySession: Record<string, number> = {};
let mockSessionStatusSnapshots: Record<string, unknown> = {};
let mockRuntimeActivitySnapshots: Record<string, RuntimeActivitySnapshot> = {};
let mockSessionToolActivities: Record<string, unknown[]> = {};
type MockSessionRow = {
  id: string;
  title: string;
  personaId: string;
  createdAt: number;
  updatedAt: number;
  parentSessionId?: string;
  kind?: string;
};

vi.mock('../../store/agentStore', () => ({
  useAgentStore: (selector: (s: unknown) => unknown) =>
    selector({
      pendingConfirmations: mockPendingConfirmations,
      pendingBudgetApprovals: mockPendingBudgetApprovals,
      activeAgentLoops: mockActiveAgentLoops,
      queuedDepthBySession: mockQueuedDepthBySession,
      sessionStatusSnapshots: mockSessionStatusSnapshots,
      runtimeActivitySnapshots: mockRuntimeActivitySnapshots,
      sessionToolActivities: mockSessionToolActivities,
    }),
}));

const mockSetActiveSession = vi.fn();
const mockSessionStoreState = {
  sessions: [
    { id: 'session-1', title: 'Chat One', personaId: 'default', createdAt: 0, updatedAt: 0 },
    { id: 'session-2', title: 'Chat Two', personaId: 'default', createdAt: 0, updatedAt: 0 },
  ] as MockSessionRow[],
  activeSessionId: 'session-1',
  setSessions: vi.fn(),
  setActiveSession: mockSetActiveSession,
  addSession: vi.fn(),
  setMessages: vi.fn(),
  setAgentTurns: vi.fn(),
  getSessionActiveTurnId: vi.fn(() => null),
  removeSession: vi.fn(),
  updateSession: vi.fn(),
  sessionAgentTurns: {} as Record<string, unknown>,
  sessionMessages: {} as Record<string, unknown>,
};

vi.mock('../../store/sessionStore', () => ({
  useSessionStore: Object.assign(
    (selector?: (state: typeof mockSessionStoreState) => unknown) =>
      selector ? selector(mockSessionStoreState) : mockSessionStoreState,
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
  mockPendingBudgetApprovals = {};
  mockActiveAgentLoops = {};
  mockQueuedDepthBySession = {};
  mockSessionStatusSnapshots = {};
  mockRuntimeActivitySnapshots = {};
  mockSessionToolActivities = {};
  mockSessionStoreState.sessions = [
    { id: 'session-1', title: 'Chat One', personaId: 'default', createdAt: 0, updatedAt: 0 },
    { id: 'session-2', title: 'Chat Two', personaId: 'default', createdAt: 0, updatedAt: 0 },
  ];
  mockSessionStoreState.sessionAgentTurns = {};
  mockSessionStoreState.sessionMessages = {};
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

  it('shows running icon for an active session loop', async () => {
    mockRuntimeActivitySnapshots = {
      'session-2': {
        sessionId: 'session-2',
        active: true,
        turnId: 'turn-1',
        queueLength: 0,
        pendingConfirmations: [],
        pendingBudgetApprovals: [],
        toolActivities: [],
        childExecutions: [],
        updatedAt: 1,
      },
    };

    await renderSessionPanel();

    expect(screen.getByTestId('session-running-session-2')).toBeDefined();
  });

  it('shows completed icon when the latest turn finished successfully', async () => {
    mockSessionStoreState.sessionAgentTurns = {
      'session-2': [{
        id: 'turn-1',
        sessionId: 'session-2',
        items: [],
        done: true,
      }],
    };

    await renderSessionPanel();

    expect(screen.getByTestId('session-done-session-2')).toBeDefined();
  });

  it('shows error icon when the latest turn failed', async () => {
    mockSessionStoreState.sessionAgentTurns = {
      'session-2': [{
        id: 'turn-1',
        sessionId: 'session-2',
        items: [],
        done: false,
        error: { code: 'tool_failed', message: 'Tool execution failed' },
      }],
    };

    await renderSessionPanel();

    expect(screen.getByTestId('session-error-session-2')).toBeDefined();
  });

  it('shows waiting descendant badge on parent rows when child session is pending approval', async () => {
    mockSessionStoreState.sessions = [
      { id: 'session-1', title: 'Chat One', personaId: 'default', createdAt: 0, updatedAt: 0 },
      { id: 'child-1', title: 'Child One', personaId: 'default', parentSessionId: 'session-1', kind: 'subagent', createdAt: 0, updatedAt: 0 },
    ];
    mockPendingBudgetApprovals = {
      'child-1': {
        requestId: 'budget-1',
        sessionId: 'child-1',
        scope: 'subagent',
        usedIterations: 8,
        currentLimit: 8,
        agentRun: { agentRunId: 'run-1', agentType: 'subagent' },
      },
    };

    await renderSessionPanel();

    expect(screen.getByTestId('session-descendant-activity-session-1')).toHaveTextContent('1 waiting');
  });
});
