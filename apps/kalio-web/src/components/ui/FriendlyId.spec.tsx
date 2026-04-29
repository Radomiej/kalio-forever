import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { FriendlyId } from './FriendlyId';

// ── clipboard mock ──────────────────────────────────────────────────────────

const mockWriteText = vi.fn().mockResolvedValue(undefined);

beforeEach(() => {
  mockWriteText.mockClear();
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText: mockWriteText },
    configurable: true,
  });
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

// ── tests ───────────────────────────────────────────────────────────────────

describe('FriendlyId', () => {
  it('renders a friendly name instead of the raw ID', () => {
    render(<FriendlyId id="QxXITvX6eqkAbs1X1W3Md" />);
    const el = screen.getByTestId('friendly-id');
    // Should NOT display the raw ID as visible text
    expect(el.textContent).not.toContain('QxXITvX6eqkAbs1X1W3Md');
    // Should display an adjective_noun pattern
    expect(el.textContent).toMatch(/[a-z]+_[a-z]+/);
  });

  it('shows the real ID in the tooltip (data-tip)', () => {
    render(<FriendlyId id="uHXsT_9Labcd" />);
    const el = screen.getByTestId('friendly-id');
    expect(el).toHaveAttribute('data-tip', 'uHXsT_9Labcd');
  });

  it('copies the real ID to clipboard on click', async () => {
    render(<FriendlyId id="my-real-session-id" />);
    const el = screen.getByTestId('friendly-id');
    await act(async () => {
      fireEvent.click(el);
    });
    expect(mockWriteText).toHaveBeenCalledWith('my-real-session-id');
  });

  it('shows "copied!" feedback after click', async () => {
    render(<FriendlyId id="my-real-session-id" />);
    const el = screen.getByTestId('friendly-id');
    await act(async () => {
      fireEvent.click(el);
    });
    await act(async () => {
      await Promise.resolve(); // flush microtasks for clipboard promise
    });
    expect(screen.getByTestId('friendly-id').textContent).toContain('copied!');
  });

  it('reverts to friendly name after 1500ms', async () => {
    render(<FriendlyId id="session-abc" />);
    const el = screen.getByTestId('friendly-id');
    await act(async () => {
      fireEvent.click(el);
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(el.textContent).toContain('copied!');

    await act(async () => {
      vi.advanceTimersByTime(1500);
    });
    expect(el.textContent).not.toContain('copied!');
    expect(el.textContent).toMatch(/[a-z]+_[a-z]+/);
  });

  it('tooltip updates to "✓ copied!" text after click', async () => {
    render(<FriendlyId id="session-xyz" />);
    const el = screen.getByTestId('friendly-id');
    await act(async () => {
      fireEvent.click(el);
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(el).toHaveAttribute('data-tip', '✓ copied!');
  });

  it('same ID always renders the same friendly name', () => {
    const { unmount } = render(<FriendlyId id="stable-id-123" />);
    const text1 = screen.getByTestId('friendly-id').textContent;
    unmount();
    render(<FriendlyId id="stable-id-123" />);
    const text2 = screen.getByTestId('friendly-id').textContent;
    expect(text1).toBe(text2);
  });

  it('accepts a custom className', () => {
    render(<FriendlyId id="any-id" className="my-custom-class" />);
    const el = screen.getByTestId('friendly-id');
    expect(el.className).toContain('my-custom-class');
  });

  it('stops click event propagation', async () => {
    const parentClick = vi.fn();
    render(
      <div onClick={parentClick}>
        <FriendlyId id="propagation-test" />
      </div>,
    );
    await act(async () => {
      fireEvent.click(screen.getByTestId('friendly-id'));
    });
    expect(parentClick).not.toHaveBeenCalled();
  });
});
