import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { DecisionSettings } from '@kalio/types';
import { DecisionSettingsPanel, type DecisionSettingsPanelProps } from './DecisionSettingsPanel';

const config: DecisionSettings = { provider: 'openrouter', model: 'typesafe/jev-1.13', credentialId: null, endpoint: '' };
function makeTransport(): NonNullable<DecisionSettingsPanelProps['transport']> {
  return {
    getConfig: vi.fn().mockResolvedValue(config),
    getCredentials: vi.fn().mockResolvedValue([]),
    updateConfig: vi.fn(async (next: DecisionSettings) => next),
  };
}
describe('DecisionSettingsPanel', () => {
  beforeEach(() => vi.restoreAllMocks());
  it('fails closed without an authenticated adapter and makes no requests', async () => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    render(<DecisionSettingsPanel transport={null} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Authenticated');
    expect(screen.getByRole('button', { name: 'Save Decision Settings' })).toBeDisabled();
    expect(fetch).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
  it('hydrates saved settings without saving defaults or changing HITL mode', async () => {
    const transport = makeTransport();
    vi.mocked(transport.getConfig).mockResolvedValue({ ...config, provider: 'custom', model: 'local', endpoint: 'http://127.0.0.1:9090/decide' });
    render(<DecisionSettingsPanel transport={transport} />);
    expect(screen.getByRole('status')).toHaveTextContent('Loading');
    expect(await screen.findByLabelText('Decision endpoint')).toHaveValue('http://127.0.0.1:9090/decide');
    expect(transport.updateConfig).not.toHaveBeenCalled();
  });
  it('saves the draft and rehydrates canonical backend response on remount', async () => {
    const user = userEvent.setup(); const transport = makeTransport();
    const view = render(<DecisionSettingsPanel transport={transport} />);
    await screen.findByLabelText('Decision provider');
    fireEvent.change(screen.getByLabelText('Decision model'), { target: { value: '  another-jev  ' } });
    await user.click(screen.getByRole('button', { name: 'Save Decision Settings' }));
    await screen.findByText('Decision Settings saved.');
    expect(transport.updateConfig).toHaveBeenCalledWith({ ...config, model: 'another-jev' });
    vi.mocked(transport.getConfig).mockResolvedValue({ ...config, model: 'another-jev' });
    view.unmount(); render(<DecisionSettingsPanel transport={transport} />);
    await waitFor(() => expect(screen.getByLabelText('Decision model')).toHaveValue('another-jev'));
  });
  it('retains the draft after a denied save and lets the user retry', async () => {
    const user = userEvent.setup(); const transport = makeTransport();
    vi.mocked(transport.updateConfig).mockRejectedValueOnce(new Error('401: authentication required'));
    render(<DecisionSettingsPanel transport={transport} />);
    await screen.findByLabelText('Decision model');
    fireEvent.change(screen.getByLabelText('Decision model'), { target: { value: 'draft' } });
    await user.click(screen.getByRole('button', { name: 'Save Decision Settings' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('401');
    expect(screen.getByLabelText('Decision model')).toHaveValue('draft');
    expect(screen.queryByText('Decision Settings saved.')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Save Decision Settings' }));
    await screen.findByText('Decision Settings saved.');
  });
  it('does not enable writes after a failed load and reloads safely', async () => {
    const user = userEvent.setup(); const transport = makeTransport();
    vi.mocked(transport.getConfig).mockRejectedValueOnce(new Error('Settings unavailable'));
    render(<DecisionSettingsPanel transport={transport} />);
    await screen.findByRole('alert');
    expect(screen.getByLabelText('Decision provider')).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Reload settings' }));
    await waitFor(() => expect(screen.getByLabelText('Decision provider')).toBeEnabled());
    expect(transport.updateConfig).not.toHaveBeenCalled();
  });
  it('rejects invalid custom endpoints and embedded secrets before saving', async () => {
    const transport = makeTransport(); render(<DecisionSettingsPanel transport={transport} />);
    await screen.findByLabelText('Decision provider');
    fireEvent.change(screen.getByLabelText('Decision provider'), { target: { value: 'custom' } });
    fireEvent.change(screen.getByLabelText('Decision model'), { target: { value: 'local' } });
    for (const endpoint of ['file:///tmp/model', 'https://user:secret@example.test/decide', 'invalid']) {
      fireEvent.change(screen.getByLabelText('Decision endpoint'), { target: { value: endpoint } });
      expect(screen.getByRole('button', { name: 'Save Decision Settings' })).toBeDisabled();
    }
    fireEvent.change(screen.getByLabelText('Decision endpoint'), { target: { value: 'http://localhost:9090/decide' } });
    expect(screen.getByRole('button', { name: 'Save Decision Settings' })).toBeEnabled();
    expect(transport.updateConfig).not.toHaveBeenCalled();
  });
  it('prevents editing or reloading while save is pending', async () => {
    const user = userEvent.setup(); const transport = makeTransport();
    let finish!: (value: DecisionSettings) => void;
    vi.mocked(transport.updateConfig).mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    render(<DecisionSettingsPanel transport={transport} />);
    await screen.findByLabelText('Decision provider');
    await user.click(screen.getByRole('button', { name: 'Save Decision Settings' }));
    expect(screen.getByRole('button', { name: 'Saving…' })).toBeDisabled();
    expect(screen.getByLabelText('Decision model')).toBeDisabled();
    finish(config); await screen.findByText('Decision Settings saved.');
  });

  it('uses the default cookie adapter, recovers explicit 401 and persists through it', async () => {
    const user = userEvent.setup(); let authenticated = false;
    const fetch = vi.fn(async (path: string, init?: RequestInit) => {
      if (path === '/api/credentials') return new Response('[]', { status: 200 });
      if (path === '/api/decision/auth') {
        authenticated = true;
        expect(init?.credentials).toBe('same-origin');
        return new Response(null, { status: 204 });
      }
      if (path === '/api/decision/config') {
        expect(init?.credentials).toBe('same-origin');
        expect(new Headers(init?.headers).has('Authorization')).toBe(false);
        if (!authenticated) return new Response(JSON.stringify({ code: 'DECISION_AUTH_REQUIRED' }), { status: 401 });
        return new Response(init?.method === 'PUT' ? String(init.body) : JSON.stringify(config), { status: 200 });
      }
      throw new Error(`Unexpected request ${path}`);
    });
    vi.stubGlobal('fetch', fetch);
    try {
      render(<DecisionSettingsPanel />);
      await screen.findByLabelText('Decision provider');
      expect(fetch.mock.calls.filter(([path]) => path === '/api/decision/auth')).toHaveLength(1);
      expect(fetch.mock.calls.some(([, init]) => init?.method === 'PUT')).toBe(false);
      await user.click(screen.getByRole('button', { name: 'Save Decision Settings' }));
      await screen.findByText('Decision Settings saved.');
      expect(fetch.mock.calls.some(([path, init]) => path === '/api/decision/config' && init?.method === 'PUT')).toBe(true);
    } finally { vi.unstubAllGlobals(); }
  });
});
