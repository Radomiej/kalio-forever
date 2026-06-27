import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { MCPServer, MCPTool } from '@kalio/types';

const { apiGet, apiPost } = vi.hoisted(() => ({
  apiGet: vi.fn(),
  apiPost: vi.fn(),
}));

vi.mock('../../services/apiClient', () => ({
  apiClient: {
    get: apiGet,
    post: apiPost,
  },
}));

import { MCPPanel } from './MCPPanel';

const SERVER_ALPHA: MCPServer = {
  id: 'alpha',
  serverKey: 'sqlite::alpha',
  name: 'Alpha',
  store: 'sqlite',
  originSource: 'manual',
  effectiveState: 'active',
  transport: 'http',
  url: 'https://alpha.example.com/sse',
  status: 'connected',
  toolCount: 2,
  createdAt: 1,
};

const SERVER_BETA: MCPServer = {
  id: 'beta',
  serverKey: 'sqlite::beta',
  name: 'Beta',
  store: 'sqlite',
  originSource: 'manual',
  effectiveState: 'active',
  transport: 'stdio',
  command: 'npx beta-mcp',
  status: 'error',
  lastError: 'Socket closed',
  toolCount: 1,
  createdAt: 2,
};

describe('MCPPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows counts, keeps visible dual-store rows, and opens settings from the header', async () => {
    const user = userEvent.setup();
    apiGet.mockResolvedValueOnce({
      data: [
        SERVER_ALPHA,
        {
          ...SERVER_ALPHA,
          id: 'alpha-toml',
          serverKey: 'toml::alpha',
          store: 'toml',
          originSource: 'toml',
          effectiveState: 'shadowed',
        },
        SERVER_BETA,
      ],
    });
    const onOpenSettings = vi.fn();

    render(<MCPPanel onOpenSettings={onOpenSettings} />);

    expect(await screen.findByText('3 servers · 5 tools')).toBeInTheDocument();
    expect(screen.getByText('Socket closed')).toBeInTheDocument();

    await user.click(screen.getByTestId('mcp-open-settings'));
    expect(onOpenSettings).toHaveBeenCalledTimes(1);
  });

  it('loads tools on expansion and strips backend MCP prefixes from tool names', async () => {
    const user = userEvent.setup();
    const tools: MCPTool[] = [
      {
        name: 'mcp_sqlite::alpha_read_file',
        description: 'Read files',
        serverId: 'sqlite::alpha',
        requiresConfirmation: false,
        parameters: {},
      },
      {
        name: 'mcp_alpha::list_prompts',
        description: 'Legacy name',
        serverId: 'sqlite::alpha',
        requiresConfirmation: false,
        parameters: {},
      },
      {
        name: 'mcp_sqlite::beta_hidden_tool',
        description: 'Other server tool',
        serverId: 'sqlite::beta',
        requiresConfirmation: false,
        parameters: {},
      },
    ];
    apiGet.mockImplementation((url: string) => {
      if (url === '/api/mcp/servers') {
        return Promise.resolve({ data: [SERVER_ALPHA] });
      }
      if (url === '/api/mcp/tools') {
        return Promise.resolve({ data: tools });
      }
      return Promise.reject(new Error(`Unexpected GET ${url}`));
    });

    render(<MCPPanel onOpenSettings={vi.fn()} />);

    await user.click(await screen.findByRole('button', { name: /Alpha/i }));

    expect(await screen.findByText('read_file')).toBeInTheDocument();
    expect(screen.getByText('mcp_alpha::list_prompts')).toBeInTheDocument();
    expect(screen.queryByText('read_file')).toBeInTheDocument();
    expect(screen.queryByText('hidden_tool')).not.toBeInTheDocument();
  });

  it('restarts a server and refreshes the list afterwards', async () => {
    const user = userEvent.setup();
    apiGet
      .mockResolvedValueOnce({ data: [SERVER_ALPHA] })
      .mockResolvedValueOnce({ data: [{ ...SERVER_ALPHA, status: 'connecting' }] });
    apiPost.mockResolvedValue({});

    render(<MCPPanel onOpenSettings={vi.fn()} />);

    await screen.findByText('Alpha');
    await user.click(screen.getByTestId('mcp-restart'));

    await waitFor(() => {
      expect(apiPost).toHaveBeenCalledWith('/api/mcp/servers/sqlite%3A%3Aalpha/restart');
      expect(apiGet).toHaveBeenCalledTimes(2);
    });
  });

  it('shows the empty state action when no servers are configured', async () => {
    const user = userEvent.setup();
    apiGet.mockResolvedValueOnce({ data: [] });
    const onOpenSettings = vi.fn();

    render(<MCPPanel onOpenSettings={onOpenSettings} />);

    expect(await screen.findByText(/No MCP servers configured/i)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Configure in Settings/i }));
    expect(onOpenSettings).toHaveBeenCalledTimes(1);
  });
});
