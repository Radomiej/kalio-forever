import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, act, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LLMPanel } from './LLMPanel';
import type { Credential } from '@kalio/types';

// ── Store mock ─────────────────────────────────────────────────────────────────
vi.mock('./settingsStore', () => ({
  useSettingsStore: (selector: (s: { setBackendConfig: ReturnType<typeof vi.fn> }) => unknown) =>
    selector({ setBackendConfig: vi.fn() }),
}));

// ── Helpers ────────────────────────────────────────────────────────────────────
const CRED: Credential = {
  id: 'c1',
  name: 'My OpenAI',
  provider: 'openai',
  model: 'gpt-4o-mini',
  createdAt: '2024-01-01T00:00:00Z',
};

type FetchMap = Record<string, unknown>;

/**
 * Replaces global.fetch with a mock that dispatches by `${METHOD} ${url}`.
 * Callers can provide a map like: { 'GET /api/credentials': [...], 'POST /api/credentials': {...} }
 * A status-204 entry means the response will be 204 No Content.
 */
function mockFetch(map: FetchMap) {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, opts?: RequestInit) => {
      const method = opts?.method?.toUpperCase() ?? 'GET';
      const key = `${method} ${url}`;
      const value = key in map ? map[key] : map[url] ?? null;

      if (value === null) {
        return Promise.resolve(new Response(null, { status: 404 }));
      }
      if (value === 204) {
        return Promise.resolve(new Response(null, { status: 204 }));
      }
      return Promise.resolve(
        new Response(JSON.stringify(value), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );
    }),
  );
}

function defaultMap(opts: {
  credentials?: Credential[];
  activeId?: string | null;
  contextWindow?: number;
} = {}): FetchMap {
  return {
    'GET /api/credentials': opts.credentials ?? [],
    'GET /api/credentials/active': { credentialId: opts.activeId ?? null },
    'GET /api/credentials/settings/context-window': { size: opts.contextWindow ?? 32000 },
    'GET /api/llm/config': { provider: 'openai', model: 'gpt-4o-mini', baseUrl: 'https://api.openai.com/v1', contextWindowSize: 32000 },
  };
}

