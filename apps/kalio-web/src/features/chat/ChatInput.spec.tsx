import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ChatInput } from './ChatInput';

vi.mock('../../store/sessionStore', () => ({
  useSessionStore: () => ({ activeSessionId: 'session-1', sessions: [{ id: 'session-1', personaId: 'default', title: 'Test', createdAt: 1, updatedAt: 1 }] }),
}));

describe('ChatInput', () => {
  it('shows stop and send buttons together while streaming', () => {
    render(<ChatInput onSend={vi.fn()} disabled={false} isStreaming={true} onStop={vi.fn()} />);
    expect(screen.getByTestId('chat-stop-btn')).toBeInTheDocument();
    expect(screen.getByTestId('chat-send-btn')).toBeInTheDocument();
  });

  it('calls onStop when stop button clicked', () => {
    const onStop = vi.fn();
    render(<ChatInput onSend={vi.fn()} disabled={false} isStreaming={true} onStop={onStop} />);
    fireEvent.click(screen.getByTestId('chat-stop-btn'));
    expect(onStop).toHaveBeenCalledOnce();
  });

  it('allows sending while streaming for queue mode', () => {
    const onSend = vi.fn();
    render(<ChatInput onSend={onSend} disabled={false} isStreaming={true} onStop={vi.fn()} />);

    const input = screen.getByTestId('chat-input');
    fireEvent.change(input, { target: { value: 'queued follow-up' } });
    fireEvent.click(screen.getByTestId('chat-send-btn'));

    expect(onSend).toHaveBeenCalledWith('queued follow-up', 'default', { interrupt: false });
    expect(input).toBeEnabled();
  });

  it('does not time-throttle distinct queued sends while streaming', () => {
    const onSend = vi.fn();
    render(<ChatInput onSend={onSend} disabled={false} isStreaming={true} onStop={vi.fn()} />);
    const input = screen.getByTestId('chat-input');

    fireEvent.change(input, { target: { value: 'queued one' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    fireEvent.change(input, { target: { value: 'queued two' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(onSend).toHaveBeenNthCalledWith(1, 'queued one', 'default', { interrupt: false });
    expect(onSend).toHaveBeenNthCalledWith(2, 'queued two', 'default', { interrupt: false });
  });

  it('sends interrupt flag from interrupt button', () => {
    const onSend = vi.fn();
    render(<ChatInput onSend={onSend} disabled={false} isStreaming={true} onStop={vi.fn()} />);

    fireEvent.change(screen.getByTestId('chat-input'), { target: { value: 'replace prompt' } });
    fireEvent.click(screen.getByTestId('chat-interrupt-btn'));

    expect(onSend).toHaveBeenCalledWith('replace prompt', 'default', { interrupt: true });
  });

  it('shows queued depth badge', () => {
    render(<ChatInput onSend={vi.fn()} disabled={false} isStreaming={true} queuedDepth={2} onStop={vi.fn()} />);
    expect(screen.getByTestId('chat-queued-badge')).toHaveTextContent('Queued (2)');
  });

  it('keeps composer text when architecture run is blocked during streaming', () => {
    const onArchitectureRun = vi.fn();
    render(
      <ChatInput
        architectures={[{ id: 'strategic-decision-council', name: 'Strategic Decision Council' }]}
        disabled={false}
        isStreaming={true}
        onArchitectureChange={vi.fn()}
        onArchitectureRun={onArchitectureRun}
        onSend={vi.fn()}
        selectedArchitectureId="strategic-decision-council"
      />,
    );

    const input = screen.getByTestId('chat-input') as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: 'keep this draft' } });
    fireEvent.click(screen.getByTestId('chat-send-btn'));

    expect(onArchitectureRun).not.toHaveBeenCalled();
    expect(input).toHaveValue('keep this draft');
  });

  it('routes composer prompts through the selected architecture when one is selected', () => {
    const onArchitectureRun = vi.fn();
    const onSend = vi.fn();
    render(
      <ChatInput
        architectures={[{ id: 'strategic-decision-council', name: 'Strategic Decision Council' }]}
        disabled={false}
        isStreaming={false}
        onArchitectureChange={vi.fn()}
        onArchitectureRun={onArchitectureRun}
        onSend={onSend}
        selectedArchitectureId="strategic-decision-council"
      />,
    );

    fireEvent.change(screen.getByTestId('chat-input'), { target: { value: 'run council' } });
    fireEvent.click(screen.getByTestId('chat-send-btn'));

    expect(onArchitectureRun).toHaveBeenCalledWith('run council', 'strategic-decision-council');
    expect(onSend).not.toHaveBeenCalled();
  });
});
