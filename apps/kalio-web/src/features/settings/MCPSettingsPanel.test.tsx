import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MCPSettingsPanel } from './MCPSettingsPanel';
import type { MCPServer } from '@kalio/types';
import type { SettingsMCPServer } from './MCPSettingsPanel.model';

type FetchMap = Record<string, unknown>;

function mockFetch(map: FetchMap) {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, opts?: RequestInit) => {
      const method = opts?.method?.toUpperCase() ?? 'GET';
      const key = `${method} ${url}`;
      const value = key in map ? map[key] : (map[url] ?? null);

      if (value === null) return Promise.resolve(new Response(null, { status: 404 }));
      if (value === 204) return Promise.resolve(new Response(null, { status: 204 }));
      if (value instanceof Error) return Promise.reject(value);
      return Promise.resolve(
        new Response(JSON.stringify(value), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );
    }),
  );
}

const SERVER1: SettingsMCPServer = {
  id: 'sqlite-row-s1',
  name: 'GitHub MCP',
  transport: 'http',
  url: 'https://mcp.github.com/sse',
  status: 'connected',
  toolCount: 5,
  createdAt: 1704067200000,
  serverKey: 'sqlite::github',
  store: 'sqlite',
  originSource: 'manual',
  effectiveState: 'active',
  conflictGroup: 'github-signature',
};

const SERVER2: SettingsMCPServer = {
  id: 'sqlite-row-s2',
  name: 'Local stdio',
  transport: 'stdio',
  command: 'npx',
  status: 'error',
  lastError: 'Connection refused',
  toolCount: 0,
  createdAt: 1704067200000,
  serverKey: 'sqlite::local-stdio',
  store: 'sqlite',
  originSource: 'manual',
  effectiveState: 'active',
  conflictGroup: 'local-stdio-signature',
};

const TOML_SERVER: SettingsMCPServer = {
  ...SERVER2,
  id: 'toml-row-docs',
  name: 'docs',
  serverKey: 'toml::docs',
  store: 'toml',
  originSource: 'toml',
  effectiveState: 'active',
  conflictGroup: 'docs-signature',
};

