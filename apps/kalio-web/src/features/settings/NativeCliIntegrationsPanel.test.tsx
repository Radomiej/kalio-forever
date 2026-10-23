import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
  probeChecked: true,
  models: ['glm-5-2', 'swe-1-7'],
  modelCatalogStatus: 'ready',
  modelCatalogStale: false,
  modelCatalogDiscoveredAt: 1,
  hostCount: 0,
  hosts: [],
};

const DEVIN_SETTINGS = {
  mcpBridge: { enabled: true, configuredBy: 'settings', transport: 'streamable-http' },
  nativeTools: { filesystem: false, web: false, terminal: false, source: 'default' },
};

describe('NativeCliIntegrationsPanel', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === '/api/runtime/native-cli-integrations' && !init?.method) {
        return new Response(JSON.stringify([STATUS]), { status: 200 });
      }
      if ((url === '/api/runtime/devin-cli/status' || url === '/api/runtime/devin-cli/status?refresh=true') && !init?.method) {
        return new Response(JSON.stringify(DEVIN_STATUS), { status: 200 });
      }
      if (url === '/api/runtime/devin-cli/settings' && !init?.method) {
        return new Response(JSON.stringify(DEVIN_SETTINGS), { status: 200 });
      }
      if (url === '/api/runtime/devin-cli/settings' && init?.method === 'PATCH') {
        const body = JSON.parse(String(init.body)) as Record<string, unknown>;
        return new Response(JSON.stringify({
          ...DEVIN_SETTINGS,
          nativeTools: {
            ...DEVIN_SETTINGS.nativeTools,
            ...body,
            source: 'settings',
          },
        }), { status: 200 });
      }
      if (url.endsWith('/check') || url.endsWith('/reset')) {
        if (url.endsWith('/models/check')) return new Response(JSON.stringify({ models: STATUS.models }), { status: 200 });
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
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('shows connection state and open native sessions', async () => {
    render(<NativeCliIntegrationsPanel />);

    expect(await screen.findByText('Codex')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Codex', { exact: true }).closest('summary')!);
    expect(within(screen.getByTestId('devin-cli-integration-card')).getByRole('button', { name: 'Browse 2 models' })).toBeInTheDocument();
    expect(within(screen.getByTestId('devin-cli-integration-card')).getByText('CLI ready')).toBeInTheDocument();
    expect(screen.getAllByText('Online')).toHaveLength(1);
    expect(screen.getByText('2 open sessions')).toBeInTheDocument();
    expect(screen.getAllByText(/gpt-5\.6-luna/).length).toBeGreaterThan(0);
  });

  it('keeps the discovered model catalog collapsed until the user opens it', async () => {
    render(<NativeCliIntegrationsPanel />);
    const card = await screen.findByTestId('devin-cli-integration-card');
    expect(within(card).getByRole('button', { name: 'Browse 2 models' })).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: 'Devin models' })).not.toBeInTheDocument();

    fireEvent.click(within(card).getByRole('button', { name: 'Browse 2 models' }));

    const dialog = screen.getByRole('dialog', { name: 'Devin models' });
    expect(within(dialog).getByText('glm-5-2')).toBeInTheDocument();
    expect(within(dialog).getByText('swe-1-7')).toBeInTheDocument();
    fireEvent.change(within(dialog).getByRole('searchbox', { name: 'Search Devin models' }), { target: { value: 'swe' } });
    expect(within(dialog).getByText('swe-1-7')).toBeInTheDocument();
    expect(within(dialog).queryByText('glm-5-2')).not.toBeInTheDocument();
  });

  it('loads status without launching native CLI checks when the panel opens', async () => {
    render(<NativeCliIntegrationsPanel />);
    await screen.findByText('Codex');
    await screen.findByTestId('devin-cli-integration-card');

    const calls = vi.mocked(global.fetch).mock.calls;
    expect(calls.some(([input, init]) => String(input).endsWith('/check') && init?.method === 'POST')).toBe(false);
    expect(calls.some(([input]) => String(input) === '/api/runtime/devin-cli/status?refresh=true')).toBe(false);
  });

  it('keeps the 30-second status poll free of CLI checks and forced discovery', async () => {
    const intervalCallbacks = new Map<ReturnType<typeof window.setInterval>, () => void>();
    let nextIntervalId = 1;
    vi.spyOn(window, 'setInterval').mockImplementation((handler, timeout) => {
      const intervalId = { id: nextIntervalId++ } as unknown as ReturnType<typeof window.setInterval>;
      if (timeout === 30_000 && typeof handler === 'function') intervalCallbacks.set(intervalId, handler as () => void);
      return intervalId;
    });
    vi.spyOn(window, 'clearInterval').mockImplementation((intervalId) => { intervalCallbacks.delete(intervalId as ReturnType<typeof window.setInterval>); });
    render(<NativeCliIntegrationsPanel />);
    await screen.findByText('Codex');
    await screen.findByTestId('devin-cli-integration-card');
    expect(intervalCallbacks.size).toBe(1);

    await act(async () => {
      intervalCallbacks.values().next().value?.();
    });

    const calls = vi.mocked(global.fetch).mock.calls;
    expect(calls.some(([input, init]) => String(input).endsWith('/check') && init?.method === 'POST')).toBe(false);
    expect(calls.some(([input]) => String(input) === '/api/runtime/devin-cli/status?refresh=true')).toBe(false);
  });

  it('refreshes Devin CLI probes only when its Recheck button is pressed', async () => {
    render(<NativeCliIntegrationsPanel />);
    const card = await screen.findByTestId('devin-cli-integration-card');
    const recheckButton = within(card).getByRole('button', { name: 'Recheck' });
    await waitFor(() => expect(recheckButton).toBeEnabled());

    fireEvent.click(recheckButton);

    await waitFor(() => expect(global.fetch).toHaveBeenCalledWith('/api/runtime/devin-cli/status?refresh=true'));
  });

  it('runs all integration checks only when Recheck all is pressed', async () => {
    render(<NativeCliIntegrationsPanel />);
    await screen.findByText('Codex');
    const recheckAllButton = screen.getByTitle('Recheck all native integrations');
    await waitFor(() => expect(recheckAllButton).toBeEnabled());

    fireEvent.click(recheckAllButton);

    await waitFor(() => expect(global.fetch).toHaveBeenCalledWith('/api/runtime/devin-cli/status?refresh=true'));
    await waitFor(() => expect(global.fetch).toHaveBeenCalledWith(
      '/api/runtime/native-cli-integrations/chatgpt-default/check',
      expect.objectContaining({ method: 'POST' }),
    ));

    await waitFor(() => expect(global.fetch).toHaveBeenCalledWith(
      '/api/runtime/native-cli-integrations/chatgpt-default/models/check',
      expect.objectContaining({ method: 'POST' }),
    ));
  });

  it('reports catalog failure without resetting the host', async () => {
    const original = vi.mocked(global.fetch).getMockImplementation()!;
    vi.mocked(global.fetch).mockImplementation((input, init) => String(input).endsWith('/models/check')
      ? Promise.resolve(new Response(null, { status: 503 })) : original(input, init));
    render(<NativeCliIntegrationsPanel />);
    await screen.findByText('Codex');
    fireEvent.click(screen.getByTitle('Recheck all native integrations'));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Codex model catalog refresh failed (503). Retry Recheck.'));
    expect(vi.mocked(global.fetch).mock.calls.some(([input]) => String(input).endsWith('/reset'))).toBe(false);
  });

  it('checks and resets an integration from the panel', async () => {
    render(<NativeCliIntegrationsPanel />);
    await screen.findByText('Codex');
    fireEvent.click(screen.getByText('Codex', { exact: true }).closest('summary')!);
    const codexTitle = (await screen.findAllByText('gpt-5.4, gpt-5.6-luna', { exact: true }))[0];
    const codexCard = codexTitle.closest('article');
    if (!codexCard) throw new Error('Codex integration card was not rendered.');
    const codexControls = within(codexCard);

    fireEvent.click(codexControls.getByRole('button', { name: 'Recheck' }));
    await waitFor(() => expect(global.fetch).toHaveBeenCalledWith(
      '/api/runtime/native-cli-integrations/chatgpt-default/check',
      expect.objectContaining({ method: 'POST' }),
    ));

    fireEvent.click(codexControls.getByRole('button', { name: 'Reset' }));
    expect(vi.mocked(global.fetch).mock.calls.some(([input]) => String(input).endsWith('/reset'))).toBe(false);
    const resetDialog = screen.getByRole('dialog', { name: 'Reset Codex server' });
    fireEvent.click(within(resetDialog).getByRole('button', { name: 'Reset server' }));
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

  it('toggles Devin native filesystem access through the integration settings', async () => {
    render(<NativeCliIntegrationsPanel />);
    await screen.findByText('Codex');

    fireEvent.click(screen.getByRole('checkbox', { name: 'Allow Devin filesystem tools' }));

    await waitFor(() => expect(global.fetch).toHaveBeenCalledWith(
      '/api/runtime/devin-cli/settings',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ filesystem: true }),
      }),
    ));
    expect(await screen.findByRole('status')).toHaveTextContent('Devin filesystem tools enabled and saved.');
  });

  it('generates a local Devin bridge token from Settings', async () => {
    render(<NativeCliIntegrationsPanel />);
    await screen.findByText('Codex');

    fireEvent.click(screen.getByRole('button', { name: 'Generate local token' }));

    await waitFor(() => expect(global.fetch).toHaveBeenCalledWith(
      '/api/runtime/devin-cli/settings',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ generateMcpBridgeToken: true }),
      }),
    ));
    expect(await screen.findByRole('status')).toHaveTextContent('Local bridge token generated and saved. Its value is intentionally hidden.');
  });

  it('saves a manual Devin bridge token override from Settings', async () => {
    render(<NativeCliIntegrationsPanel />);
    await screen.findByText('Codex');

    fireEvent.change(screen.getByLabelText('Kalio MCP bridge token override'), {
      target: { value: 'manual-bridge-token-123' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save override' }));

    await waitFor(() => expect(global.fetch).toHaveBeenCalledWith(
      '/api/runtime/devin-cli/settings',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ mcpBridgeToken: 'manual-bridge-token-123' }),
      }),
    ));
  });

  it.each(['native policy', 'bridge token'])('reloads persisted settings after a failed %s reset without retrying the write', async (kind) => {
    let poll: (() => void) | undefined;
    const realSetInterval = window.setInterval.bind(window);
    vi.spyOn(window, 'setInterval').mockImplementation((handler, timeout) => {
      if (timeout === 30_000 && typeof handler === 'function') poll = handler as () => void;
      return realSetInterval(handler, timeout) as unknown as ReturnType<typeof window.setInterval>;
    });
    const originalFetch = global.fetch;
    let saved = false;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === '/api/runtime/devin-cli/settings' && init?.method === 'PATCH') {
        saved = true;
        return new Response(JSON.stringify({ message: 'Host reset failed' }), { status: 500 });
      }
      if (String(input) === '/api/runtime/devin-cli/settings' && !init?.method && saved) {
        return new Response(JSON.stringify({
          ...DEVIN_SETTINGS,
          nativeTools: { ...DEVIN_SETTINGS.nativeTools, filesystem: true, source: 'settings' },
        }), { status: 200 });
      }
      return originalFetch(input, init);
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<NativeCliIntegrationsPanel />);
    await screen.findByText('Codex');
    if (kind === 'native policy') fireEvent.click(screen.getByRole('checkbox', { name: 'Allow Devin filesystem tools' }));
    else fireEvent.click(screen.getByRole('button', { name: 'Generate local token' }));
    await waitFor(() => expect(screen.getByRole('checkbox', { name: 'Allow Devin filesystem tools' })).toBeChecked());
    expect(screen.getByRole('alert')).toHaveTextContent('Host reset failed');
    expect(screen.queryByTestId('native-integration-notice')).not.toBeInTheDocument();
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'PATCH')).toHaveLength(1);
    await act(async () => { poll?.(); });
    expect(screen.getByRole('alert')).toHaveTextContent('Host reset failed');
  });

  it('reports unknown persisted state when recovery read also fails', async () => {
    const originalFetch = global.fetch;
    let failed = false;
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === '/api/runtime/devin-cli/settings' && init?.method === 'PATCH') {
        failed = true;
        return new Response(JSON.stringify({ message: 'Host reset failed' }), { status: 500 });
      }
      if (String(input) === '/api/runtime/devin-cli/settings' && !init?.method && failed) {
        return new Response(null, { status: 503 });
      }
      return originalFetch(input, init);
    }));
    render(<NativeCliIntegrationsPanel />);
    await screen.findByText('Codex');
    fireEvent.click(screen.getByRole('checkbox', { name: 'Allow Devin filesystem tools' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('current state is unknown'));
    expect(screen.getByRole('alert')).toHaveTextContent('Host reset failed');
    expect(screen.getByRole('checkbox', { name: 'Allow Devin filesystem tools' })).not.toBeChecked();
    expect(screen.queryByTestId('native-integration-notice')).not.toBeInTheDocument();
  });
});
