import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TalkViewSwitcher } from './TalkViewSwitcher';

describe('TalkViewSwitcher selected contrast', () => {
  it.each([
    { value: 'conversation' as const, label: 'Chat', other: 'Graf', next: 'graph', compact: false },
    { value: 'graph' as const, label: 'Graf', other: 'Chat', next: 'conversation', compact: true },
  ])('keeps $label selected and readable (compact=$compact)', ({ value, label, other, next, compact }) => {
    const onChange = vi.fn();
    render(<TalkViewSwitcher value={value} compact={compact} onChange={onChange} />);
    const selected = screen.getByRole('button', { name: label });
    expect(selected).toHaveAttribute('aria-pressed', 'true');
    expect(selected).toHaveClass('bg-primary/15', 'text-base-content');
    expect(screen.getByRole('button', { name: other })).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(screen.getByRole('button', { name: other }));
    expect(onChange).toHaveBeenCalledWith(next);
  });
});
