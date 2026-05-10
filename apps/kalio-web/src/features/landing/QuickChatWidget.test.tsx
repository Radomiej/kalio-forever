import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ChatSession } from '@kalio/types';

const { addSession, setActiveSession, setPendingMessage, apiPost } = vi.hoisted(() => ({
  addSession: vi.fn(),
  setActiveSession: vi.fn(),
  setPendingMessage: vi.fn(),
  apiPost: vi.fn(),
}));

vi.mock('../../store/sessionStore', () => ({
  useSessionStore: (selector: (state: {
    addSession: typeof addSession;
    setActiveSession: typeof setActiveSession;
    setPendingMessage: typeof setPendingMessage;
  }) => unknown) => selector({ addSession, setActiveSession, setPendingMessage }),
}));

vi.mock('../../services/apiClient', () => ({
  apiClient: {
    post: apiPost,
  },
}));

import { QuickChatWidget } from './QuickChatWidget';

function makeSession(): ChatSession {
  return {
    id: 'session-1',
    personaId: 'default',
    title: 'New Chat',
    createdAt: 1,
    updatedAt: 1,
  };
}

describe('QuickChatWidget', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('keeps send disabled for whitespace-only input', () => {
    render(<QuickChatWidget onMessageSent={() => undefined} />);

    fireEvent.change(screen.getByTestId('quick-chat-input'), {
      target: { value: '   ' },
    });

    expect(screen.getByTestId('quick-chat-send')).toBeDisabled();
  });

  it('creates a session, stores the pending message, and navigates after a click send', async () => {
    apiPost.mockResolvedValue({ data: makeSession() });
    const onMessageSent = vi.fn();

    render(<QuickChatWidget onMessageSent={onMessageSent} />);

    fireEvent.change(screen.getByTestId('quick-chat-input'), {
      target: { value: '  hello Kalio  ' },
    });
    fireEvent.click(screen.getByTestId('quick-chat-send'));

    await waitFor(() => {
      expect(apiPost).toHaveBeenCalledWith('/api/sessions', {
        personaId: 'default',
        title: 'New Chat',
      });
    });

    expect(addSession).toHaveBeenCalledWith(makeSession());
    expect(setPendingMessage).toHaveBeenCalledWith('hello Kalio');
    expect(setActiveSession).toHaveBeenCalledWith('session-1');
    expect(onMessageSent).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('quick-chat-input')).toHaveValue('');
  });

  it('submits on Enter but keeps Shift+Enter for multiline typing', async () => {
    apiPost.mockResolvedValue({ data: makeSession() });

    render(<QuickChatWidget onMessageSent={() => undefined} />);
    const input = screen.getByTestId('quick-chat-input');

    fireEvent.change(input, { target: { value: 'first line' } });
    fireEvent.keyDown(input, { key: 'Enter', shiftKey: true });
    expect(apiPost).not.toHaveBeenCalled();

    fireEvent.keyDown(input, { key: 'Enter', shiftKey: false });
    await waitFor(() => expect(apiPost).toHaveBeenCalledTimes(1));
  });

  it('logs failures without mutating session state', async () => {
    apiPost.mockRejectedValue(new Error('backend down'));
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    render(<QuickChatWidget onMessageSent={() => undefined} />);
    fireEvent.change(screen.getByTestId('quick-chat-input'), {
      target: { value: 'hello' },
    });
    fireEvent.click(screen.getByTestId('quick-chat-send'));

    await waitFor(() => {
      expect(errorSpy).toHaveBeenCalledWith(
        '[QuickChat] failed to create session',
        expect.any(Error),
      );
    });

    expect(addSession).not.toHaveBeenCalled();
    expect(setPendingMessage).not.toHaveBeenCalled();
    expect(setActiveSession).not.toHaveBeenCalled();
  });
});
