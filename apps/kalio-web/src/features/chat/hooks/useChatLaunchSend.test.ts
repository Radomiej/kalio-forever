import { act, renderHook } from '@testing-library/react';
import type { ChatSession } from '@kalio/types';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { useChatLaunchSend } from './useChatLaunchSend';

const mocks = vi.hoisted(() => ({
  create: vi.fn(), persist: vi.fn(), activate: vi.fn(),
  store: { addSession: vi.fn(), setMessages: vi.fn(), setAgentTurns: vi.fn(), updateSession: vi.fn(), setActiveSession: vi.fn() },
}));
vi.mock('../../../store/sessionStore', () => ({ useSessionStore: { getState: () => mocks.store } }));
vi.mock('../activeConversationSession', () => ({ activateConversationSession: mocks.activate }));
vi.mock('../launch/launchContext', () => ({ persistSessionLaunchSelection: mocks.persist }));
vi.mock('../launch/sessionLaunchShared', () => ({ createAndActivateHostSession: mocks.create }));

const session = { id: 'created', personaId: 'default', title: 'New Chat', createdAt: 1, updatedAt: 1 };
describe('landing chat launch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.create.mockResolvedValue(session);
    mocks.persist.mockResolvedValue(session);
    mocks.activate.mockResolvedValue(undefined);
  });
  it('does not materialize a draft for an empty submit', async () => {
    const send = vi.fn();
    const { result } = renderHook(() => useChatLaunchSend({ activeSession: null, projectId: 'home', projectPath: '', send, onError: vi.fn() }));
    await act(() => result.current('  \n ', 'default', 'devin-swe-2'));
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.persist).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });
  it('guards double submit during first session creation and sends one first message', async () => {
    let resolveCreate!: () => void;
    mocks.create.mockImplementationOnce(() => new Promise((resolve) => {
      resolveCreate = () => resolve(session);
    }));
    const send = vi.fn();
    const { result } = renderHook(() => useChatLaunchSend({ activeSession: null, projectId: 'home', projectPath: '', send, onError: vi.fn() }));
    await act(async () => {
      const first = result.current('First message', 'default', 'devin-swe-2');
      await result.current('Duplicate message', 'default', 'devin-swe-2');
      expect(mocks.create).toHaveBeenCalledOnce();
      expect(send).not.toHaveBeenCalled();
      resolveCreate();
      await first;
    });
    expect(mocks.create).toHaveBeenCalledOnce();
    expect(mocks.activate).toHaveBeenCalledOnce();
    expect(send).toHaveBeenCalledExactlyOnceWith('First message', 'default');
  });
  it('creates a separate conversation after returning from a submitted chat to New Chat', async () => {
    const { result, rerender } = renderHook(({ activeSession }: { activeSession: ChatSession | null }) => useChatLaunchSend({ activeSession, projectId: 'home', projectPath: '', send: vi.fn(), onError: vi.fn() }), { initialProps: { activeSession: null } as { activeSession: ChatSession | null } });
    await act(() => result.current('First message', 'default', 'devin-swe-2'));
    rerender({ activeSession: session });
    rerender({ activeSession: null });
    await act(() => result.current('Different conversation', 'default', 'devin-swe-2'));
    expect(mocks.create).toHaveBeenCalledTimes(2);
  });
  it('keeps a created first attempt available when send fails and retries without a second session', async () => {
    const send = vi.fn().mockImplementationOnce(() => { throw new Error('send failed'); });
    const onError = vi.fn();
    const { result } = renderHook(() => useChatLaunchSend({ activeSession: null, projectId: 'home', projectPath: '', send, onError }));
    await act(() => result.current('First message', 'default', 'devin-swe-2'));
    expect(onError).toHaveBeenCalledWith('send failed');
    await act(() => result.current('Retry message', 'default', 'devin-swe-2'));
    expect(mocks.create).toHaveBeenCalledOnce();
    expect(send).toHaveBeenLastCalledWith('Retry message', 'default');
  });
  it('creates a scoped session, saves the model, activates then sends once', async () => {
    const send = vi.fn();
    const { result } = renderHook(() => useChatLaunchSend({ activeSession: null, projectId: 'home', projectPath: 'E:/Projekty/home-site', send, onError: vi.fn() }));
    await act(() => result.current('Build site', 'default', 'devin-swe-2'));
    expect(mocks.create).toHaveBeenCalledOnce();
    expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({ projectId: 'home', projectPathOverride: 'E:/Projekty/home-site' }));
    expect(mocks.persist).toHaveBeenCalledWith(session, 'default', 'devin-swe-2', mocks.store.updateSession);
    expect(mocks.activate).toHaveBeenCalledOnce();
    expect(send).toHaveBeenCalledWith('Build site', 'default');
    expect(mocks.persist.mock.invocationCallOrder[0]).toBeLessThan(mocks.activate.mock.invocationCallOrder[0]);
    expect(mocks.activate.mock.invocationCallOrder[0]).toBeLessThan(send.mock.invocationCallOrder[0]);
  });
  it('does not activate or send on selection failure and reuses the created session on retry', async () => {
    mocks.persist.mockRejectedValueOnce(new Error('selection failed'));
    const send = vi.fn();
    const onError = vi.fn();
    const { result } = renderHook(() => useChatLaunchSend({ activeSession: null, projectId: 'home', projectPath: '', send, onError }));
    await act(() => result.current('Build site', 'default', 'devin-swe-2'));
    expect(send).not.toHaveBeenCalled();
    expect(mocks.activate).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledWith('selection failed');
    await act(() => result.current('Build site', 'default', 'devin-swe-2'));
    expect(mocks.create).toHaveBeenCalledOnce();
    expect(send).toHaveBeenCalledOnce();
  });
  it('rejects a launch without a selected runtime before creating a session', async () => {
    const send = vi.fn();
    const onError = vi.fn();
    const { result } = renderHook(() => useChatLaunchSend({ activeSession: null, projectId: 'home', projectPath: '', send, onError }));
    await act(() => result.current('Build site', 'default'));
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.persist).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledWith('Choose a connected provider and model before starting this chat.');
  });
  it.each([
    { projectId: 'other', projectPath: 'E:/Projekty/home-site' },
    { projectId: 'home', projectPath: 'E:/Projekty/other-site' },
  ])('does not reuse a failed launch after scope changes to $projectId / $projectPath', async (nextScope) => {
    mocks.persist.mockRejectedValueOnce(new Error('selection failed'));
    const send = vi.fn();
    const { result, rerender } = renderHook((scope) => useChatLaunchSend({
      activeSession: null, ...scope, send, onError: vi.fn(),
    }), { initialProps: { projectId: 'home', projectPath: 'E:/Projekty/home-site' } });
    await act(() => result.current('Build site', 'default', 'devin-swe-2'));
    expect(send).not.toHaveBeenCalled();
    const nextSession = { ...session, id: 'new-scope' };
    mocks.create.mockResolvedValueOnce(nextSession);
    mocks.persist.mockResolvedValueOnce(nextSession);
    rerender(nextScope);
    await act(() => result.current('Build other site', 'default', 'devin-swe-2'));
    expect(mocks.create).toHaveBeenCalledTimes(2);
    expect(mocks.create).toHaveBeenLastCalledWith(expect.objectContaining({
      projectId: nextScope.projectId, projectPathOverride: nextScope.projectPath,
    }));
    expect(mocks.persist).toHaveBeenLastCalledWith(nextSession, 'default', 'devin-swe-2', mocks.store.updateSession);
    expect(mocks.activate).toHaveBeenCalledWith(expect.objectContaining({ sessionId: nextSession.id }));
    expect(send).toHaveBeenCalledExactlyOnceWith('Build other site', 'default');
  });
  it('does not send twice while selection persistence is pending', async () => {
    let resolveSelection!: () => void;
    mocks.persist.mockImplementationOnce(() => new Promise((resolve) => {
      resolveSelection = () => resolve(session);
    }));
    const send = vi.fn();
    const { result } = renderHook(() => useChatLaunchSend({ activeSession: session, projectId: 'home', projectPath: '', send, onError: vi.fn() }));
    await act(async () => {
      const first = result.current('Build site', 'default', 'devin-swe-2');
      await result.current('Duplicate', 'default', 'devin-swe-2');
      expect(send).not.toHaveBeenCalled();
      resolveSelection();
      await first;
    });
    expect(mocks.persist).toHaveBeenCalledOnce();
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.activate).not.toHaveBeenCalled();
    expect(send).toHaveBeenCalledExactlyOnceWith('Build site', 'default');
  });
});
