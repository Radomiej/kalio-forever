import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ChatInput } from './ChatInput';

vi.mock('../../store/sessionStore', () => ({
  useSessionStore: () => ({ activeSessionId: 'session-1', sessions: [{ id: 'session-1', personaId: 'default', title: 'Test', createdAt: 1, updatedAt: 1 }] }),
}));

vi.mock('../voice/VoiceInputControl', () => ({
  VoiceInputControl: ({ onDraft, scope }: { onDraft: (text: string) => void; scope: { sessionId: string } }) => (
    <button type="button" data-session={scope.sessionId} onClick={() => onDraft('Dictated draft')}>Insert fixture transcript</button>
  ),
}));

describe('ChatInput', () => {
  it('keeps dictated text editable and routes it only after explicit Send', () => {
    const onSend = vi.fn(); const onDraftChange = vi.fn();
    render(<ChatInput onSend={onSend} onDraftChange={onDraftChange} disabled={false} />);
    const insert = screen.getByRole('button', { name: 'Insert fixture transcript' });
    expect(insert).toHaveAttribute('data-session', 'session-1');
    fireEvent.click(insert);
    expect(screen.getByTestId('chat-input')).toHaveValue('Dictated draft');
    expect(onSend).not.toHaveBeenCalled(); expect(onDraftChange).toHaveBeenCalledWith('Dictated draft');
    fireEvent.change(screen.getByTestId('chat-input'), { target: { value: 'Edited transcript' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
    expect(onSend).toHaveBeenCalledWith('Edited transcript', 'default', { interrupt: false });
  });
  it.each([false, true])('hides mode controls in a persisted chat, locked=%s', (locked) => {
    render(<ChatInput onSend={vi.fn()} disabled={false} architectureLocked={locked} onArchitectureChange={vi.fn()} />);
    expect(screen.queryByTestId('chat-architecture-select')).not.toBeInTheDocument();
    expect(screen.queryByTestId('chat-mode-lock-guidance')).not.toBeInTheDocument();
    const mic = screen.getByRole('button', { name: 'Insert fixture transcript' });
    expect(mic.nextElementSibling).toBe(screen.getByTestId('chat-send-btn'));
    expect(mic.parentElement).toBe(screen.getByTestId('chat-voice-send'));
    expect(mic.parentElement).toHaveClass('flex', 'min-w-0', 'max-w-full');
    expect(screen.getByTestId('chat-input')).toHaveClass('basis-full', 'sm:basis-0');
  });

  it('matches Send to the 44px recorder target', () => {
    render(<ChatInput onSend={vi.fn()} disabled={false} />);
    expect(screen.getByTestId('chat-send-btn')).toHaveClass('h-11', 'min-h-11', 'w-11');
  });

  it('contains a wide busy fixture and Send inside the 320/390 action budget', async () => {
    render(<ChatInput onSend={vi.fn()} disabled={false} />);
    const group = screen.getByTestId('chat-voice-send');
    const recorder = group.querySelector('button')!;
    // Synthetic busy width: stresses group wrapping; parent validates the real recording UI.
    recorder.style.width = '210px'; recorder.style.minWidth = '210px'; recorder.style.height = '44px';
    const { chromium } = await import('playwright');
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      // Isolated utility-layout fixture, not the application stylesheet or deployed UI.
      const css = `*{box-sizing:border-box}body{margin:0}.flex{display:flex}.flex-wrap{flex-wrap:wrap}.min-w-0{min-width:0}.max-w-full{max-width:100%}.items-center{align-items:center}.justify-end{justify-content:flex-end}.gap-2{gap:8px}.shrink-0{flex-shrink:0}.h-11{height:44px}.min-h-11{min-height:44px}.w-11{width:44px}`;
      for (const viewport of [320, 390]) {
        await page.setViewportSize({ width: viewport, height: 844 });
        // Sidebar 56px plus 28px composer padding/borders leaves 236/306px.
        await page.setContent(`<style>${css}</style><main style="margin-left:70px;width:${viewport - 84}px">${group.outerHTML}</main>`);
        const bounds = await page.evaluate(() => {
          const row = document.querySelector('[data-testid="chat-voice-send"]')!;
          const rect = row.getBoundingClientRect();
          return { left: rect.left, right: rect.right, scroll: row.scrollWidth, width: row.clientWidth,
            children: [...row.children].map((child) => { const r = child.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, width: r.width, height: r.height }; }) };
        });
        expect(bounds.scroll).toBeLessThanOrEqual(bounds.width);
        for (const child of bounds.children) {
          expect(child.left).toBeGreaterThanOrEqual(bounds.left);
          expect(child.right).toBeLessThanOrEqual(bounds.right);
        }
        expect(bounds.children[1].width).toBe(44);
        expect(bounds.children[1].height).toBe(44);
        if (viewport === 320) expect(bounds.children[1].top).toBeGreaterThan(bounds.children[0].top);
        else expect(bounds.children[1].top).toBe(bounds.children[0].top);
      }
    } finally { await browser.close(); }
  });

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

describe('active chat images', () => {
  it('keeps a picked image after a failed send and lets the user remove it', async () => {
    const onSend = vi.fn().mockResolvedValue(false);
    render(<ChatInput onSend={onSend} disabled={false} />);
    const picker = screen.getByLabelText('Image files');
    const nativeClick = vi.spyOn(picker, 'click');
    fireEvent.click(screen.getByRole('button', { name: 'Add image' }));
    expect(nativeClick).toHaveBeenCalledOnce();
    const image = new File(['png'], 'picked.png', { type: 'image/png' });
    fireEvent.change(picker, { target: { files: [image] } });
    const remove = screen.getByRole('button', { name: 'Remove picked.png' });
    expect(onSend).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Send message' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Chat message'), { target: { value: 'Describe this' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
    expect(onSend).toHaveBeenCalledExactlyOnceWith('Describe this', 'default', { interrupt: false, images: [image] });
    await waitFor(() => expect(remove).toBeEnabled());
    fireEvent.click(remove);
    expect(remove).not.toBeInTheDocument();
    expect(screen.getByLabelText('Chat message')).toHaveValue('Describe this');
  });

  it('explains Devin text-only on image paste and still allows text', () => {
    const onSend = vi.fn();
    render(<ChatInput onSend={onSend} disabled={false} imageInputBlockReason="Devin API chat in Kalio currently accepts text only." />);
    const input = screen.getByLabelText('Chat message');
    fireEvent.paste(input, { clipboardData: { files: [new File(['x'], 'clip.png', { type: 'image/png' })] } });
    expect(screen.getByRole('alert')).toHaveTextContent('Devin API chat in Kalio currently accepts text only.');
    expect(screen.queryByRole('button', { name: 'Remove clip.png' })).not.toBeInTheDocument();
    fireEvent.change(input, { target: { value: 'Text only' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onSend).toHaveBeenCalledExactlyOnceWith('Text only', 'default', { interrupt: false });
  });
});
