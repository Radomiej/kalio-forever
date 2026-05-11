import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ModelSettingsSection } from './ModelSettingsSection';
import type { Credential } from '@kalio/types';
import type { ActiveRuntimeConfig } from './llm-panel.types';

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
      return Promise.resolve(
        new Response(JSON.stringify(value), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );
    }),
  );
}

const CRED: Credential = {
  id: 'c1',
  name: 'My OpenAI',
  provider: 'openai',
  model: 'gpt-4o-mini',
  createdAt: 1704067200000,
};

const ACTIVE_RUNTIME_CONFIG: ActiveRuntimeConfig = {
  source: 'db',
  provider: CRED.provider,
  model: CRED.model ?? '',
  baseUrl: '',
  displayName: CRED.name,
  credentialId: CRED.id,
};

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('ModelSettingsSection', () => {
  it('shows an empty-state message when no active provider is configured', async () => {
    mockFetch({
      'GET /api/credentials/settings/generation': { temperature: 0.7, maxTokens: 4096 },
    });
    render(<ModelSettingsSection activeRuntimeConfig={null} onRuntimeConfigChange={vi.fn()} />);
    await waitFor(() => expect(screen.getByText(/no active provider configured yet/i)).toBeInTheDocument());
  });

  it('fetches and displays generation settings', async () => {
    mockFetch({
      'GET /api/credentials/settings/generation': { temperature: 1.2, maxTokens: 8192 },
      'GET /api/llm/active/models': { models: ['gpt-4o', 'gpt-4o-mini'] },
    });
    render(<ModelSettingsSection activeRuntimeConfig={ACTIVE_RUNTIME_CONFIG} onRuntimeConfigChange={vi.fn()} />);
    await waitFor(() => expect(screen.getByTestId('gen-temperature-value')).toHaveTextContent('1.20'));
  });

  it('populates model dropdown from GET /api/llm/active/models', async () => {
    mockFetch({
      'GET /api/credentials/settings/generation': { temperature: 0.7, maxTokens: 4096 },
      'GET /api/llm/active/models': { models: ['gpt-4o', 'gpt-4o-mini', 'gpt-3.5-turbo'] },
    });
    const user = userEvent.setup();
    render(<ModelSettingsSection activeRuntimeConfig={ACTIVE_RUNTIME_CONFIG} onRuntimeConfigChange={vi.fn()} />);
    const input = screen.getByTestId('model-selector');
    await waitFor(() => expect(input).toBeInTheDocument());
    await user.click(input);
    await waitFor(() => expect(screen.getAllByRole('option').length).toBeGreaterThanOrEqual(3));
    const options1 = screen.getAllByRole('option').map((el) => el.textContent);
    expect(options1).toContain('gpt-4o');
    expect(options1).toContain('gpt-4o-mini');
    expect(options1).toContain('gpt-3.5-turbo');
  });

  it('filters model list when typing', async () => {
    mockFetch({
      'GET /api/credentials/settings/generation': { temperature: 0.7, maxTokens: 4096 },
      'GET /api/llm/active/models': { models: ['gpt-4o', 'gpt-4o-mini', 'gpt-3.5-turbo'] },
    });
    const user = userEvent.setup();
    render(<ModelSettingsSection activeRuntimeConfig={ACTIVE_RUNTIME_CONFIG} onRuntimeConfigChange={vi.fn()} />);
    const input = screen.getByTestId('model-selector');
    await waitFor(() => expect(input).toBeInTheDocument());
    await user.click(input);
    await waitFor(() => expect(screen.getByRole('option', { name: 'gpt-4o' })).toBeInTheDocument());
    await user.clear(input);
    await user.type(input, 'mini');
    await waitFor(() => {
      const options2 = screen.getAllByRole('option').map((el) => el.textContent);
      expect(options2).not.toContain('gpt-4o');
      expect(options2).toContain('gpt-4o-mini');
    });
  });

  it('gen-save calls PUT /api/credentials/settings/generation with current values', async () => {
    mockFetch({
      'GET /api/credentials/settings/generation': { temperature: 0.7, maxTokens: 4096 },
      'PUT /api/credentials/settings/generation': 204,
      'GET /api/llm/active/models': { models: [] },
    });
    const user = userEvent.setup();
    render(<ModelSettingsSection activeRuntimeConfig={ACTIVE_RUNTIME_CONFIG} onRuntimeConfigChange={vi.fn()} />);
    await waitFor(() => screen.getByTestId('gen-save'));
    await user.click(screen.getByTestId('gen-save'));
    await waitFor(() => {
      const calls = (global.fetch as ReturnType<typeof vi.fn>).mock.calls as [string, RequestInit | undefined][];
      const putCall = calls.find(([url, opts]) =>
        url === '/api/credentials/settings/generation' && opts?.method === 'PUT',
      );
      expect(putCall).toBeDefined();
      const body = JSON.parse((putCall![1]?.body as string) ?? '{}') as { temperature: number; maxTokens: number };
      expect(body.temperature).toBeDefined();
      expect(body.maxTokens).toBeDefined();
    });
  });

  it.each([
    { label: 'temperature is a string', response: { temperature: 'hot', maxTokens: 4096 } },
    { label: 'temperature is null', response: { temperature: null, maxTokens: 4096 } },
  ])('falls back to defaults when $label in generation settings response (REGRESSION)', async ({ response }) => {
    mockFetch({
      'GET /api/credentials/settings/generation': response,
    });

    render(<ModelSettingsSection activeRuntimeConfig={null} onRuntimeConfigChange={vi.fn()} />);

    await waitFor(() => expect(screen.getByTestId('gen-temperature-value')).toHaveTextContent('0.70'));
  });

  it('keeps the last valid temperature when slider emits an empty value (REGRESSION)', async () => {
    mockFetch({
      'GET /api/credentials/settings/generation': { temperature: 0.7, maxTokens: 4096 },
    });

    render(<ModelSettingsSection activeRuntimeConfig={null} onRuntimeConfigChange={vi.fn()} />);

    const slider = await screen.findByTestId('gen-temperature');
    fireEvent.change(slider, { target: { value: '' } });

    expect(screen.getByTestId('gen-temperature-value')).toHaveTextContent('0.70');
  });

  it('keeps the last valid maxTokens when slider emits an empty value (REGRESSION)', async () => {
    mockFetch({
      'GET /api/credentials/settings/generation': { temperature: 0.7, maxTokens: 4096 },
    });

    render(<ModelSettingsSection activeRuntimeConfig={null} onRuntimeConfigChange={vi.fn()} />);

    const slider = await screen.findByTestId('gen-max-tokens');
    fireEvent.change(slider, { target: { value: '' } });

    expect(screen.getByText('4,096')).toBeInTheDocument();
  });

  it('does not serialize empty temperature slider input as null (REGRESSION)', async () => {
    mockFetch({
      'GET /api/credentials/settings/generation': { temperature: 0.7, maxTokens: 4096 },
      'PUT /api/credentials/settings/generation': 204,
    });
    const user = userEvent.setup();

    render(<ModelSettingsSection activeRuntimeConfig={null} onRuntimeConfigChange={vi.fn()} />);

    fireEvent.change(await screen.findByTestId('gen-temperature'), { target: { value: '' } });
    await user.click(screen.getByTestId('gen-save'));

    await waitFor(() => {
      const calls = (global.fetch as ReturnType<typeof vi.fn>).mock.calls as [string, RequestInit | undefined][];
      const putCall = calls.find(([url, opts]) => url === '/api/credentials/settings/generation' && opts?.method === 'PUT');
      expect(putCall).toBeDefined();
      const body = JSON.parse((putCall![1]?.body as string) ?? '{}') as { temperature: number };
      expect(body.temperature).toBe(0.7);
    });
  });

  it('does not serialize empty maxTokens slider input as null (REGRESSION)', async () => {
    mockFetch({
      'GET /api/credentials/settings/generation': { temperature: 0.7, maxTokens: 4096 },
      'PUT /api/credentials/settings/generation': 204,
    });
    const user = userEvent.setup();

    render(<ModelSettingsSection activeRuntimeConfig={null} onRuntimeConfigChange={vi.fn()} />);

    fireEvent.change(await screen.findByTestId('gen-max-tokens'), { target: { value: '' } });
    await user.click(screen.getByTestId('gen-save'));

    await waitFor(() => {
      const calls = (global.fetch as ReturnType<typeof vi.fn>).mock.calls as [string, RequestInit | undefined][];
      const putCall = calls.find(([url, opts]) => url === '/api/credentials/settings/generation' && opts?.method === 'PUT');
      expect(putCall).toBeDefined();
      const body = JSON.parse((putCall![1]?.body as string) ?? '{}') as { maxTokens: number };
      expect(body.maxTokens).toBe(4096);
    });
  });
});
