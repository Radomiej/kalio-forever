import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ModelSettingsSection } from './ModelSettingsSection';
import type { Credential } from '@kalio/types';

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

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('ModelSettingsSection', () => {
  it('shows "activate a provider" message when no active credential', async () => {
    mockFetch({
      'GET /api/credentials/settings/generation': { temperature: 0.7, maxTokens: 4096 },
    });
    render(<ModelSettingsSection activeCredential={null} onModelChange={vi.fn()} />);
    await waitFor(() => expect(screen.getByText(/activate a provider/i)).toBeInTheDocument());
  });

  it('fetches and displays generation settings', async () => {
    mockFetch({
      'GET /api/credentials/settings/generation': { temperature: 1.2, maxTokens: 8192 },
      [`GET /api/credentials/${CRED.id}/models`]: { models: ['gpt-4o', 'gpt-4o-mini'] },
    });
    render(<ModelSettingsSection activeCredential={CRED} onModelChange={vi.fn()} />);
    await waitFor(() => expect(screen.getByTestId('gen-temperature-value')).toHaveTextContent('1.20'));
  });

  it('populates model dropdown from GET /api/credentials/:id/models', async () => {
    mockFetch({
      'GET /api/credentials/settings/generation': { temperature: 0.7, maxTokens: 4096 },
      [`GET /api/credentials/${CRED.id}/models`]: { models: ['gpt-4o', 'gpt-4o-mini', 'gpt-3.5-turbo'] },
    });
    const user = userEvent.setup();
    render(<ModelSettingsSection activeCredential={CRED} onModelChange={vi.fn()} />);
    const input = screen.getByTestId('model-selector');
    await waitFor(() => expect(input).toBeInTheDocument());
    await user.click(input);
    await waitFor(() => expect(screen.getByText('gpt-4o')).toBeInTheDocument());
    expect(screen.getByText('gpt-4o-mini')).toBeInTheDocument();
    expect(screen.getByText('gpt-3.5-turbo')).toBeInTheDocument();
  });

  it('filters model list when typing', async () => {
    mockFetch({
      'GET /api/credentials/settings/generation': { temperature: 0.7, maxTokens: 4096 },
      [`GET /api/credentials/${CRED.id}/models`]: { models: ['gpt-4o', 'gpt-4o-mini', 'gpt-3.5-turbo'] },
    });
    const user = userEvent.setup();
    render(<ModelSettingsSection activeCredential={CRED} onModelChange={vi.fn()} />);
    const input = screen.getByTestId('model-selector');
    await waitFor(() => expect(input).toBeInTheDocument());
    await user.click(input);
    await waitFor(() => expect(screen.getByText('gpt-4o')).toBeInTheDocument());
    await user.type(input, 'mini');
    expect(screen.queryByText('gpt-4o')).not.toBeInTheDocument();
    expect(screen.getByText('gpt-4o-mini')).toBeInTheDocument();
  });

  it('gen-save calls PUT /api/credentials/settings/generation with current values', async () => {
    mockFetch({
      'GET /api/credentials/settings/generation': { temperature: 0.7, maxTokens: 4096 },
      'PUT /api/credentials/settings/generation': 204,
      [`GET /api/credentials/${CRED.id}/models`]: { models: [] },
    });
    const user = userEvent.setup();
    render(<ModelSettingsSection activeCredential={CRED} onModelChange={vi.fn()} />);
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
});
