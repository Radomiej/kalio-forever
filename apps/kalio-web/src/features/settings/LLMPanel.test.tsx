import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LLMPanel } from './LLMPanel';
import type { Credential } from '@kalio/types';

// ── Store mock ─────────────────────────────────────────────────────────────────
const mockSetBackendConfig = vi.hoisted(() => vi.fn());
vi.mock('./settingsStore', () => ({
  useSettingsStore: (selector: (s: { setBackendConfig: typeof mockSetBackendConfig }) => unknown) =>
    selector({ setBackendConfig: mockSetBackendConfig }),
}));

// ── Helpers ────────────────────────────────────────────────────────────────────
const CRED: Credential = {
  id: 'c1',
  name: 'My OpenAI',
  provider: 'openai',
  model: 'gpt-4o-mini',
  createdAt: 1704067200000,
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
      const urlWithoutParams = url.split('?')[0]!;
      const key = `${method} ${url}`;
      const keyNoParams = `${method} ${urlWithoutParams}`;
      const value = key in map ? map[key] : (keyNoParams in map ? map[keyNoParams] : (map[url] ?? map[urlWithoutParams] ?? null));

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
  maxToolAttempts?: number;
  webSearchTimeoutMs?: number;
  providerLocalTimeoutMs?: number;
  providerRemoteTimeoutMs?: number;
} = {}): FetchMap {
  return {
    'GET /api/credentials': opts.credentials ?? [],
    'GET /api/credentials/active': { credentialId: opts.activeId ?? null },
    'GET /api/credentials/settings/context-window': { size: opts.contextWindow ?? 32000 },
    'GET /api/credentials/settings/tool-timeouts': {
      webSearchTimeoutMs: opts.webSearchTimeoutMs ?? 120000,
      providerLocalTimeoutMs: opts.providerLocalTimeoutMs ?? 3000,
      providerRemoteTimeoutMs: opts.providerRemoteTimeoutMs ?? 15000,
    },
    'GET /api/llm/config': {
      provider: 'openai',
      model: 'gpt-4o-mini',
      baseUrl: 'https://api.openai.com/v1',
      contextWindowSize: 32000,
      maxToolAttempts: opts.maxToolAttempts ?? 8,
    },
  };
}

