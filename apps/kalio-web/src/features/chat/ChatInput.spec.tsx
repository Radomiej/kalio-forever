import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ChatInput } from './ChatInput';

vi.mock('../../store/sessionStore', () => ({
  useSessionStore: () => ({ activeSessionId: 'session-1', sessions: [] }),
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

  it('REGRESSION: locks immediately after send so a second prompt cannot slip in before parent disables', () => {
    const onSend = vi.fn();
    render(<ChatInput onSend={onSend} disabled={false} isStreaming={false} />);

    const input = screen.getByTestId('chat-input');
    fireEvent.change(input, { target: { value: 'first prompt' } });
    fireEvent.click(screen.getByTestId('chat-send-btn'));

    expect(onSend).toHaveBeenCalledOnce();
    expect(input).toBeDisabled();

    fireEvent.change(input, { target: { value: 'second prompt' } });
    fireEvent.click(screen.getByTestId('chat-send-btn'));

    expect(onSend).toHaveBeenCalledOnce();
  });

  it('releases the local send lock after the parent streaming cycle completes', () => {
    const onSend = vi.fn();
    const { rerender } = render(<ChatInput onSend={onSend} disabled={false} isStreaming={false} />);

    const input = screen.getByTestId('chat-input');
    fireEvent.change(input, { target: { value: 'first prompt' } });
    fireEvent.click(screen.getByTestId('chat-send-btn'));

    expect(input).toBeDisabled();

    rerender(<ChatInput onSend={onSend} disabled={true} isStreaming={true} onStop={vi.fn()} />);
    expect(screen.getByTestId('chat-input')).toBeDisabled();

    rerender(<ChatInput onSend={onSend} disabled={false} isStreaming={false} />);
    expect(screen.getByTestId('chat-input')).toBeEnabled();

    fireEvent.change(screen.getByTestId('chat-input'), { target: { value: 'second prompt' } });
    fireEvent.click(screen.getByTestId('chat-send-btn'));

    expect(onSend).toHaveBeenCalledTimes(2);
  });
});
