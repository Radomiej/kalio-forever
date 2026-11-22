import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { DecisionSettings } from '@kalio/types';
import { DecisionSettingsPanel, type DecisionSettingsPanelProps } from './DecisionSettingsPanel';
import { LOCAL_DECISION_MODEL, type LocalDecisionModelTransport } from './local-decision-model.transport';

const config: DecisionSettings = { provider: 'openrouter', model: 'typesafe/jev-1.13', credentialId: null, endpoint: '' };
function makeModelTransport(): LocalDecisionModelTransport {
  return {
    catalog: vi.fn().mockResolvedValue({ version: 1, backendAvailable: true, backendError: null, activeJob: null, recentJobs: [], models: [{
      modelTag: LOCAL_DECISION_MODEL, displayName: 'Qwen 3.5 2B', expectedSizeBytes: 1945781358,
      installed: true, chatCompatible: true, readiness: 'metadata_ready', sizeBytes: 1945781358,
      digest: 'a'.repeat(64), capabilities: ['completion'], installable: false,
    }] }), install: vi.fn(), job: vi.fn(), cancel: vi.fn(),
  };
}
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
    expect(screen.getByLabelText('Decision endpoint')).toBeVisible();
    expect(transport.updateConfig).not.toHaveBeenCalled();
  });
  it('saves the draft and rehydrates canonical backend response on remount', async () => {
    const user = userEvent.setup(); const transport = makeTransport();
    const view = render(<DecisionSettingsPanel transport={transport} />);
    await screen.findByLabelText('Decision provider');
    fireEvent.change(screen.getByLabelText('Decision model'), { target: { value: '  another-jev  ' } });
    await user.click(screen.getByRole('button', { name: 'Save Decision Settings' }));
    await screen.findByText('Decision Settings saved.');
    expect(transport.updateConfig).toHaveBeenCalledWith({ ...config, model: 'another-jev' }, 'tools');
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
    expect(screen.getByLabelText('Decision purpose')).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Decision purpose'), { target: { value: 'goals' } });
    expect(transport.getConfig).toHaveBeenCalledExactlyOnceWith('tools');
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
      if (path === '/api/decision/config?purpose=tools') {
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
      expect(fetch.mock.calls.some(([path, init]) => path === '/api/decision/config?purpose=tools' && init?.method === 'PUT')).toBe(true);
    } finally { vi.unstubAllGlobals(); }
  });
});

