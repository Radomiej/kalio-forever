import { fireEvent, render, screen, act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CodeBlock } from './CodeBlock';

describe('CodeBlock', () => {
  const writeText = vi.fn();

  beforeEach(() => {
    vi.useFakeTimers();
    writeText.mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText,
      },
    });
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('copies the code to the clipboard and restores the copy button label', async () => {
    render(<CodeBlock language="tsx" value="const answer = 42;" />);

    expect(screen.getByText('tsx')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /copy/i })).toHaveAttribute('title', 'Copy to clipboard');

    fireEvent.click(screen.getByRole('button', { name: /copy/i }));

    await act(async () => {
      await Promise.resolve();
    });

    expect(writeText).toHaveBeenCalledWith('const answer = 42;');
    expect(screen.getByRole('button', { name: /copied/i })).toHaveAttribute('title', 'Copied!');

    await act(async () => {
      vi.advanceTimersByTime(2000);
    });

    expect(screen.getByRole('button', { name: /copy/i })).toHaveAttribute('title', 'Copy to clipboard');
  });

  it('logs copy failures without switching the copied state', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    writeText.mockRejectedValueOnce(new Error('clipboard blocked'));
    render(<CodeBlock language="text" value="hello world" />);

    fireEvent.click(screen.getByRole('button', { name: /copy/i }));

    await act(async () => {
      await Promise.resolve();
    });

    expect(error).toHaveBeenCalledWith('[CodeBlock] copy failed:', expect.any(Error));
    expect(screen.getByRole('button', { name: /copy/i })).toHaveAttribute('title', 'Copy to clipboard');
  });
});
