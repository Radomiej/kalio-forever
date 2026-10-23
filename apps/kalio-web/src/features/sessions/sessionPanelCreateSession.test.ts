import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useSessionStore } from '../../store/sessionStore';
import { startPendingSessionFromPanel } from './sessionPanelCreateSession';
import { LAST_ACTIVE_CONVERSATION_SESSION_STORAGE_KEY } from '../chat/activeConversationSession';

const create = vi.hoisted(() => vi.fn());
vi.mock('../chat/launch/sessionLaunchShared', () => ({ createAndActivateHostSession: create }));

describe('New Chat draft', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    useSessionStore.setState({ sessions: [], activeSessionId: null, messages: [], agentTurns: [], sessionMessages: {}, sessionAgentTurns: {} });
    create.mockResolvedValue({ id: 'ghost', personaId: 'default', title: 'New Chat', createdAt: 1, updatedAt: 1 });
  });

  it('opens a local draft repeatedly without persisting or listing it, preserving legitimate empty records', async () => {
    const existing = [
      { id: 'failed-first-attempt', personaId: 'default', title: 'New Chat', createdAt: 1, updatedAt: 1 },
      { id: 'child', parentSessionId: 'failed-first-attempt', personaId: 'default', title: 'Child', createdAt: 1, updatedAt: 1 },
    ];
    useSessionStore.getState().setSessions(existing);
    useSessionStore.getState().setActiveSession(existing[0].id);
    sessionStorage.setItem(LAST_ACTIVE_CONVERSATION_SESSION_STORAGE_KEY, existing[0].id);
    const onSelect = vi.fn();
    for (let i = 0; i < 2; i++) {
      const store = useSessionStore.getState();
      await startPendingSessionFromPanel({ ...store, personaId: 'default', previousActiveSessionId: store.activeSessionId, getActiveSessionId: () => useSessionStore.getState().activeSessionId, onSelect });
    }
    expect(create).not.toHaveBeenCalled();
    expect(useSessionStore.getState().sessions).toEqual(existing);
    expect(useSessionStore.getState().activeSessionId).toBeNull();
    expect(useSessionStore.getState().messages).toEqual([]);
    expect(sessionStorage.getItem(LAST_ACTIVE_CONVERSATION_SESSION_STORAGE_KEY)).toBeNull();
    expect(onSelect).toHaveBeenCalledTimes(2);
  });
});
