import { act, renderHook } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import type { ChatSession } from '@kalio/types';
import { useSessionStore } from '../../../store/sessionStore';
import { useChatComposerActions } from './useChatComposerActions';
import { useChatLaunchSend } from './useChatLaunchSend';

const mocks = vi.hoisted(() => ({ post: vi.fn(), patch: vi.fn(), single: vi.fn(), workflow: vi.fn() }));
vi.mock('../../../services/apiClient', () => ({
  apiClient: { post: mocks.post, patch: mocks.patch }, getSessionVfsFiles: vi.fn(),
}));
vi.mock('../activeConversationSession', () => ({
  activateConversationSession: async ({ sessionId, setActiveSession }: {
    sessionId: string; setActiveSession: (id: string) => void;
  }) => setActiveSession(sessionId),
}));
vi.mock('../launch/sessionLaunchShared', async (importOriginal) => ({
  ...await importOriginal<typeof import('../launch/sessionLaunchShared')>(),
  launchSingleChatPrompt: mocks.single,
  launchWorkflowPrompt: mocks.workflow,
}));

beforeEach(() => {
  vi.clearAllMocks();
  useSessionStore.setState({ sessions: [], activeSessionId: null, messages: [], sessionMessages: {} });
  mocks.post.mockImplementation(async (_url: string, request: Partial<ChatSession>) => ({
    data: { id: 'created', title: 'New Chat', createdAt: 1, updatedAt: 1, ...request },
  }));
  mocks.patch.mockResolvedValue({ data: {} });
});

it.each(['strategic-decision-council', 'single-chat'])(
  'creates and activates %s before the real composer routes its first send', async (schemaId) => {
    const { result, unmount } = renderHook(() => {
      const composer = useChatComposerActions({
        architectures: [], lastSentContentRef: { current: '' }, projectPath: '',
        requestGeneratedTitleIfNeeded: vi.fn(), setAwaitingFirstChunk: vi.fn(),
        setDraftUserMessage: vi.fn(), setError: vi.fn(), setRetryError: vi.fn(),
      });
      return useChatLaunchSend({
        activeSession: null, projectId: 'home', projectPath: '', selectedArchitectureId: schemaId,
        send: composer.handleComposerSend, onError: vi.fn(),
      });
    });
    await act(() => result.current('First prompt', 'default', 'test-profile'));
    expect(useSessionStore.getState().activeSessionId).toBe('created');
    if (schemaId === 'single-chat') {
      expect(mocks.single).toHaveBeenCalledWith(expect.objectContaining({ content: 'First prompt' }));
      expect(mocks.workflow).not.toHaveBeenCalled();
    } else {
      expect(mocks.post).toHaveBeenCalledWith('/api/sessions', expect.objectContaining({
        runtimeContext: { runtimeKind: 'chat', architectureContext: { schemaId } },
      }));
      expect(mocks.workflow).toHaveBeenCalledWith(expect.objectContaining({
        schemaId, content: 'First prompt',
        session: expect.objectContaining({ runtimeContext: {
          runtimeKind: 'chat', architectureContext: { schemaId },
        } }),
      }));
      expect(mocks.single).not.toHaveBeenCalled();
    }
    unmount();
  },
);

it('uploads first-prompt images to the created session and forwards only VFS references', async () => {
  const attachment = { path: 'uploads/fixture.png', mimeType: 'image/png' };
  mocks.post.mockImplementation(async (url: string, request: Partial<ChatSession>) => ({
    data: url.endsWith('/vfs/upload') ? attachment : {
      id: 'created', title: 'New Chat', createdAt: 1, updatedAt: 1, ...request,
    },
  }));
  mocks.single.mockResolvedValue(true);
  const { result } = renderHook(() => {
    const composer = useChatComposerActions({
      architectures: [], lastSentContentRef: { current: '' }, projectPath: '',
      requestGeneratedTitleIfNeeded: vi.fn(), setAwaitingFirstChunk: vi.fn(),
      setDraftUserMessage: vi.fn(), setError: vi.fn(), setRetryError: vi.fn(),
    });
    return useChatLaunchSend({
      activeSession: null, projectId: 'home', projectPath: '',
      send: composer.handleComposerSend, onError: vi.fn(),
    });
  });
  const image = new File(['image'], 'fixture.png', { type: 'image/png' });
  await act(async () => expect(await result.current('Describe', 'default', 'codex', [image])).toBe(true));
  expect(mocks.post.mock.calls[1][0]).toBe('/api/sessions/created/vfs/upload');
  expect(mocks.post.mock.calls[1][1].get('file')).toBe(image);
  expect(mocks.single).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
    session: expect.objectContaining({ id: 'created' }), content: 'Describe', attachments: [attachment],
  }));
});
