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

  it('groups MCP tools separately and shows their canonical serverKey badge', async () => {
    apiGet.mockResolvedValue({
      data: [
        makeTool({
          name: 'mcp_toml::docs_search',
          description: 'Search docs',
          serverKey: 'toml::docs',
        }),
        makeTool({ name: 'web_search' }),
      ],
    });

    render(<ToolPanel />);

    expect(await screen.findByText('2 tools')).toBeInTheDocument();
    expect(screen.getByText('MCP')).toBeInTheDocument();
    expect(screen.getByTitle('MCP serverKey: toml::docs')).toBeInTheDocument();
  });

  it('filters tools by name, description, and MCP server key', async () => {
    apiGet.mockResolvedValue({
      data: [
        makeTool({ name: 'web_search', description: 'Search the public web' }),
        makeTool({ name: 'vfs_read', description: 'Read workspace files' }),
        makeTool({ name: 'mcp_toml::docs_search', description: 'Look up references', serverKey: 'toml::docs' }),
      ],
    });

    render(<ToolPanel />);
    await screen.findByText('3 tools');

    fireEvent.change(screen.getByRole('searchbox', { name: 'Search tools' }), {
      target: { value: 'workspace' },
    });

    expect(screen.getByText('vfs_read')).toBeInTheDocument();
    expect(screen.queryByText('web_search')).not.toBeInTheDocument();

    fireEvent.change(screen.getByRole('searchbox', { name: 'Search tools' }), {
      target: { value: 'toml::docs' },
    });

    expect(screen.getByText('mcp_toml::docs_search')).toBeInTheDocument();
  });

  it('shows confirmation state with text as well as an icon', async () => {
    apiGet.mockResolvedValue({
      data: [makeTool({ name: 'dangerous_tool', requiresConfirmation: true })],
    });

    render(<ToolPanel />);

    expect(await screen.findByText('Confirmation')).toBeInTheDocument();
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