beforeEach(() => {
  vi.restoreAllMocks();
});

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('LLMPanel', () => {
  it('renders a generic LLM settings heading', async () => {
    mockFetch(defaultMap());
    render(<LLMPanel />);
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'LLM Settings' })).toBeInTheDocument(),
    );
  });

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

  it('pre-fills name with provider label and updates on provider change', async () => {
    mockFetch(defaultMap());
    const user = userEvent.setup();
    render(<LLMPanel />);
    await waitFor(() => screen.getByTestId('add-provider-btn'));
    await user.click(screen.getByTestId('add-provider-btn'));

    const nameInput = screen.getByRole('textbox', { name: /name/i }) as HTMLInputElement;
    expect(nameInput.value).toBe('OpenAI');

    await user.click(screen.getByRole('button', { name: 'DeepSeek' }));
    expect(nameInput.value).toBe('DeepSeek');

    // user types custom name — provider switch should not overwrite it
    await user.clear(nameInput);
    await user.type(nameInput, 'Custom');
    await user.click(screen.getByRole('button', { name: 'OpenRouter' }));
    expect(nameInput.value).toBe('Custom');
  });

  it('supports bitnet in the add-provider form', async () => {
    mockFetch(defaultMap());
    const user = userEvent.setup();
    render(<LLMPanel />);

    await waitFor(() => screen.getByTestId('add-provider-btn'));
    await user.click(screen.getByTestId('add-provider-btn'));
    await user.click(screen.getByRole('button', { name: 'BitNet' }));

    const nameInput = screen.getByRole('textbox', { name: /name/i }) as HTMLInputElement;
    const modelInput = screen.getByTestId('add-provider-model') as HTMLInputElement;
    const baseUrlInput = screen.getByRole('textbox', { name: /base url/i }) as HTMLInputElement;

    expect(nameInput.value).toBe('BitNet');
    expect(modelInput.value).toBe('bitnet-b1.58-2b-4t');
    expect(baseUrlInput.value).toBe('http://localhost:8080/v1');
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
      'GET /api/llm/models': { data: [{ id: 'm1' }, { id: 'm2' }] },
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
    // No mock for /api/llm/models → 404 response → test fails
    mockFetch(defaultMap());
    const user = userEvent.setup();
    render(<LLMPanel />);
    await waitFor(() => screen.getByTestId('add-provider-btn'));
    await user.click(screen.getByTestId('add-provider-btn'));
    await user.type(screen.getByTestId('add-provider-apikey'), 'bad-key');
    await user.click(screen.getByTestId('add-provider-test'));
    await waitFor(() => expect(screen.getByTestId('add-provider-test')).toHaveTextContent('Failed'));
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
    const nameInput = screen.getByRole('textbox', { name: /name/i });
    await user.clear(nameInput);
    await user.type(nameInput, 'New Key');
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
      'GET /api/llm/config': { provider: 'openai', model: 'gpt-4o-mini', baseUrl: '', contextWindowSize: 32000, maxToolAttempts: 8 },
    };
    mockFetch(map);
    const user = userEvent.setup();
    render(<LLMPanel />);
    await waitFor(() => screen.getByTestId(`provider-activate-${CRED.id}`));
    await user.click(screen.getByTestId(`provider-activate-${CRED.id}`));
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
    await waitFor(() => screen.getByTestId(`provider-remove-${CRED.id}`));
    await user.click(screen.getByTestId(`provider-remove-${CRED.id}`));
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
    render(<LLMPanel />);
    await waitFor(() => screen.getByTestId('context-window-slider'));
    const slider = screen.getByTestId('context-window-slider');
    fireEvent.change(slider, { target: { value: '128000' } });
    await waitFor(() =>
      expect(screen.getByTestId('context-window-value')).toHaveTextContent('128k'),
    );
  });

  it('max tool attempts badge updates on slider change', async () => {
    const map = {
      ...defaultMap(),
      'PUT /api/credentials/settings/max-tool-attempts': 204 as const,
    };
    mockFetch(map);
    render(<LLMPanel />);
    await waitFor(() => screen.getByTestId('max-tool-attempts-slider'));
    const slider = screen.getByTestId('max-tool-attempts-slider');
    fireEvent.change(slider, { target: { value: '25' } });
    await waitFor(() =>
      expect(screen.getByTestId('max-tool-attempts-value')).toHaveTextContent('25'),
    );
  });

  it('renders tool timeout controls with backend values', async () => {
    mockFetch(defaultMap({
      webSearchTimeoutMs: 180000,
      providerLocalTimeoutMs: 5000,
      providerRemoteTimeoutMs: 45000,
    }));
    render(<LLMPanel />);

    await waitFor(() => expect(screen.getByTestId('web-search-timeout-slider')).toBeInTheDocument());

    expect((screen.getByTestId('web-search-timeout-slider') as HTMLInputElement).value).toBe('180000');
    expect((screen.getByTestId('provider-local-timeout-slider') as HTMLInputElement).value).toBe('5000');
    expect((screen.getByTestId('provider-remote-timeout-slider') as HTMLInputElement).value).toBe('45000');
  });

  it('updates web search timeout badge on slider change', async () => {
    const map = {
      ...defaultMap(),
      'PUT /api/credentials/settings/tool-timeouts': 204 as const,
    };
    mockFetch(map);
    render(<LLMPanel />);

    await waitFor(() => screen.getByTestId('web-search-timeout-slider'));
    fireEvent.change(screen.getByTestId('web-search-timeout-slider'), { target: { value: '180000' } });

    await waitFor(() => expect(screen.getByTestId('web-search-timeout-value')).toHaveTextContent('180s'));
  });

  it('does not persist tool timeout slider until release', async () => {
    const map = {
      ...defaultMap(),
      'PUT /api/credentials/settings/tool-timeouts': 204 as const,
    };
    mockFetch(map);
    render(<LLMPanel />);

    await waitFor(() => screen.getByTestId('web-search-timeout-slider'));
    const slider = screen.getByTestId('web-search-timeout-slider');
    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>;

    fireEvent.change(slider, { target: { value: '180000' } });

    expect(screen.getByTestId('web-search-timeout-value')).toHaveTextContent('180s');
    expect(
      fetchMock.mock.calls.some(([url, opts]) => url === '/api/credentials/settings/tool-timeouts' && (opts as RequestInit | undefined)?.method === 'PUT'),
    ).toBe(false);

    fireEvent.mouseUp(slider);

    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(([url, opts]) => url === '/api/credentials/settings/tool-timeouts' && (opts as RequestInit | undefined)?.method === 'PUT'),
      ).toBe(true),
    );
  });

  it('shows an error and restores the previous timeout when save fails', async () => {
    mockFetch(defaultMap());
    render(<LLMPanel />);

    await waitFor(() => screen.getByTestId('web-search-timeout-slider'));
    const slider = screen.getByTestId('web-search-timeout-slider');

    fireEvent.change(slider, { target: { value: '180000' } });
    fireEvent.mouseUp(slider);

    await waitFor(() => expect(screen.getByText(/failed to update tool timeout/i)).toBeInTheDocument());
    expect(screen.getByTestId('web-search-timeout-value')).toHaveTextContent('120s');
    expect((screen.getByTestId('web-search-timeout-slider') as HTMLInputElement).value).toBe('120000');
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
