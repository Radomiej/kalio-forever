import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NativeCliIntegrationsPanel } from './NativeCliIntegrationsPanel';

const STATUS = {
  id: 'codex:chatgpt-default',
  provider: 'codex',
  displayName: 'Codex App Server (chatgpt-default)',
  kind: 'codex-app-server',
  authProfileId: 'chatgpt-default',
  status: 'online',
  connected: true,
  openSessionCount: 2,
  processEpoch: 'epoch-1',
  profileIds: ['codex-guard', 'codex-luna'],
  models: ['gpt-5.4', 'gpt-5.6-luna'],
  mcp: { inheritConfiguredMcp: false, source: 'default' },
};

const DEVIN_STATUS = {
  executable: 'devin.exe',
  version: '3000.2.17',
  authenticated: true,
  acp: true,
  models: ['glm-5-2', 'swe-1-7'],
  hostCount: 0,
  hosts: [],
};

describe('NativeCliIntegrationsPanel', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === '/api/runtime/native-cli-integrations' && !init?.method) {
        return new Response(JSON.stringify([STATUS]), { status: 200 });
      }
      if (url === '/api/runtime/devin-cli/status' && !init?.method) {
        return new Response(JSON.stringify(DEVIN_STATUS), { status: 200 });
      }
      if (url.endsWith('/check') || url.endsWith('/reset')) {
        return new Response(JSON.stringify({ ...STATUS, ...(url.endsWith('/reset') ? { status: 'offline', connected: false, openSessionCount: 0 } : {}) }), { status: 200 });
      }
      if (url.endsWith('/settings') && init?.method === 'PATCH') {
        const body = JSON.parse(String(init.body)) as { inheritConfiguredMcp: boolean };
        return new Response(JSON.stringify({ inheritConfiguredMcp: body.inheritConfiguredMcp, source: 'settings' }), { status: 200 });
      }
      return new Response(null, { status: 404 });
    }));
    vi.stubGlobal('confirm', vi.fn(() => true));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('shows connection state and open native sessions', async () => {
    render(<NativeCliIntegrationsPanel />);

    expect(await screen.findByText('Codex')).toBeInTheDocument();
    expect(screen.getByTestId('devin-cli-integration-card')).toHaveTextContent('glm-5-2');
    expect(screen.getAllByText('Online')).toHaveLength(2);
    expect(screen.getByText('2 open sessions')).toBeInTheDocument();
    expect(screen.getByText(/gpt-5\.6-luna/)).toBeInTheDocument();
  });

  it('checks the integration automatically when the page opens', async () => {
    render(<NativeCliIntegrationsPanel />);
    await screen.findByText('Codex');

    await waitFor(() => expect(global.fetch).toHaveBeenCalledWith(
      '/api/runtime/native-cli-integrations/chatgpt-default/check',
      expect.objectContaining({ method: 'POST' }),
    ));
  });

  it('checks and resets an integration from the panel', async () => {
    render(<NativeCliIntegrationsPanel />);
    await screen.findByText('Codex');

    fireEvent.click(screen.getAllByRole('button', { name: 'Recheck' })[1]!);
    await waitFor(() => expect(global.fetch).toHaveBeenCalledWith(
      '/api/runtime/native-cli-integrations/chatgpt-default/check',
      expect.objectContaining({ method: 'POST' }),
    ));

    fireEvent.click(screen.getByRole('button', { name: 'Reset' }));
    await waitFor(() => expect(global.fetch).toHaveBeenCalledWith(
      '/api/runtime/native-cli-integrations/chatgpt-default/reset',
      expect.objectContaining({ method: 'POST' }),
    ));
  });

  it('toggles inherited Codex MCP access from the integration settings', async () => {
    render(<NativeCliIntegrationsPanel />);
    await screen.findByText('Codex');

    fireEvent.click(screen.getByRole('checkbox', { name: 'Allow Codex profile MCP servers' }));

    await waitFor(() => expect(global.fetch).toHaveBeenCalledWith(
      '/api/runtime/native-cli-integrations/chatgpt-default/settings',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ inheritConfiguredMcp: true }),
      }),
    ));
  });
});
