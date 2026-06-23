import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatMessage, ChatSession } from '@kalio/types';
import { useSessionStore } from '../../store/sessionStore';
import {
  activateConversationSession,
  createAndActivateEmptyHostSession,
  hydrateActiveConversationSession,
  loadStoredActiveConversationSessionId,
  persistActiveConversationSessionId,
} from './activeConversationSession';

const {
  mockApiGet,
  mockHydrateSessionHistoryIntoStore,
  mockCreateAndActivateHostSession,
} = vi.hoisted(() => ({
  mockApiGet: vi.fn(),
  mockHydrateSessionHistoryIntoStore: vi.fn(),
  mockCreateAndActivateHostSession: vi.fn(),
}));

vi.mock('../../services/apiClient', () => ({
  apiClient: {
    get: mockApiGet,
  },
}));

vi.mock('./historyHydration', () => ({
  hydrateSessionHistoryIntoStore: mockHydrateSessionHistoryIntoStore,
}));

vi.mock('./launch/sessionLaunchShared', () => ({
  createAndActivateHostSession: mockCreateAndActivateHostSession,
}));

function makeSession(overrides: Partial<ChatSession>): ChatSession {
  return {
    id: 'session-1',
    personaId: 'default',
    title: 'Session',
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

describe('activeConversationSession', () => {
  beforeEach(() => {
    sessionStorage.clear();
    vi.clearAllMocks();
    useSessionStore.setState({
      hydratedSessionIds: {},
    });
  });

  it('normalizes a hidden technical workflow session to the visible host session and persists it', async () => {
    const host = makeSession({ id: 'host', title: 'Workflow host' });
    const technicalRoot = makeSession({
      id: 'arch-root',
      title: 'Architecture runtime root',
      kind: 'agent-flow',
      parentSessionId: host.id,
      runtimeContext: {
        runtimeKind: 'agent-flow-root',
        architectureContext: {
          architectureRunId: 'run-1',
          sessionSurface: 'technical-node',
        },
      },
    });
    const branch = makeSession({
      id: 'branch',
      title: 'Strategic Decision Council: Analyst',
      kind: 'subagent',
      parentSessionId: technicalRoot.id,
      runtimeContext: {
        runtimeKind: 'agent-flow-branch',
        architectureSlotId: 'analyst',
        architectureContext: {
          architectureRunId: 'run-1',
          sessionSurface: 'conversation-branch',
        },
      },
    });
    const setActiveSession = vi.fn();
    const onActivated = vi.fn();

    const resolvedSessionId = await activateConversationSession({
      sessionId: technicalRoot.id,
      sessions: [host, technicalRoot, branch],
      setActiveSession,
      onActivated,
      reason: 'graph',
    });

    expect(resolvedSessionId).toBe(host.id);
    expect(setActiveSession).toHaveBeenCalledWith(host.id);
    expect(onActivated).toHaveBeenCalledWith(host.id, 'graph');
    expect(loadStoredActiveConversationSessionId()).toBe(host.id);
  });

  it('creates a host session, persists it, and marks it hydrated for future recovery flows', async () => {
    const createdSession = makeSession({
      id: 'session-created',
      title: 'New Chat',
      runtimeContext: {
        runtimeKind: 'chat',
      },
    });
    const addSession = vi.fn();
    const setActiveSession = vi.fn();
    const setMessages = vi.fn();
    const setAgentTurns = vi.fn();
    const onActivated = vi.fn();

    mockCreateAndActivateHostSession.mockResolvedValue(createdSession);

    const result = await createAndActivateEmptyHostSession({
      personaId: 'default',
      title: 'New Chat',
      runtimeContext: createdSession.runtimeContext,
      addSession,
      setActiveSession,
      setMessages,
      setAgentTurns,
      onActivated,
      reason: 'landing',
    });

    expect(result).toEqual(createdSession);
    expect(mockCreateAndActivateHostSession).toHaveBeenCalledWith({
      personaId: 'default',
      title: 'New Chat',
      runtimeContext: createdSession.runtimeContext,
      addSession,
      setActiveSession,
      setMessages,
      setAgentTurns,
    });
    expect(onActivated).toHaveBeenCalledWith(createdSession.id, 'landing');
    expect(loadStoredActiveConversationSessionId()).toBe(createdSession.id);
    expect(useSessionStore.getState().isSessionHydrated(createdSession.id)).toBe(true);
  });

  it('passes an explicit fetch override through the shared hydration entrypoint', async () => {
    const fetchMessages = vi.fn<() => Promise<ChatMessage[]>>().mockResolvedValue([]);

    await hydrateActiveConversationSession({
      mode: 'select',
      sessionId: 'session-1',
      getActiveSessionId: () => 'session-1',
      getSessions: () => [],
      getSessionMessages: () => [],
      setMessages: vi.fn(),
      setAgentTurns: vi.fn(),
      getSessionAgentTurns: () => [],
      getSessionActiveTurnId: () => null,
      hasActiveLoopForSession: () => false,
      fetchMessages,
    });

    expect(mockHydrateSessionHistoryIntoStore).toHaveBeenCalledTimes(1);
    expect(mockHydrateSessionHistoryIntoStore.mock.calls[0]?.[0]).toMatchObject({
      sessionId: 'session-1',
      fetchMessages,
    });
  });

  it('uses the default API-backed message loader when no fetch override is supplied', async () => {
    mockApiGet.mockResolvedValue({
      data: [
        {
          id: 'message-1',
          sessionId: 'session-1',
          role: 'assistant',
          content: 'Recovered',
          createdAt: 1,
        },
      ] satisfies ChatMessage[],
    });
    mockHydrateSessionHistoryIntoStore.mockResolvedValue([]);

    await hydrateActiveConversationSession({
      mode: 'reload',
      sessionId: 'session-1',
      getActiveSessionId: () => 'session-1',
      getSessions: () => [],
      getSessionMessages: () => [],
      setMessages: vi.fn(),
      setAgentTurns: vi.fn(),
      getSessionAgentTurns: () => [],
      getSessionActiveTurnId: () => null,
      hasActiveLoopForSession: () => false,
    });

    const hydrateArgs = mockHydrateSessionHistoryIntoStore.mock.calls[0]?.[0];
    expect(hydrateArgs).toBeTruthy();
    const fetchedMessages = await hydrateArgs.fetchMessages('session-1');
    expect(mockApiGet).toHaveBeenCalledWith('/api/sessions/session-1/messages', {
      params: { limit: 40 },
      signal: undefined,
    });
    expect(fetchedMessages).toEqual({
      messages: [
        {
          id: 'message-1',
          sessionId: 'session-1',
          role: 'assistant',
          content: 'Recovered',
          createdAt: 1,
        },
      ],
      meta: {
        totalCount: 1,
        hasMoreBefore: false,
        oldestLoadedMessageId: null,
      },
    });
  });

  it('removes the stored active session id when persistence is cleared', () => {
    persistActiveConversationSessionId('session-1');
    expect(loadStoredActiveConversationSessionId()).toBe('session-1');

    persistActiveConversationSessionId(null);

    expect(loadStoredActiveConversationSessionId()).toBeNull();
  });
});
