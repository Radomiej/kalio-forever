import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MCPSettingsPanel } from './MCPSettingsPanel';
import type { MCPServer } from '@kalio/types';

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

const SERVER1: MCPServer = {
  id: 's1',
  name: 'GitHub MCP',
  transport: 'http',
  url: 'https://mcp.github.com/sse',
  status: 'connected',
  toolCount: 5,
  createdAt: 1704067200000,
};

const SERVER2: MCPServer = {
  id: 's2',
  name: 'Local stdio',
  transport: 'stdio',
  command: 'npx',
  status: 'error',
  lastError: 'Connection refused',
  toolCount: 0,
  createdAt: 1704067200000,
};

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
    await waitFor(() => expect(screen.getByTestId(`mcp-server-${SERVER1.id}`)).toBeInTheDocument());
    expect(screen.getByText('GitHub MCP')).toBeInTheDocument();
    expect(screen.getByText('connected')).toBeInTheDocument();
  });

  it('shows error server with lastError message', async () => {
    mockFetch({ 'GET /api/mcp/servers': [SERVER2] });
    render(<MCPSettingsPanel />);
    await waitFor(() => expect(screen.getByText('Connection refused')).toBeInTheDocument());
  });

  it('restart button calls POST /api/mcp/servers/:id/restart', async () => {
    mockFetch({
      'GET /api/mcp/servers': [SERVER1],
      [`POST /api/mcp/servers/${SERVER1.id}/restart`]: 204,
    });
    const user = userEvent.setup();
    render(<MCPSettingsPanel />);
    await waitFor(() => screen.getByTestId(`mcp-restart-${SERVER1.id}`));
    await user.click(screen.getByTestId(`mcp-restart-${SERVER1.id}`));
    await waitFor(() => {
      const calls = (global.fetch as ReturnType<typeof vi.fn>).mock.calls as [string, RequestInit | undefined][];
      expect(calls.some(([url, opts]) =>
        url === `/api/mcp/servers/${SERVER1.id}/restart` && opts?.method === 'POST',
      )).toBe(true);
    });
  });

  it('remove button with confirm guard calls DELETE /api/mcp/servers/:id', async () => {
    mockFetch({
      'GET /api/mcp/servers': [SERVER1],
      [`DELETE /api/mcp/servers/${SERVER1.id}`]: 204,
    });
    const user = userEvent.setup();
    render(<MCPSettingsPanel />);
    await waitFor(() => screen.getByTestId(`mcp-remove-${SERVER1.id}`));
    // First click shows confirm guard
    await user.click(screen.getByTestId(`mcp-remove-${SERVER1.id}`));
    const confirmBtn = await screen.findByTestId(`mcp-remove-confirm-${SERVER1.id}`);
    await user.click(confirmBtn);
    await waitFor(() => {
      const calls = (global.fetch as ReturnType<typeof vi.fn>).mock.calls as [string, RequestInit | undefined][];
      expect(calls.some(([url, opts]) =>
        url === `/api/mcp/servers/${SERVER1.id}` && opts?.method === 'DELETE',
      )).toBe(true);
    });
  });

  it('add server form submit calls POST /api/mcp/servers', async () => {
    const newServer: MCPServer = { ...SERVER1, id: 's3', name: 'New HTTP Server' };
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
      name: 'Docker MCP Gateway',
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
});
