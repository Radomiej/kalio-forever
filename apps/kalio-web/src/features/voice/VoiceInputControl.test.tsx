import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { VoiceInputControl } from './VoiceInputControl';
import type { VoiceDraft } from './voiceDraftStore';
const mock = vi.hoisted(() => ({
  voice: { ready: false, phase: 'idle', error: null as string | null, transcript: null as string | null,
    seconds: 0, start: vi.fn(), stop: vi.fn(), cancel: vi.fn(), insert: vi.fn(), discard: vi.fn(),
    level: { rms: 0, peak: 0, signal: false, received: false, bars: Array<number>(11).fill(0) }, saveState: null,
    savedDrafts: [] as VoiceDraft[], unsavedIds: [], retrySave: vi.fn(), retry: vi.fn(), remove: vi.fn(), recover: vi.fn() },
}));
vi.mock('./useVoiceInput', () => ({ useVoiceInput: () => mock.voice }));
beforeEach(() => { vi.clearAllMocks(); Object.assign(mock.voice, { ready: false, phase: 'idle', error: null, transcript: null,
  savedDrafts: [], level: { rms: 0, peak: 0, signal: false, received: false, bars: Array<number>(11).fill(0) } }); });
describe('voice control', () => {
  it('renders measured taller bars without filler and retains a reduced-motion meter', () => {
    mock.voice.phase = 'recording';
    mock.voice.level.received = true;
    const { container, rerender } = render(<VoiceInputControl scope={{ draftId: 'launch' }} draft="" onDraft={vi.fn()} />);
    expect(screen.queryByText('Cisza')).not.toBeInTheDocument();
    expect(container.querySelectorAll('span.bg-emerald-300')).toHaveLength(0);
    mock.voice.level = { rms: 0.2, peak: 0.8, signal: true, received: true, bars: [0, 0.1, 0.2, 0.4, 0.6, 1, 0.8, 0.4, 0.2, 0.1, 0] };
    rerender(<VoiceInputControl scope={{ draftId: 'launch' }} draft="" onDraft={vi.fn()} />);
    expect(screen.queryByText('M\u00f3w\u2026')).not.toBeInTheDocument();
    expect(container.querySelectorAll('span.bg-emerald-300')).toHaveLength(9);
    const bars = container.querySelectorAll('[data-audio-bar]');
    expect(bars[0]).toHaveStyle({ height: '3px' });
    expect(bars[5]).toHaveStyle({ height: '34px' });
    expect(bars[10]).toHaveStyle({ height: '3px' });
    expect(screen.getByLabelText('Microphone level')).toHaveClass('motion-reduce:block');
    expect(container.querySelector('[class*="animate-"]')).toBeNull();
  });
  it.each([false, true])('uses an English icon-only idle action with a 44px target, ready=%s', (ready) => {
    mock.voice.ready = ready;
    render(<VoiceInputControl scope={{ sessionId: 's1' }} draft="" onDraft={vi.fn()} />);
    const button = screen.getByRole('button', { name: ready ? 'Record voice input' : 'Set up microphone' });
    expect(button).toHaveClass('h-11', 'w-11');
    expect(button.parentElement).toHaveClass('p-0', 'ring-1', 'ring-inset');
    expect(button.parentElement).not.toHaveClass('p-1', 'border');
    expect(button.textContent).toBe('');
    expect(button).toHaveAttribute('title', ready ? 'Record' : 'Set up microphone');
  });
  it.each(['starting', 'recording', 'transcribing'])('preserves the busy capsule and 44px controls while %s', (phase) => {
    mock.voice.phase = phase;
    render(<VoiceInputControl scope={{ sessionId: 's1' }} draft="" onDraft={vi.fn()} />);
    const cancel = screen.getByRole('button', { name: 'Discard recording' });
    const confirm = screen.getByRole('button', { name: 'Stop recording' });
    expect(cancel).toHaveClass('h-11', 'w-11', 'shrink-0');
    expect(confirm).toHaveClass('h-11', 'w-11', 'shrink-0');
    expect(cancel.parentElement).toHaveClass('border', 'p-1');
    expect(cancel.parentElement).not.toHaveClass('ring-1');
    expect(confirm.hasAttribute('disabled')).toBe(phase !== 'recording');
  });
  it('keeps long recovery and error content out of the inline recorder row', () => {
    mock.voice.error = 'Recording saved. Retry or delete.';
    mock.voice.transcript = 'A'.repeat(500);
    render(<VoiceInputControl scope={{ sessionId: 's1' }} draft="" onDraft={vi.fn()} />);
    expect(screen.getByTestId('voice-feedback')).toHaveClass('absolute', 'right-0', 'max-w-[calc(100vw-6rem)]', 'break-words');
  });
  it('offers setup instead of starting an unavailable microphone', () => {
    render(<VoiceInputControl scope={{ sessionId: 's1' }} draft="" onDraft={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Set up microphone' }));
    expect(mock.voice.start).not.toHaveBeenCalled();
  });
  it('starts only on click and separates Stop recording from Stop agent', () => {
    mock.voice.ready = true;
    const { rerender } = render(<VoiceInputControl scope={{ sessionId: 's1' }} draft="" onDraft={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Record voice input' }));
    expect(mock.voice.start).toHaveBeenCalledOnce();
    mock.voice.phase = 'recording'; rerender(<VoiceInputControl scope={{ sessionId: 's1' }} draft="" onDraft={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Stop recording' }));
    expect(mock.voice.stop).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: 'Discard recording' }));
    expect(mock.voice.cancel).toHaveBeenCalledOnce();
  });
  it('exposes explicit insert and discard for a concurrent edit', () => {
    mock.voice.transcript = 'Recognized text';
    render(<VoiceInputControl scope={{ sessionId: 's1' }} draft="New edit" onDraft={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Insert' }));
    expect(mock.voice.insert).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(mock.voice.discard).toHaveBeenCalledOnce();
  });
  it('keeps pending permission in one compact control with cancel and disabled confirm', () => {
    mock.voice.phase = 'starting';
    render(<VoiceInputControl scope={{ draftId: 'launch' }} draft="" onDraft={vi.fn()} />);
    expect(screen.getByText('Allow microphone...')).toBeInTheDocument();
    expect(screen.getAllByRole('button')).toHaveLength(2);
    expect(screen.getByRole('button', { name: 'Stop recording' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Discard recording' }));
    expect(mock.voice.cancel).toHaveBeenCalledOnce(); expect(mock.voice.remove).not.toHaveBeenCalled();
  });
  it('collapses failed recording recovery and exposes only Delete after inserted-text cleanup failure', () => {
    mock.voice.savedDrafts = [{ id: 'r1', draftId: 'launch', sampleRate: 16000, sampleCount: 16000,
      chunkCount: 1, createdAt: 1, cleanupOnly: true, deliveryState: 'inserted', deliveryText: 'Text already inserted' }];
    const { container } = render(<VoiceInputControl scope={{ draftId: 'launch' }} draft="" onDraft={vi.fn()} recoveryOnly />);
    expect(container.querySelector('details')).not.toHaveAttribute('open');
    fireEvent.click(screen.getByText(/Saved recordings/));
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(mock.voice.remove).toHaveBeenCalledWith('r1'); expect(mock.voice.retry).not.toHaveBeenCalled();
  });
  it('keeps pending delivery recoverable without an error or another remount', () => {
    const pending: VoiceDraft = { id: 'pending', draftId: 'launch', sampleRate: 16000, sampleCount: 16000,
      chunkCount: 1, createdAt: 1, cleanupOnly: true, deliveryState: 'pending', deliveryText: 'Not inserted' };
    mock.voice.savedDrafts = [pending];
    render(<VoiceInputControl scope={{ draftId: 'launch' }} draft="" onDraft={vi.fn()} />);
    fireEvent.click(screen.getByText(/Saved recordings/));
    expect(screen.getByText(/text not inserted/)).toBeInTheDocument();
    expect(screen.queryByText(/text inserted/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Recover text' }));
    expect(mock.voice.recover).toHaveBeenCalledWith(pending);
    expect(mock.voice.retry).not.toHaveBeenCalled();
  });
});
