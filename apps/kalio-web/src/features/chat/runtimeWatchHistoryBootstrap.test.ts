import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatSession } from '@kalio/types';
import {
  collectRuntimeWatchSessionIds,
  preloadRuntimeWatchSessionHistory,
} from './runtimeWatchHistoryBootstrap';

const {
  hydrateSessionHistoryIntoStore,
  fetchSessionHistoryWindow,
  sessionStoreGetState,
  agentStoreGetState,
} = vi.hoisted(() => ({
  hydrateSessionHistoryIntoStore: vi.fn(),
  fetchSessionHistoryWindow: vi.fn(),
  sessionStoreGetState: vi.fn(),
  agentStoreGetState: vi.fn(),
}));

vi.mock('./historyHydration', () => ({
  hydrateSessionHistoryIntoStore,
}));

vi.mock('./sessionHistoryApi', () => ({
  DEFAULT_CHILD_SESSION_HISTORY_LIMIT: 24,
  fetchSessionHistoryWindow,
}));

vi.mock('../../store/sessionStore', () => ({
  useSessionStore: {
    getState: sessionStoreGetState,
  },
}));

vi.mock('../../store/agentStore', () => ({
  useAgentStore: {
    getState: agentStoreGetState,
  },
}));

describe('runtimeWatchHistoryBootstrap', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchSessionHistoryWindow.mockResolvedValue({
      messages: [],
      meta: {
        totalCount: 0,
        hasMoreBefore: false,
        oldestLoadedMessageId: null,
      },
    });
    sessionStoreGetState.mockReturnValue({
      sessions: [],
      activeSessionId: null,
      isSessionHydrated: vi.fn().mockReturnValue(false),
      getSessionMessages: vi.fn().mockReturnValue([]),
      setMessages: vi.fn(),
      setSessionHistoryMeta: vi.fn(),
      setAgentTurns: vi.fn(),
      getSessionAgentTurns: vi.fn().mockReturnValue([]),
      getSessionActiveTurnId: vi.fn().mockReturnValue(null),
    });
    agentStoreGetState.mockReturnValue({
      hasActiveLoopForSession: vi.fn().mockReturnValue(false),
    });
  });

  it('collects watchlisted root sessions and descendants', () => {
    const sessions = [
      { id: 'root', personaId: 'default', title: 'Root', createdAt: 1, updatedAt: 1 },
      { id: 'child-1', personaId: 'default', title: 'Child 1', createdAt: 2, updatedAt: 2, parentSessionId: 'root' },
      { id: 'child-2', personaId: 'default', title: 'Child 2', createdAt: 3, updatedAt: 3, parentSessionId: 'child-1' },
      { id: 'other', personaId: 'default', title: 'Other', createdAt: 4, updatedAt: 4 },
    ] satisfies ChatSession[];

    expect(collectRuntimeWatchSessionIds(sessions, [{ sessionId: 'root', reasons: ['active'] }])).toEqual([
      'root',
      'child-1',
      'child-2',
    ]);
  });

  it('collects recent agent-started sessions even without a runtime watchlist entry', () => {
    const now = Date.now();
    const sessions = [
      { id: 'root', personaId: 'default', title: 'Root', createdAt: now - 10_000, updatedAt: now - 10_000 },
      { id: 'child-1', personaId: 'default', title: 'Child 1', kind: 'subagent', createdAt: now - 9_000, updatedAt: now - 9_000, parentSessionId: 'root' },
      { id: 'child-2', personaId: 'default', title: 'Child 2', kind: 'cli-agent', createdAt: now - 8_000, updatedAt: now - 8_000, parentSessionId: 'root' },
      { id: 'old-child', personaId: 'default', title: 'Old child', kind: 'subagent', createdAt: now - (26 * 60 * 60 * 1000), updatedAt: now - (26 * 60 * 60 * 1000), parentSessionId: 'root' },
      { id: 'plain-root', personaId: 'default', title: 'Plain root', createdAt: now - 7_000, updatedAt: now - 7_000 },
    ] satisfies ChatSession[];

    expect(collectRuntimeWatchSessionIds(sessions, [])).toEqual([
      'child-2',
      'child-1',
    ]);
  });

  it('preloads runtime watch session histories for root sessions and descendants', async () => {
    const sessions = [
      { id: 'root', personaId: 'default', title: 'Root', createdAt: 1, updatedAt: 1 },
      { id: 'child-1', personaId: 'default', title: 'Child 1', createdAt: 2, updatedAt: 2, parentSessionId: 'root' },
      { id: 'child-2', personaId: 'default', title: 'Child 2', createdAt: 3, updatedAt: 3, parentSessionId: 'child-1' },
    ] satisfies ChatSession[];

    await preloadRuntimeWatchSessionHistory({
      sessions,
      runtimeWatchTargets: [{ sessionId: 'root', reasons: ['pending_confirmation'] }],
    });

    expect(hydrateSessionHistoryIntoStore).toHaveBeenCalledTimes(3);
    expect(hydrateSessionHistoryIntoStore).toHaveBeenNthCalledWith(1, expect.objectContaining({
      sessionId: 'root',
      fetchMessages: expect.any(Function),
    }));
    expect(hydrateSessionHistoryIntoStore).toHaveBeenNthCalledWith(1, expect.not.objectContaining({
      getActiveSessionId: expect.any(Function),
    }));
    expect(hydrateSessionHistoryIntoStore).toHaveBeenNthCalledWith(2, expect.objectContaining({
      sessionId: 'child-1',
      fetchMessages: expect.any(Function),
    }));
    expect(hydrateSessionHistoryIntoStore).toHaveBeenNthCalledWith(3, expect.objectContaining({
      sessionId: 'child-2',
      fetchMessages: expect.any(Function),
    }));
  });

  it('preloads recent agent-started session histories when no runtime watchlist exists yet', async () => {
    const now = Date.now();
    const sessions = [
      { id: 'root', personaId: 'default', title: 'Root', createdAt: now - 10_000, updatedAt: now - 10_000 },
      { id: 'child-1', personaId: 'default', title: 'Child 1', kind: 'subagent', createdAt: now - 9_000, updatedAt: now - 9_000, parentSessionId: 'root' },
      { id: 'child-2', personaId: 'default', title: 'Child 2', kind: 'cli-agent', createdAt: now - 8_000, updatedAt: now - 8_000, parentSessionId: 'root' },
    ] satisfies ChatSession[];

    await preloadRuntimeWatchSessionHistory({
      sessions,
      runtimeWatchTargets: [],
    });

    expect(hydrateSessionHistoryIntoStore).toHaveBeenCalledTimes(2);
    expect(hydrateSessionHistoryIntoStore).toHaveBeenNthCalledWith(1, expect.objectContaining({
      sessionId: 'child-2',
    }));
    expect(hydrateSessionHistoryIntoStore).toHaveBeenNthCalledWith(2, expect.objectContaining({
      sessionId: 'child-1',
    }));
  });

  it('skips already hydrated sessions unless force is requested', async () => {
    const isSessionHydrated = vi.fn((sessionId: string) => sessionId === 'root');
    sessionStoreGetState.mockReturnValue({
      sessions: [],
      activeSessionId: null,
      isSessionHydrated,
      getSessionMessages: vi.fn().mockReturnValue([]),
      setMessages: vi.fn(),
      setSessionHistoryMeta: vi.fn(),
      setAgentTurns: vi.fn(),
      getSessionAgentTurns: vi.fn().mockReturnValue([]),
      getSessionActiveTurnId: vi.fn().mockReturnValue(null),
    });

    const sessions = [
      { id: 'root', personaId: 'default', title: 'Root', createdAt: 1, updatedAt: 1 },
      { id: 'child', personaId: 'default', title: 'Child', createdAt: 2, updatedAt: 2, parentSessionId: 'root' },
    ] satisfies ChatSession[];

    await preloadRuntimeWatchSessionHistory({
      sessions,
      runtimeWatchTargets: [{ sessionId: 'root', reasons: ['active'] }],
    });

    expect(hydrateSessionHistoryIntoStore).toHaveBeenCalledTimes(1);
    expect(hydrateSessionHistoryIntoStore).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: 'child',
    }));

    hydrateSessionHistoryIntoStore.mockClear();

    await preloadRuntimeWatchSessionHistory({
      sessions,
      runtimeWatchTargets: [{ sessionId: 'root', reasons: ['active'] }],
      force: true,
    });

    expect(hydrateSessionHistoryIntoStore).toHaveBeenCalledTimes(2);
  });
});
