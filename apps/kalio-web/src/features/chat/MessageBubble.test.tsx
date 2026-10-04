import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatMessage } from '@kalio/types';
import { MessageBubble } from './MessageBubble';

const sessionStoreState = {
  streamingChunks: {} as Record<string, string>,
  thinkingChunks: {} as Record<string, string>,
};

vi.mock('../../store/sessionStore', () => ({
  useSessionStore: <T,>(selector?: (state: typeof sessionStoreState) => T) =>
    selector ? selector(sessionStoreState) : sessionStoreState,
}));

const markdownViewerSpy = vi.fn(({ content }: { content: string }) => <div data-testid="markdown-viewer">{content}</div>);

vi.mock('../../components/markdown/MarkdownViewer', () => ({
  MarkdownViewer: (props: { content: string }) => markdownViewerSpy(props),
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
  it('leaves empty streaming activity to the conversation pending indicator', () => {
    render(<MessageBubble message={makeMessage({ streaming: true, content: '' })} />);
    expect(screen.queryByTestId('message-bubble')).toBeNull();
    expect(screen.queryByTestId('streaming-indicator')).toBeNull();
  });
  beforeEach(() => {
    sessionStoreState.streamingChunks = {};
    sessionStoreState.thinkingChunks = {};
    markdownViewerSpy.mockClear();
  });

  it('uses the wide conversation lane for assistant and user bubbles', () => {
    const { rerender } = render(
      <MessageBubble message={makeMessage({ role: 'assistant', content: 'assistant response' })} />,
    );

    expect(screen.getByTestId('message-bubble').firstElementChild).toHaveClass('max-w-none');
    expect(screen.getByTestId('message-content')).toHaveClass('max-w-[78ch]');

    rerender(<MessageBubble message={makeMessage({ role: 'user', content: 'user prompt' })} />);

    expect(screen.getByTestId('message-bubble').firstElementChild).toHaveClass('max-w-[min(100%,72rem)]');
  });

  it('keeps assistant padding compact inside the wide lane', () => {
    render(<MessageBubble message={makeMessage({ role: 'assistant', content: 'assistant response' })} />);

    const bubble = screen.getByTestId('message-bubble').querySelector('.bg-base-300');

    expect(bubble).toHaveClass('px-2.5', 'py-1.5');
  });

  it('stops the thinking animation when answer text begins and allows manual collapse', () => {
    sessionStoreState.thinkingChunks = { 'message-1': 'Planning' };
    const message = makeMessage({ streaming: true, content: '' });
    const { rerender } = render(<MessageBubble message={message} />);
    expect(screen.getByRole('button', { name: 'Thinking' }).querySelector('.loading')).not.toBeNull();
    sessionStoreState.streamingChunks = { 'message-1': 'Answer' };
    rerender(<MessageBubble message={{ ...message }} />);
    expect(screen.getByRole('button', { name: 'Thinking' }).querySelector('.loading')).toBeNull();
    expect(screen.getByText('Planning')).not.toBeVisible();
    expect(screen.getByTestId('message-content')).toHaveTextContent('Answer');
  });

  it('exposes disclosure state and keeps a manual collapse through more thinking tokens', () => {
    sessionStoreState.thinkingChunks = { 'message-1': 'Planning' };
    const message = makeMessage({ streaming: true, content: '' });
    const { rerender } = render(<MessageBubble message={message} />);
    const button = screen.getByRole('button', { name: 'Thinking' });
    expect(button).toHaveAttribute('aria-expanded', 'true');
    const contentId = button.getAttribute('aria-controls');
    expect(contentId).toBeTruthy();
    expect(document.getElementById(contentId!)).toBeVisible();
    fireEvent.click(button);
    sessionStoreState.thinkingChunks = { 'message-1': 'Planning more' };
    rerender(<MessageBubble message={{ ...message }} />);
    expect(button).toHaveAttribute('aria-expanded', 'false');
    expect(document.getElementById(contentId!)).not.toBeVisible();
    rerender(<MessageBubble message={{ ...message, streaming: false }} />);
    expect(button.querySelector('.loading, .animate-pulse')).toBeNull();
    fireEvent.click(button);
    expect(button).toHaveAttribute('aria-expanded', 'true');
    expect(document.getElementById(contentId!)).toHaveTextContent('Planning more');
  });

  it('wraps long user workflow prompts without horizontal overflow', () => {
    render(
      <MessageBubble
        message={makeMessage({
          role: 'user',
          content: `Run workflow\n${'C:/Projekty/FamilyQuest/'.repeat(20)}`,
        })}
      />,
    );

    const content = screen.getByTestId('message-content');
    expect(content).toHaveClass('whitespace-pre-wrap', 'break-words');
    expect(content.parentElement).toHaveClass('max-w-full', 'overflow-hidden');
  });

  it('does not rerender markdown when an unrelated live chunk changes', () => {
    const message = makeMessage({ id: 'message-1', role: 'assistant', content: 'assistant response' });
    const { rerender } = render(<MessageBubble message={message} />);

    expect(markdownViewerSpy).toHaveBeenCalledTimes(1);

    sessionStoreState.streamingChunks = { other: 'foreign update' };
    rerender(<MessageBubble message={message} />);

    expect(markdownViewerSpy).toHaveBeenCalledTimes(1);
  });
});
