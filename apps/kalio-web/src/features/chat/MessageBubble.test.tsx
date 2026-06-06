import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ChatMessage } from '@kalio/types';
import { MessageBubble } from './MessageBubble';

vi.mock('../../store/sessionStore', () => ({
  useSessionStore: () => ({
    streamingChunks: {},
    thinkingChunks: {},
  }),
}));

vi.mock('../../components/markdown/MarkdownViewer', () => ({
  MarkdownViewer: ({ content }: { content: string }) => <div>{content}</div>,
}));

function makeMessage(overrides: Partial<ChatMessage>): ChatMessage {
  return {
    id: overrides.id ?? 'message-1',
    sessionId: overrides.sessionId ?? 'session-1',
    role: overrides.role ?? 'assistant',
    content: overrides.content ?? 'hello',
    createdAt: overrides.createdAt ?? 1,
    ...overrides,
  } as ChatMessage;
}

describe('MessageBubble layout', () => {
  it('uses the wide conversation lane for assistant and user bubbles', () => {
    const { rerender } = render(
      <MessageBubble message={makeMessage({ role: 'assistant', content: 'assistant response' })} />,
    );

    expect(screen.getByTestId('message-bubble').firstElementChild).toHaveClass('max-w-none');

    rerender(<MessageBubble message={makeMessage({ role: 'user', content: 'user prompt' })} />);

    expect(screen.getByTestId('message-bubble').firstElementChild).toHaveClass('max-w-[min(100%,72rem)]');
  });

  it('keeps assistant padding compact inside the wide lane', () => {
    render(<MessageBubble message={makeMessage({ role: 'assistant', content: 'assistant response' })} />);

    const bubble = screen.getByTestId('message-bubble').querySelector('.bg-base-300');

    expect(bubble).toHaveClass('px-2.5', 'py-1.5');
  });
});