const EXTERNAL_DISCOVERY = [
  {
    id: 'cursor:mcp:github',
    source: 'cursor',
    configPath: 'C:/Users/test/.cursor/mcp.json',
    key: 'github',
    dto: {
      name: 'GitHub (Cursor)',
      transport: 'stdio',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-github'],
    },
    details: {
      envKeys: ['GITHUB_TOKEN'],
      headerKeys: [],
    },
    equivalentToExisting: true,
    serverKey: 'sqlite::github',
    store: 'sqlite',
    originSource: 'cursor',
    effectiveState: 'shadowed',
    conflictGroup: 'github-signature',
  },
  {
    id: 'windsurf:mcp:filesystem',
    source: 'windsurf',
    configPath: 'C:/Users/test/AppData/Roaming/Windsurf/User/mcp.json',
    key: 'filesystem',
    dto: {
      name: 'Filesystem (Windsurf)',
      transport: 'stdio',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-filesystem', '.'],
    },
    details: {
      envKeys: [],
      headerKeys: [],
    },
    equivalentToExisting: false,
    serverKey: 'sqlite::filesystem',
    store: 'sqlite',
    originSource: 'windsurf',
    effectiveState: 'active',
    conflictGroup: 'filesystem-signature',
  },
];

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('MCPSettingsPanel', () => {
  it('shows empty state when no servers', async () => {
    mockFetch({ 'GET /api/mcp/servers': [] });
    render(<MCPSettingsPanel />);
    await waitFor(() => expect(screen.getByTestId('mcp-empty')).toBeInTheDocument());
    expect(screen.getByText(/no servers connected yet/i)).toBeInTheDocument();
  });

  it('renders connected server rows', async () => {
    mockFetch({ 'GET /api/mcp/servers': [SERVER1] });
    render(<MCPSettingsPanel />);
    await waitFor(() => expect(screen.getByTestId('mcp-server-sqlite-github-sqlite')).toBeInTheDocument());
    expect(screen.getByText('GitHub MCP')).toBeInTheDocument();
    expect(screen.getByText('connected')).toBeInTheDocument();
  });

  it('renders separate rows for TOML and SQLite variants of the same serverKey', async () => {
    mockFetch({
      'GET /api/mcp/servers': [
        TOML_SERVER,
        {
          ...SERVER1,
          id: 'sqlite-row-docs',
          name: 'docs',
          serverKey: 'sqlite::docs',
          conflictGroup: 'docs-signature',
          originSource: 'manual',
          effectiveState: 'shadowed',
        },
      ],
    });

    render(<MCPSettingsPanel />);

    await waitFor(() => expect(screen.getByTestId('mcp-server-toml-docs-toml')).toBeInTheDocument());
    expect(screen.getByTestId('mcp-server-sqlite-docs-sqlite')).toBeInTheDocument();
  });

  it('shows error server with lastError message', async () => {
    mockFetch({ 'GET /api/mcp/servers': [SERVER2] });
    render(<MCPSettingsPanel />);
    await waitFor(() => expect(screen.getByText('Connection refused')).toBeInTheDocument());
  });

  it('restart button calls POST /api/mcp/servers/:serverKey/restart', async () => {
    mockFetch({
      'GET /api/mcp/servers': [SERVER1],
      'POST /api/mcp/servers/sqlite%3A%3Agithub/restart': 204,
    });
    const user = userEvent.setup();
    render(<MCPSettingsPanel />);
    await waitFor(() => screen.getByTestId('mcp-restart-sqlite-github-sqlite'));
    await user.click(screen.getByTestId('mcp-restart-sqlite-github-sqlite'));
    await waitFor(() => {
      const calls = (global.fetch as ReturnType<typeof vi.fn>).mock.calls as [string, RequestInit | undefined][];
      expect(calls.some(([url, opts]) =>
        url === '/api/mcp/servers/sqlite%3A%3Agithub/restart' && opts?.method === 'POST',
      )).toBe(true);
    });
  });

  it('remove button with confirm guard calls DELETE /api/mcp/servers/:serverKey', async () => {
    mockFetch({
      'GET /api/mcp/servers': [SERVER1],
      'DELETE /api/mcp/servers/sqlite%3A%3Agithub': 204,
    });
    const user = userEvent.setup();
    render(<MCPSettingsPanel />);
    await waitFor(() => screen.getByTestId('mcp-remove-sqlite-github-sqlite'));
    // First click shows confirm guard
    await user.click(screen.getByTestId('mcp-remove-sqlite-github-sqlite'));
    const confirmBtn = await screen.findByTestId('mcp-remove-confirm-sqlite-github-sqlite');
    await user.click(confirmBtn);
    await waitFor(() => {
      const calls = (global.fetch as ReturnType<typeof vi.fn>).mock.calls as [string, RequestInit | undefined][];
      expect(calls.some(([url, opts]) =>
        url === '/api/mcp/servers/sqlite%3A%3Agithub' && opts?.method === 'DELETE',
      )).toBe(true);
    });
  });

  it('add server form submit calls POST /api/mcp/servers', async () => {
    const newServer: MCPServer = {
      ...SERVER1,
      id: 's3',
      name: 'New HTTP Server',
      serverKey: 'sqlite::s3',
      store: 'sqlite',
      originSource: 'manual',
      effectiveState: 'active',
      conflictGroup: 'new-http-server-signature',
    };
    mockFetch({
      'GET /api/mcp/servers': [],
      'POST /api/mcp/servers': newServer,
    });
    const user = userEvent.setup();
    render(<MCPSettingsPanel />);
    await waitFor(() => screen.getByTestId('mcp-add-toggle'));
    await user.click(screen.getByTestId('mcp-add-toggle'));
    await screen.findByTestId('mcp-add-form');
    fireEvent.change(screen.getByTestId('mcp-form-name'), { target: { value: 'New HTTP Server' } });
    fireEvent.change(screen.getByTestId('mcp-form-url'), { target: { value: 'https://mcp.test.com/sse' } });
    await user.click(screen.getByTestId('mcp-form-submit'));
    await waitFor(() => {
      const calls = (global.fetch as ReturnType<typeof vi.fn>).mock.calls as [string, RequestInit | undefined][];
      expect(calls.some(([url, opts]) =>
        url === '/api/mcp/servers' && opts?.method === 'POST',
      )).toBe(true);
    });
    await waitFor(() => expect(screen.getByText('New HTTP Server')).toBeInTheDocument());
  });

  it('Docker MCP Gateway button adds stdio server with docker mcp gateway run', async () => {
    const gatewayServer: MCPServer = {
      id: 'gw1',
      serverKey: 'sqlite::gw1',
      name: 'Docker MCP Gateway',
      store: 'sqlite',
      originSource: 'manual',
      effectiveState: 'active',
      transport: 'stdio',
      command: 'docker',
      status: 'connecting',
      toolCount: 0,
      createdAt: 1704067200000,
    };
    mockFetch({
      'GET /api/mcp/servers': [],
      'POST /api/mcp/servers': gatewayServer,
    });
    const user = userEvent.setup();
    render(<MCPSettingsPanel />);
    await waitFor(() => screen.getByTestId('mcp-docker-gateway-btn'));
    await user.click(screen.getByTestId('mcp-docker-gateway-btn'));
    await waitFor(() => {
      const calls = (global.fetch as ReturnType<typeof vi.fn>).mock.calls as [string, RequestInit | undefined][];
      const postCall = calls.find(([url, opts]) => url === '/api/mcp/servers' && opts?.method === 'POST');
      expect(postCall).toBeDefined();
      const body = JSON.parse((postCall![1]?.body as string) ?? '{}') as {
        transport: string;
        command: string;
        args: string[];
      };
      expect(body.transport).toBe('stdio');
      expect(body.command).toBe('docker');
      expect(body.args).toEqual(['mcp', 'gateway', 'run']);
    });
  });

  it('reload config button calls POST /api/mcp/servers/reload-config and refreshes rows', async () => {
    mockFetch({
      'GET /api/mcp/servers': [],
      'POST /api/mcp/servers/reload-config': [SERVER2],
    });
    const user = userEvent.setup();
    render(<MCPSettingsPanel />);
    await waitFor(() => screen.getByTestId('mcp-reload-config-btn'));

    await user.click(screen.getByTestId('mcp-reload-config-btn'));

    await waitFor(() => {
      const calls = (global.fetch as ReturnType<typeof vi.fn>).mock.calls as [string, RequestInit | undefined][];
      expect(calls.some(([url, opts]) =>
        url === '/api/mcp/servers/reload-config' && opts?.method === 'POST',
      )).toBe(true);
    });
    await waitFor(() => expect(screen.getByText('Local stdio')).toBeInTheDocument());
  });

  it('allows restart but blocks removal for TOML-managed servers', async () => {
    mockFetch({ 'GET /api/mcp/servers': [TOML_SERVER] });
    render(<MCPSettingsPanel />);

    await waitFor(() => expect(screen.getByTestId('mcp-store-toml-docs-toml')).toBeInTheDocument());
    expect(screen.getByTestId('mcp-store-toml-docs-toml')).toHaveTextContent('TOML');
    expect(screen.getByTestId('mcp-restart-toml-docs-toml')).not.toBeDisabled();
    expect(screen.getByTestId('mcp-remove-toml-docs-toml')).toBeDisabled();
  });

  it('opens external import modal, keeps equivalent entries selectable, and applies selected configs', async () => {
    mockFetch({
      'GET /api/mcp/servers': [],
      'POST /api/mcp/servers/import/external/discover': EXTERNAL_DISCOVERY,
      'POST /api/mcp/servers/import/external/apply': {
        imported: [
          { id: 's10', name: 'GitHub (Cursor)' },
        ],
        skipped: [],
        failed: [],
      },
    });

    const user = userEvent.setup();
    render(<MCPSettingsPanel />);

    await waitFor(() => screen.getByTestId('mcp-external-import-btn'));
    await user.click(screen.getByTestId('mcp-external-import-btn'));

    await waitFor(() => screen.getByTestId('mcp-external-import-modal'));
    expect(screen.getByText('GitHub (Cursor)')).toBeInTheDocument();
    expect(screen.getByText('Filesystem (Windsurf)')).toBeInTheDocument();
    expect(screen.getByTestId('mcp-external-duplicate-1')).toBeInTheDocument();
    expect(screen.getByTestId('mcp-external-apply-btn')).toBeDisabled();

    await user.click(screen.getByTestId('mcp-external-check-0'));
    await user.click(screen.getByTestId('mcp-external-apply-btn'));

    await waitFor(() => {
      const calls = (global.fetch as ReturnType<typeof vi.fn>).mock.calls as [string, RequestInit | undefined][];
      const applyCall = calls.find(([url, opts]) =>
        url === '/api/mcp/servers/import/external/apply' && opts?.method === 'POST',
      );
      expect(applyCall).toBeDefined();
      const body = JSON.parse((applyCall?.[1]?.body as string) ?? '{}') as { entryIds?: string[] };
      expect(body.entryIds).toEqual(['windsurf:mcp:filesystem']);
    });
  });
});