beforeEach(() => {
  vi.restoreAllMocks();
});

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('LLMPanel', () => {
  it('shows loading spinner initially', () => {
    // Never resolves so loading stays visible
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})));
    render(<LLMPanel />);
    expect(screen.getByText(/loading credentials/i)).toBeInTheDocument();
  });

  it('renders empty state when no credentials', async () => {
    mockFetch(defaultMap());
    render(<LLMPanel />);
    await waitFor(() =>
      expect(screen.getByText(/no credentials configured/i)).toBeInTheDocument(),
    );
  });

  it('renders credential rows after load', async () => {
    mockFetch(defaultMap({ credentials: [CRED] }));
    render(<LLMPanel />);
    await waitFor(() =>
      expect(screen.getByTestId(`provider-row-${CRED.id}`)).toBeInTheDocument(),
    );
    expect(screen.getByText('My OpenAI')).toBeInTheDocument();
  });

  it('shows active badge on the active credential', async () => {
    mockFetch(defaultMap({ credentials: [CRED], activeId: CRED.id }));
    render(<LLMPanel />);
    await waitFor(() => expect(screen.getByText('active')).toBeInTheDocument());
  });

  it('opens add-provider form on button click', async () => {
    mockFetch(defaultMap());
    const user = userEvent.setup();
    render(<LLMPanel />);
    await waitFor(() => screen.getByTestId('add-provider-btn'));
    await user.click(screen.getByTestId('add-provider-btn'));
    expect(screen.getByTestId('add-provider-form')).toBeInTheDocument();
  });

  it('changing provider type pre-fills base URL and model', async () => {
    mockFetch(defaultMap());
    const user = userEvent.setup();
    render(<LLMPanel />);
    await waitFor(() => screen.getByTestId('add-provider-btn'));
    await user.click(screen.getByTestId('add-provider-btn'));

    // switch to DeepSeek
    await user.click(screen.getByRole('button', { name: 'DeepSeek' }));
    const modelInput = screen.getByTestId('add-provider-model') as HTMLInputElement;
    expect(modelInput.value).toBe('deepseek-reasoner');
  });

  it('test button is disabled when API key is empty', async () => {
    mockFetch(defaultMap());
    const user = userEvent.setup();
    render(<LLMPanel />);
    await waitFor(() => screen.getByTestId('add-provider-btn'));
    await user.click(screen.getByTestId('add-provider-btn'));
    expect(screen.getByTestId('add-provider-test')).toBeDisabled();
  });

  it('test button shows "Connected!" on successful test', async () => {
    const map = {
      ...defaultMap(),
      'POST /api/credentials/test': { ok: true, latencyMs: 42 },
    };
    mockFetch(map);
    const user = userEvent.setup();
    render(<LLMPanel />);
    await waitFor(() => screen.getByTestId('add-provider-btn'));
    await user.click(screen.getByTestId('add-provider-btn'));
    await user.type(screen.getByTestId('add-provider-apikey'), 'sk-test-key');
    await user.click(screen.getByTestId('add-provider-test'));
    await waitFor(() => expect(screen.getByTestId('add-provider-test')).toHaveTextContent('Connected!'));
  });

  it('test button shows "Failed" on unsuccessful test', async () => {
    const map = {
      ...defaultMap(),
      'POST /api/credentials/test': { ok: false, latencyMs: 0, error: 'Invalid key' },
    };
    mockFetch(map);
    const user = userEvent.setup();
    render(<LLMPanel />);
    await waitFor(() => screen.getByTestId('add-provider-btn'));
    await user.click(screen.getByTestId('add-provider-btn'));
    await user.type(screen.getByTestId('add-provider-apikey'), 'bad-key');
    await user.click(screen.getByTestId('add-provider-test'));
    await waitFor(() => expect(screen.getByTestId('add-provider-test')).toHaveTextContent('Failed'));
    expect(screen.getByText('Invalid key')).toBeInTheDocument();
  });

  it('submitting add form adds the credential to the list', async () => {
    const created: Credential = { ...CRED, id: 'c-new', name: 'New Key' };
    const map = {
      ...defaultMap(),
      'POST /api/credentials': created,
    };
    mockFetch(map);
    const user = userEvent.setup();
    render(<LLMPanel />);
    await waitFor(() => screen.getByTestId('add-provider-btn'));
    await user.click(screen.getByTestId('add-provider-btn'));
    await user.type(screen.getByRole('textbox', { name: /name/i }), 'New Key');
    await user.type(screen.getByTestId('add-provider-apikey'), 'sk-test');
    await user.click(screen.getByTestId('add-provider-submit'));
    await waitFor(() => expect(screen.getByTestId(`provider-row-${created.id}`)).toBeInTheDocument());
    // form should be hidden after submit
    expect(screen.queryByTestId('add-provider-form')).not.toBeInTheDocument();
  });

  it('clicking activate calls PUT and shows active badge', async () => {
    const map = {
      ...defaultMap({ credentials: [CRED], activeId: null }),
      [`PUT /api/credentials/active/${CRED.id}`]: 204 as const,
      'GET /api/llm/config': { provider: 'openai', model: 'gpt-4o-mini', baseUrl: '', contextWindowSize: 32000 },
    };
    mockFetch(map);
    const user = userEvent.setup();
    render(<LLMPanel />);
    await waitFor(() => screen.getByTestId(`provider-row-${CRED.id}`));
    const row = screen.getByTestId(`provider-row-${CRED.id}`);
    const activateBtn = row.querySelector('button')!;
    await user.click(activateBtn);
    await waitFor(() => expect(screen.getByText('active')).toBeInTheDocument());
  });

  it('clicking delete removes the credential row', async () => {
    const map = {
      ...defaultMap({ credentials: [CRED] }),
      [`DELETE /api/credentials/${CRED.id}`]: 204 as const,
    };
    mockFetch(map);
    const user = userEvent.setup();
    render(<LLMPanel />);
    await waitFor(() => screen.getByTestId(`provider-row-${CRED.id}`));
    const row = screen.getByTestId(`provider-row-${CRED.id}`);
    const deleteBtn = row.querySelectorAll('button')[1]!;
    await user.click(deleteBtn);
    await waitFor(() =>
      expect(screen.queryByTestId(`provider-row-${CRED.id}`)).not.toBeInTheDocument(),
    );
  });

  it('context window slider is rendered with correct initial value', async () => {
    mockFetch(defaultMap({ contextWindow: 64000 }));
    render(<LLMPanel />);
    await waitFor(() =>
      expect(screen.getByTestId('context-window-slider')).toBeInTheDocument(),
    );
    const slider = screen.getByTestId('context-window-slider') as HTMLInputElement;
    expect(slider.value).toBe('64000');
    expect(screen.getByTestId('context-window-value')).toHaveTextContent('64k');
  });

  it('context window badge updates on slider change', async () => {
    const map = {
      ...defaultMap(),
      'PUT /api/credentials/settings/context-window': 204 as const,
    };
    mockFetch(map);
    const user = userEvent.setup();
    render(<LLMPanel />);
    await waitFor(() => screen.getByTestId('context-window-slider'));
    const slider = screen.getByTestId('context-window-slider');
    fireEvent.change(slider, { target: { value: '128000' } });
    await waitFor(() =>
      expect(screen.getByTestId('context-window-value')).toHaveTextContent('128k'),
    );
  });

  it('shows error banner when initial load fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response('Server error', { status: 500 }))),
    );
    render(<LLMPanel />);
    await waitFor(() =>
      expect(screen.getByText(/500: Server error/i)).toBeInTheDocument(),
    );
  });
});
