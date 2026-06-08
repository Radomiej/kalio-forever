import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ImageConfigResponse } from '@kalio/types';
import { ImageSettingsPanel } from './ImageSettingsPanel';

const DEFAULT_CONFIG: ImageConfigResponse = {
  source: 'default',
  provider: 'auto',
  baseUrl: '',
  model: 'flux-schnell',
  compression: {
    enabled: false,
    maxDimension: 1024,
    maxKb: 512,
    detail: 'low',
  },
};

const SAVED_CONFIG: ImageConfigResponse = {
  source: 'db',
  provider: 'cometapi',
  baseUrl: 'https://api.cometapi.com/v1',
  model: 'flux-schnell',
  compression: {
    enabled: true,
    maxDimension: 1024,
    maxKb: 512,
    detail: 'auto',
  },
};

function mockImageFetch(getConfig: ImageConfigResponse, putConfig?: ImageConfigResponse, putStatus = 200) {
  const fetchMock = vi.fn((url: string, opts?: RequestInit) => {
    const method = opts?.method?.toUpperCase() ?? 'GET';

    if (url === '/api/image/config' && method === 'GET') {
      return Promise.resolve(
        new Response(JSON.stringify(getConfig), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );
    }

    if (url === '/api/image/config' && method === 'PUT') {
      if (putStatus >= 400) {
        return Promise.resolve(new Response('save failed', { status: putStatus }));
      }

      return Promise.resolve(
        new Response(JSON.stringify(putConfig ?? getConfig), {
          status: putStatus,
          headers: { 'Content-Type': 'application/json' },
        }),
      );
    }

    return Promise.resolve(new Response(null, { status: 404 }));
  });

  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('ImageSettingsPanel', () => {
  it('loads image settings, shows the default warning, and saves provider and compression changes', async () => {
    const updatedConfig: ImageConfigResponse = {
      ...SAVED_CONFIG,
      provider: 'openai',
      model: 'dall-e-3',
      baseUrl: 'https://api.openai.com/v1',
      source: 'db',
    };
    const fetchMock = mockImageFetch(DEFAULT_CONFIG, updatedConfig);

    render(<ImageSettingsPanel />);

    expect(screen.getByText(/Loading/i)).toBeInTheDocument();

    expect(await screen.findByRole('heading', { name: 'Image Generation' })).toBeInTheDocument();
    expect(screen.getByText(/No key saved yet/i)).toBeInTheDocument();

    const providerSelect = screen.getByRole('combobox');
    const apiKeyInput = screen.getByPlaceholderText(/Enter API key/i);
    const baseUrlInput = screen.getByPlaceholderText(/https:\/\/api\.cometapi\.com\/v1/i);
    const modelInput = screen.getByPlaceholderText('flux-schnell');

    expect(apiKeyInput).toHaveValue('');
    expect(baseUrlInput).toHaveValue('');
    expect(modelInput).toHaveValue('flux-schnell');

    fireEvent.change(providerSelect, { target: { value: 'openai' } });
    expect(baseUrlInput).toHaveValue('https://api.openai.com/v1');
    expect(modelInput).toHaveValue('dall-e-3');

    fireEvent.click(screen.getByRole('button', { name: 'gpt-image-1 (recommended)' }));
    expect(modelInput).toHaveValue('gpt-image-1');

    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Quality' }));

    const maxDimensionInput = screen.getByDisplayValue('2048');
    const maxKbInput = screen.getByDisplayValue('1024');

    fireEvent.change(maxDimensionInput, { target: { value: '3072' } });
    fireEvent.change(maxKbInput, { target: { value: '1536' } });
    fireEvent.click(screen.getByRole('radio', { name: 'high' }));

    fireEvent.change(apiKeyInput, { target: { value: '  sk-test  ' } });
    fireEvent.click(screen.getByRole('button', { name: /^Save$/i }));

    await waitFor(() => expect(screen.getByRole('button', { name: /Saved!/i })).toBeInTheDocument());
    expect(screen.getByText(/Config saved/i)).toBeInTheDocument();
    expect(apiKeyInput).toHaveValue('');

    const putCall = fetchMock.mock.calls.find(([url, opts]) => url === '/api/image/config' && opts?.method === 'PUT');
    expect(putCall).toBeDefined();

    const body = JSON.parse((putCall?.[1]?.body as string) ?? '{}') as {
      provider: string;
      model: string;
      baseUrl?: string;
      apiKey?: string;
      compression: { enabled: boolean; maxDimension: number; maxKb: number; detail: string };
    };

    expect(body).toEqual({
      provider: 'openai',
      model: 'gpt-image-1',
      baseUrl: 'https://api.openai.com/v1',
      apiKey: 'sk-test',
      compression: {
        enabled: true,
        maxDimension: 3072,
        maxKb: 1536,
        detail: 'high',
      },
    });
  }, 15_000);

  it('shows the saved-provider badge and surfaces save failures', async () => {
    const user = userEvent.setup();
    mockImageFetch(SAVED_CONFIG, undefined, 500);

    render(<ImageSettingsPanel />);

    await waitFor(() => expect(screen.getByRole('heading', { name: 'Image Generation' })).toBeInTheDocument());
    expect(screen.getByText('(saved)')).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/leave blank to keep existing/i)).toHaveValue('');

    await user.click(screen.getByRole('button', { name: /^Save$/i }));

    await waitFor(() => expect(screen.getByText('500: save failed')).toBeInTheDocument());
  });
});