it('uses exact native Ollama model and no credentials, then preserves separate goals', async () => {
  const transport = makeTransport();
  const modelTransport = makeModelTransport();
  vi.mocked(transport.getConfig).mockImplementation(async (purpose) => ({ ...config, model: purpose === 'goals' ? 'preserved-goal' : config.model }));
  render(<DecisionSettingsPanel transport={transport} modelTransport={modelTransport} />);
  await waitFor(() => expect(screen.getByLabelText('Decision provider')).toBeEnabled());
  expect(transport.getConfig).toHaveBeenCalledWith('tools');
  fireEvent.change(screen.getByLabelText('Decision provider'), { target: { value: 'ollama' } });
  expect(screen.getByLabelText('Decision model')).toHaveValue('');
  expect(screen.getByLabelText('Decision endpoint')).toHaveValue('http://127.0.0.1:11434/api/chat');
  expect(screen.getByText('Ollama address')).toBeInTheDocument();
  expect(screen.queryByLabelText('Decision credential')).not.toBeInTheDocument();
  expect(screen.queryByText(/No compatible credential/)).not.toBeInTheDocument();
  expect(screen.getByText('Choose the model, then save. Approval rules stay in HITL Approvals.')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Save Decision Settings' })).toBeDisabled();
  await screen.findByText('Installed');
  expect(modelTransport.install).not.toHaveBeenCalled();
  expect(transport.updateConfig).not.toHaveBeenCalled();
  fireEvent.change(screen.getByRole('combobox', { name: 'Decision model' }), { target: { value: LOCAL_DECISION_MODEL } });
  fireEvent.click(screen.getByRole('button', { name: 'Save Decision Settings' }));
  await screen.findByText('Decision Settings saved.');
  expect(transport.updateConfig).toHaveBeenCalledExactlyOnceWith({ provider: 'ollama', model: LOCAL_DECISION_MODEL, credentialId: null, endpoint: 'http://127.0.0.1:11434/api/chat' }, 'tools');
  expect(screen.getByText(/Saving here does not enable automatic approvals/)).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Decision purpose'), { target: { value: 'goals' } });
  await waitFor(() => expect(screen.getByLabelText('Decision model')).toHaveValue('preserved-goal'));
  expect(screen.queryByRole('option', { name: 'Ollama (local)' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Save Decision Settings' }));
  await screen.findByText('Decision Settings saved.');
  expect(transport.updateConfig).toHaveBeenLastCalledWith({ ...config, model: 'preserved-goal' }, 'goals');
});

it('ignores a late tools load after switching to goals', async () => {
  const transport = makeTransport();
  let finish!: (value: DecisionSettings) => void;
  vi.mocked(transport.getConfig).mockImplementation((purpose) => purpose === 'tools'
    ? new Promise((resolve) => { finish = resolve; })
    : Promise.resolve({ ...config, model: 'goal-model' }));
  render(<DecisionSettingsPanel transport={transport} />);
  fireEvent.change(screen.getByLabelText('Decision purpose'), { target: { value: 'goals' } });
  await waitFor(() => expect(screen.getByLabelText('Decision model')).toHaveValue('goal-model'));
  await act(async () => { finish({ ...config, model: 'late-tools' }); });
  await waitFor(() => expect(screen.getByLabelText('Decision model')).toHaveValue('goal-model'));
  fireEvent.click(screen.getByRole('button', { name: 'Save Decision Settings' }));
  await screen.findByText('Decision Settings saved.');
  expect(transport.updateConfig).toHaveBeenCalledWith({ ...config, model: 'goal-model' }, 'goals');
});

it('fails closed if a preserved goals config contains unsupported native Ollama', async () => {
  const transport = makeTransport();
  vi.mocked(transport.getConfig).mockResolvedValue({ provider: 'ollama', model: 'local-exact', credentialId: null, endpoint: 'http://127.0.0.1:11434/api/chat' });
  render(<DecisionSettingsPanel transport={transport} modelTransport={makeModelTransport()} />);
  await waitFor(() => expect(screen.getByLabelText('Decision provider')).toBeEnabled());
  fireEvent.change(screen.getByLabelText('Decision purpose'), { target: { value: 'goals' } });
  expect(await screen.findByRole('alert')).toHaveTextContent('Native Ollama goal routing is not implemented');
  expect(screen.getByRole('button', { name: 'Save Decision Settings' })).toBeDisabled();
  expect(transport.updateConfig).not.toHaveBeenCalled();
});

it('validates native endpoint protocol and embedded credentials before saving', async () => {
  const transport = makeTransport();
  render(<DecisionSettingsPanel transport={transport} modelTransport={makeModelTransport()} />);
  await waitFor(() => expect(screen.getByLabelText('Decision provider')).toBeEnabled());
  fireEvent.change(screen.getByLabelText('Decision provider'), { target: { value: 'ollama' } });
  await screen.findByText('Installed');
  fireEvent.change(screen.getByLabelText('Decision model'), { target: { value: LOCAL_DECISION_MODEL } });
  for (const endpoint of ['file:///model', 'http://user:secret@localhost:11434/api/chat', 'invalid']) {
    fireEvent.change(screen.getByLabelText('Decision endpoint'), { target: { value: endpoint } });
    expect(screen.getByRole('button', { name: 'Save Decision Settings' })).toBeDisabled();
  }
  expect(transport.updateConfig).not.toHaveBeenCalled();
});

it('preserves an unmatched saved Ollama model on hydration and never autosaves the curated model', async () => {
  const transport = makeTransport(); const modelTransport = makeModelTransport();
  vi.mocked(transport.getConfig).mockResolvedValue({ provider: 'ollama', model: 'existing:custom', credentialId: null, endpoint: 'http://127.0.0.1:11434/api/chat' });
  render(<DecisionSettingsPanel transport={transport} modelTransport={modelTransport} />);
  await screen.findByText('Installed');
  expect(screen.getByRole('combobox', { name: 'Decision model' })).toHaveValue('existing:custom');
  expect(transport.updateConfig).not.toHaveBeenCalled();
  expect(modelTransport.install).not.toHaveBeenCalled();
});

it('keeps a non-default saved Ollama connection and model without using the default catalogue', async () => {
  const transport = makeTransport(); const modelTransport = makeModelTransport();
  vi.mocked(transport.getConfig).mockResolvedValue({ provider: 'ollama', model: 'existing:custom', credentialId: null, endpoint: 'http://localhost:11435/api/chat' });
  render(<DecisionSettingsPanel transport={transport} modelTransport={modelTransport} />);
  await waitFor(() => expect(screen.getByLabelText('Decision provider')).toBeEnabled());
  expect(screen.getByLabelText('Decision model')).toHaveValue('existing:custom');
  expect(screen.getByLabelText('Decision model')).toBeDisabled();
  expect(screen.getByLabelText('Decision endpoint')).toHaveValue('http://localhost:11435/api/chat');
  expect(screen.getByLabelText('Decision endpoint')).not.toBeVisible();
  fireEvent.click(screen.getByText('Connection settings'));
  expect(screen.getByLabelText('Decision endpoint')).toBeVisible();
  expect(modelTransport.catalog).not.toHaveBeenCalled();
  expect(transport.updateConfig).not.toHaveBeenCalled();
});
