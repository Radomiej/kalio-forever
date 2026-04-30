import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ChatInput } from './ChatInput';

vi.mock('../../store/sessionStore', () => ({
  useSessionStore: () => ({ activeSessionId: 'session-1' }),
}));

describe('ChatInput', () => {
  it('shows stop button when isStreaming=true and onStop is provided', () => {
    render(<ChatInput onSend={vi.fn()} disabled={true} isStreaming={true} onStop={vi.fn()} />);
    expect(screen.getByTestId('chat-stop-btn')).toBeInTheDocument();
    expect(screen.queryByTestId('chat-send-btn')).not.toBeInTheDocument();
  });

  it('calls onStop when stop button clicked', () => {
    const onStop = vi.fn();
    render(<ChatInput onSend={vi.fn()} disabled={true} isStreaming={true} onStop={onStop} />);
    fireEvent.click(screen.getByTestId('chat-stop-btn'));
    expect(onStop).toHaveBeenCalledOnce();
  });

  it('shows send button when not streaming', () => {
    render(<ChatInput onSend={vi.fn()} disabled={false} isStreaming={false} />);
    expect(screen.getByTestId('chat-send-btn')).toBeInTheDocument();
    expect(screen.queryByTestId('chat-stop-btn')).not.toBeInTheDocument();
  });

  it('shows send button when isStreaming but no onStop handler', () => {
    render(<ChatInput onSend={vi.fn()} disabled={true} isStreaming={true} />);
    expect(screen.getByTestId('chat-send-btn')).toBeInTheDocument();
    expect(screen.queryByTestId('chat-stop-btn')).not.toBeInTheDocument();
  });
});
