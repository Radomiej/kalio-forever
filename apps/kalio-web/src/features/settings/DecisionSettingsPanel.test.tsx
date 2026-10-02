import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { DecisionSettings } from '@kalio/types';
import { DecisionSettingsPanel } from './DecisionSettingsPanel';

describe('DecisionSettingsPanel', () => {
  beforeEach(() => { vi.restoreAllMocks(); });
  it('loads the shared provider/model and persists a keyless local model across a remount', async () => {
    let config: DecisionSettings = { provider: 'openrouter', credentialId: 'router-key', model: 'typesafe/jev-1.13', endpoint: '' };
    const fetchMock = vi.fn(async (url: string, options?: RequestInit) => {
      if (url === '/api/credentials') return new Response(JSON.stringify([{ id: 'router-key', name: 'OpenRouter', provider: 'openrouter', createdAt: 1 }]));
      if (options?.method === 'PUT') config = JSON.parse(String(options.body)) as DecisionSettings;
      return new Response(JSON.stringify(config));
    });
    vi.stubGlobal('fetch', fetchMock);
    const first = render(<DecisionSettingsPanel />);
    await screen.findByLabelText('Decision provider');
    expect(screen.getByLabelText('Decision credential')).toHaveValue('router-key');
    fireEvent.change(screen.getByLabelText('Decision provider'), { target: { value: 'custom' } });
    fireEvent.change(screen.getByLabelText('Decision model'), { target: { value: 'local-anyjev' } });
    fireEvent.change(screen.getByLabelText('Decision endpoint'), { target: { value: 'http://127.0.0.1:9090/decide' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Decision Settings' }));
    await screen.findByText('Decision Settings saved.');
    expect(config).toEqual({ provider: 'custom', credentialId: null, model: 'local-anyjev', endpoint: 'http://127.0.0.1:9090/decide' });
    first.unmount();
    render(<DecisionSettingsPanel />);
    expect(await screen.findByLabelText('Decision model')).toHaveValue('local-anyjev');
    expect(screen.getByLabelText('Decision endpoint')).toHaveValue('http://127.0.0.1:9090/decide');
    expect(screen.getByLabelText('Decision credential')).toHaveValue('');
  });

  it('shows load errors with recovery and reports save errors without claiming success', async () => {
    const fetchMock = vi.fn<(url: string, options?: RequestInit) => Promise<Response>>(async () => new Response('Unavailable', { status: 503 }));
    vi.stubGlobal('fetch', fetchMock);
    render(<DecisionSettingsPanel />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Unavailable');
    expect(screen.getByRole('button', { name: 'Save Decision Settings' })).toBeDisabled();
    expect(fetchMock.mock.calls.some(([, options]) => options?.method === 'PUT')).toBe(false);
    fetchMock.mockImplementation(async (url: string, options?: RequestInit) => {
      if (options?.method === 'PUT') return new Response('Invalid credential', { status: 400 });
      return new Response(JSON.stringify(url === '/api/credentials' ? [] : { provider: 'typesafe', model: 'jev-1.13.0', credentialId: null, endpoint: '' }));
    });
    fireEvent.click(screen.getByRole('button', { name: 'Reload settings' }));
    await screen.findByText('No compatible credential yet. Add one in Providers before enabling automatic decisions.');
    fireEvent.click(screen.getByRole('button', { name: 'Save Decision Settings' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Invalid credential'));
    expect(screen.queryByText('Decision Settings saved.')).not.toBeInTheDocument();
  });
});
