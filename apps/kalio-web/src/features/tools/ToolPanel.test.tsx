import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ToolMeta } from '@kalio/types';

const { apiGet, apiPatch } = vi.hoisted(() => ({
  apiGet: vi.fn(),
  apiPatch: vi.fn(),
}));

vi.mock('../../services/apiClient', () => ({
  apiClient: {
    get: apiGet,
    patch: apiPatch,
  },
}));

import { ToolPanel } from './ToolPanel';

function makeTool(overrides: Partial<ToolMeta> = {}): ToolMeta {
  return {
    name: 'web_search',
    description: 'Search the web',
    parameters: { required: ['query'] },
    requiresConfirmation: false,
    ...overrides,
  };
}

describe('ToolPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('loads, groups, and expands tools', async () => {
    apiGet.mockResolvedValue({
      data: [
        makeTool(),
        makeTool({
          name: 'vfs_read',
          description: 'Read a file',
          parameters: { required: ['path'] },
        }),
      ],
    });

    render(<ToolPanel />);

    expect(await screen.findByText('2 tools')).toBeInTheDocument();
    expect(screen.getByText('Web')).toBeInTheDocument();
    expect(screen.getByText('Virtual Filesystem')).toBeInTheDocument();

    fireEvent.click(screen.getByText('web_search'));

    expect(screen.getByText('Search the web')).toBeInTheDocument();
    expect(screen.getByText('query')).toBeInTheDocument();
  });

  it('shows empty and error states from the loader', async () => {
    apiGet.mockResolvedValueOnce({ data: [] });
    const { rerender } = render(<ToolPanel />);

    expect(await screen.findByText(/No tools registered/i)).toBeInTheDocument();

    apiGet.mockRejectedValueOnce(new Error('backend down'));
    rerender(<ToolPanel />);
    fireEvent.click(screen.getByTitle('Refresh tools'));

    expect(await screen.findByText(/backend down/i)).toBeInTheDocument();
  });

  it('optimistically toggles confirmation and persists the update', async () => {
    apiGet.mockResolvedValue({
      data: [makeTool({ name: 'dangerous_tool', requiresConfirmation: false })],
    });
    apiPatch.mockResolvedValue({});

    render(<ToolPanel />);
    expect(await screen.findByText('1 tool')).toBeInTheDocument();

    const toggle = screen.getByTitle('Auto-execute (click to require confirmation)');
    fireEvent.click(toggle);

    await waitFor(() => {
      expect(apiPatch).toHaveBeenCalledWith('/api/tools/dangerous_tool', {
        requiresConfirmation: true,
      });
    });

    expect(screen.getByTitle('Requires confirmation (click to disable)')).toBeInTheDocument();
  });

  it('reverts the optimistic toggle when the patch call fails', async () => {
    apiGet.mockResolvedValue({
      data: [makeTool({ name: 'dangerous_tool', requiresConfirmation: false })],
    });
    apiPatch.mockRejectedValue(new Error('patch failed'));

    render(<ToolPanel />);
    expect(await screen.findByText('1 tool')).toBeInTheDocument();

    fireEvent.click(screen.getByTitle('Auto-execute (click to require confirmation)'));

    await waitFor(() => {
      expect(screen.getByTitle('Auto-execute (click to require confirmation)')).toBeInTheDocument();
    });
  });
});
