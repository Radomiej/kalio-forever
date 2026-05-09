import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ToolsPanel } from './ToolsPanel';

const fetchMock = vi.fn();

describe('ToolsPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(globalThis, 'fetch', {
      value: fetchMock,
      configurable: true,
      writable: true,
    });
  });

  it('shows a successful probe result and version after mount', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ available: true, version: '1.2.3' }),
    });

    render(<ToolsPanel />);

    expect(await screen.findByText('Available')).toBeInTheDocument();
    expect(screen.getByText('1.2.3')).toBeInTheDocument();
    expect(screen.getByText(/Fullstack Dev/i)).toBeInTheDocument();
  });

  it('shows install guidance when the CLI is not found', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ available: false, version: null }),
    });

    render(<ToolsPanel />);

    expect(await screen.findByText('Not found')).toBeInTheDocument();
    expect(screen.getByText(/Install GitHub Copilot CLI/i)).toBeInTheDocument();
  });

  it('surfaces probe errors and lets the user retry', async () => {
    fetchMock
      .mockRejectedValueOnce(new Error('network offline'))
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ available: true, version: null }),
      });

    render(<ToolsPanel />);

    expect(await screen.findByText(/network offline/i)).toBeInTheDocument();

    fireEvent.click(screen.getByTitle('Re-check'));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(await screen.findByText('Available')).toBeInTheDocument();
  });
});
