import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { EmbeddingCredential, EmbeddingStatus } from '@kalio/types';
import { EmbeddingsPanel } from './EmbeddingsPanel';

type MockReply = Error | unknown;

function installFetchQueue(routes: Record<string, MockReply[]>): ReturnType<typeof vi.fn> {
  const queues = new Map(Object.entries(routes));
  const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const method = init?.method?.toUpperCase() ?? 'GET';
    const key = `${method} ${url}`;
    const queue = queues.get(key);

    if (!queue || queue.length === 0) {
      throw new Error(`Unexpected fetch: ${key}`);
    }

    const reply = queue.shift();
    if (reply instanceof Error) throw reply;

    return new Response(JSON.stringify(reply), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  });

  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const LOCAL_STATUS: EmbeddingStatus = {
  provider: 'local-transformers',
  source: 'local',
  model: 'Xenova/multilingual-e5-small',
  dimensions: 384,
  baseUrlMasked: '(local cache)',
  configured: true,
  backend: 'cpu',
  cacheDir: './data/embeddings-cache',
  profileId: 'local-transformers-xenova-multilingual-e5-small-384-cpu',
};

describe('EmbeddingsPanel', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('renders local embedding status and saves local settings as cpu', async () => {
    const user = userEvent.setup();
    const fetchMock = installFetchQueue({
      'GET /api/memory/embedding-credentials': [[]],
      'GET /api/memory/status/embedding': [LOCAL_STATUS],
      'GET /api/memory/embedding-local': [{ enabled: true, model: 'Xenova/multilingual-e5-small', dimensions: 384, backend: 'cpu' }],
      'POST /api/memory/embedding-local/availability': [{ status: 'ready', installed: true, model: 'Xenova/multilingual-e5-small', dimensions: 384, backend: 'cpu', message: 'Model installed and ready.' }, { status: 'missing', installed: false, model: 'Xenova/paraphrase-multilingual-MiniLM-L12-v2', dimensions: 384, backend: 'cpu', message: 'Model not installed yet.' }],
      'PUT /api/memory/embedding-local': [{ ...LOCAL_STATUS, backend: 'cpu', profileId: 'local-transformers-xenova-multilingual-e5-small-384-cpu' }],
    });

    render(<EmbeddingsPanel />);

    expect(await screen.findByText('Local embeddings')).toBeInTheDocument();
    expect(screen.getByTestId('embedding-local-model')).toHaveValue('Xenova/multilingual-e5-small');
    expect(screen.queryByText('GPU unavailable on this machine; CPU will be used.')).not.toBeInTheDocument();

    await user.selectOptions(screen.getByTestId('embedding-local-model'), 'Xenova/paraphrase-multilingual-MiniLM-L12-v2');
    await user.click(screen.getByTestId('embedding-local-save'));

    await waitFor(() => {
      const call = fetchMock.mock.calls.find(([url, init]) => url === '/api/memory/embedding-local' && init?.method === 'PUT');
      expect(call).toBeDefined();
      expect(JSON.parse(String(call?.[1]?.body))).toMatchObject({
        enabled: true,
        model: 'Xenova/paraphrase-multilingual-MiniLM-L12-v2',
        dimensions: 384,
        backend: 'cpu',
      });
    });
  });

  it('does not render per-persona reindex controls for local embeddings', async () => {
    installFetchQueue({
      'GET /api/memory/embedding-credentials': [[]],
      'GET /api/memory/status/embedding': [LOCAL_STATUS],
      'GET /api/memory/embedding-local': [{ enabled: true, model: 'Xenova/multilingual-e5-small', dimensions: 384, backend: 'cpu' }],
      'POST /api/memory/embedding-local/availability': [{ status: 'ready', installed: true, model: 'Xenova/multilingual-e5-small', dimensions: 384, backend: 'cpu', message: 'Model installed and ready.' }],
    });

    render(<EmbeddingsPanel />);

    expect(await screen.findByTestId('embedding-reindex-all-btn')).toBeInTheDocument();
    expect(screen.queryByTestId('embedding-reindex-persona')).not.toBeInTheDocument();
    expect(screen.queryByTestId('embedding-reindex-btn')).not.toBeInTheDocument();
  });

  it('can disable local embeddings', async () => {
    const user = userEvent.setup();
    const disabledStatus: EmbeddingStatus = {
      ...LOCAL_STATUS,
      provider: 'disabled',
      source: 'disabled',
      configured: false,
    };
    const fetchMock = installFetchQueue({
      'GET /api/memory/embedding-credentials': [[]],
      'GET /api/memory/status/embedding': [LOCAL_STATUS],
      'GET /api/memory/embedding-local': [{ enabled: true, model: 'Xenova/multilingual-e5-small', dimensions: 384, backend: 'cpu' }],
      'POST /api/memory/embedding-local/availability': [{ status: 'ready', installed: true, model: 'Xenova/multilingual-e5-small', dimensions: 384, backend: 'cpu', message: 'Model installed and ready.' }],
      'PUT /api/memory/embedding-local': [disabledStatus],
    });

    render(<EmbeddingsPanel />);

    await user.click(await screen.findByTestId('embedding-local-enabled'));
    await user.click(screen.getByTestId('embedding-local-save'));

    await waitFor(() => {
      const call = fetchMock.mock.calls.find(([url, init]) => url === '/api/memory/embedding-local' && init?.method === 'PUT');
      expect(call).toBeDefined();
      expect(JSON.parse(String(call?.[1]?.body))).toMatchObject({ enabled: false });
      expect(screen.getByText('disabled')).toBeInTheDocument();
    });
  });

  it('keeps a custom provider name while updating provider defaults', async () => {
    const user = userEvent.setup();

    installFetchQueue({
      'GET /api/memory/embedding-credentials': [[]],
      'GET /api/memory/status/embedding': [LOCAL_STATUS],
      'GET /api/memory/embedding-local': [{ enabled: true, model: 'Xenova/multilingual-e5-small', dimensions: 384, backend: 'cpu' }],
      'POST /api/memory/embedding-local/availability': [{ status: 'ready', installed: true, model: 'Xenova/multilingual-e5-small', dimensions: 384, backend: 'cpu', message: 'Model installed and ready.' }],
    });

    render(<EmbeddingsPanel />);

    await user.click(await screen.findByTestId('add-embedding-provider-btn'));

    const nameInput = screen.getByLabelText('Name');
    expect(nameInput).toHaveValue('OpenAI');
    expect(screen.getByLabelText('API Key')).toBeRequired();

    await user.clear(nameInput);
    await user.type(nameInput, 'Corp embeddings');
    await user.click(screen.getByRole('button', { name: 'Ollama' }));

    expect(nameInput).toHaveValue('Corp embeddings');
    expect(screen.getByLabelText('API Key')).not.toBeRequired();
    expect(screen.getByDisplayValue('http://localhost:11434')).toBeInTheDocument();
    expect(screen.getByDisplayValue('nomic-embed-text')).toBeInTheDocument();
    expect(screen.getByDisplayValue('768')).toBeInTheDocument();
  });

  it('can request reindex for all indexed personas', async () => {
    const user = userEvent.setup();
    const fetchMock = installFetchQueue({
      'GET /api/memory/embedding-credentials': [[]],
      'GET /api/memory/status/embedding': [LOCAL_STATUS],
      'GET /api/memory/embedding-local': [{ enabled: true, model: 'Xenova/multilingual-e5-small', dimensions: 384, backend: 'cpu' }],
      'POST /api/memory/embedding-local/availability': [{ status: 'ready', installed: true, model: 'Xenova/multilingual-e5-small', dimensions: 384, backend: 'cpu', message: 'Model installed and ready.' }],
      'POST /api/memory/reembed-all': [{ personas: 2, count: 7, model: 'Xenova/multilingual-e5-small' }],
    });

    render(<EmbeddingsPanel />);

    await user.click(await screen.findByTestId('embedding-reindex-all-btn'));

    await waitFor(() => {
      expect(fetchMock.mock.calls.some(([url, init]) => url === '/api/memory/reembed-all' && init?.method === 'POST')).toBe(true);
      expect(screen.getByText('Reindexed 7 memories across 2 personas')).toBeInTheDocument();
    });
  });

  it('auto-saves dirty local config before activating local embeddings', async () => {
    const user = userEvent.setup();
    const remoteStatus: EmbeddingStatus = {
      ...LOCAL_STATUS,
      provider: 'openai-compatible',
      source: 'db',
      activeCredentialId: 'cred-1',
      activeCredentialName: 'Remote',
      model: 'text-embedding-3-small',
      dimensions: 1536,
    };
    const updatedLocalStatus: EmbeddingStatus = {
      ...LOCAL_STATUS,
      model: 'Xenova/paraphrase-multilingual-MiniLM-L12-v2',
      dimensions: 384,
    };
    const fetchMock = installFetchQueue({
      'GET /api/memory/embedding-credentials': [[{
        id: 'cred-1',
        name: 'Remote',
        provider: 'openai',
        baseUrl: 'https://api.openai.com/v1',
        model: 'text-embedding-3-small',
        dimensions: 1536,
        createdAt: Date.now(),
      }]],
      'GET /api/memory/status/embedding': [remoteStatus],
      'GET /api/memory/embedding-local': [{ enabled: true, model: 'Xenova/multilingual-e5-small', dimensions: 384, backend: 'cpu' }],
      'POST /api/memory/embedding-local/availability': [
        { status: 'ready', installed: true, model: 'Xenova/paraphrase-multilingual-MiniLM-L12-v2', dimensions: 384, backend: 'cpu', message: 'Model installed and ready.' },
        { status: 'ready', installed: true, model: 'Xenova/paraphrase-multilingual-MiniLM-L12-v2', dimensions: 384, backend: 'cpu', message: 'Model installed and ready.' },
        { status: 'ready', installed: true, model: 'Xenova/paraphrase-multilingual-MiniLM-L12-v2', dimensions: 384, backend: 'cpu', message: 'Model installed and ready.' },
      ],
      'PUT /api/memory/embedding-local': [updatedLocalStatus],
      'DELETE /api/memory/embedding-credentials/active': [LOCAL_STATUS],
    });

    render(<EmbeddingsPanel />);

    await user.selectOptions(await screen.findByTestId('embedding-local-model'), 'Xenova/paraphrase-multilingual-MiniLM-L12-v2');
    await user.click(screen.getByTestId('embedding-use-local-btn'));

    await waitFor(() => {
      const putCall = fetchMock.mock.calls.find(([url, init]) => url === '/api/memory/embedding-local' && init?.method === 'PUT');
      const deleteCall = fetchMock.mock.calls.find(([url, init]) => url === '/api/memory/embedding-credentials/active' && init?.method === 'DELETE');
      expect(putCall).toBeDefined();
      expect(deleteCall).toBeDefined();
      expect(fetchMock.mock.calls.indexOf(putCall!)).toBeLessThan(fetchMock.mock.calls.indexOf(deleteCall!));
      expect(JSON.parse(String(putCall?.[1]?.body))).toMatchObject({
        model: 'Xenova/paraphrase-multilingual-MiniLM-L12-v2',
        dimensions: 384,
      });
    });
  });

  it('can switch from a remote provider back to local embeddings', async () => {
    const user = userEvent.setup();
    const remoteStatus: EmbeddingStatus = {
      ...LOCAL_STATUS,
      provider: 'openai-compatible',
      source: 'db',
      activeCredentialId: 'cred-1',
      activeCredentialName: 'Remote',
      model: 'text-embedding-3-small',
      dimensions: 1536,
    };
    const fetchMock = installFetchQueue({
      'GET /api/memory/embedding-credentials': [[{
        id: 'cred-1',
        name: 'Remote',
        provider: 'openai',
        baseUrl: 'https://api.openai.com/v1',
        model: 'text-embedding-3-small',
        dimensions: 1536,
        createdAt: Date.now(),
      }]],
      'GET /api/memory/status/embedding': [remoteStatus],
      'GET /api/memory/embedding-local': [{ enabled: true, model: 'Xenova/paraphrase-multilingual-MiniLM-L12-v2', dimensions: 384, backend: 'cpu' }],
      'POST /api/memory/embedding-local/availability': [
        { status: 'ready', installed: true, model: 'Xenova/paraphrase-multilingual-MiniLM-L12-v2', dimensions: 384, backend: 'cpu', message: 'Model installed and ready.' },
        { status: 'ready', installed: true, model: 'Xenova/paraphrase-multilingual-MiniLM-L12-v2', dimensions: 384, backend: 'cpu', message: 'Model installed and ready.' },
      ],
      'DELETE /api/memory/embedding-credentials/active': [LOCAL_STATUS],
    });

    render(<EmbeddingsPanel />);

    await user.click(await screen.findByTestId('embedding-use-local-btn'));

    await waitFor(() => {
      expect(fetchMock.mock.calls.some(([url, init]) => url === '/api/memory/embedding-credentials/active' && init?.method === 'DELETE')).toBe(true);
    });
  });

  it('blocks switching from a remote provider back to local embeddings when the local model is missing', async () => {
    const remoteStatus: EmbeddingStatus = {
      ...LOCAL_STATUS,
      provider: 'openai-compatible',
      source: 'db',
      activeCredentialId: 'cred-1',
      activeCredentialName: 'Remote',
      model: 'text-embedding-3-small',
      dimensions: 1536,
    };
    const fetchMock = installFetchQueue({
      'GET /api/memory/embedding-credentials': [[{
        id: 'cred-1',
        name: 'Remote',
        provider: 'openai',
        baseUrl: 'https://api.openai.com/v1',
        model: 'text-embedding-3-small',
        dimensions: 1536,
        createdAt: Date.now(),
      }]],
      'GET /api/memory/status/embedding': [remoteStatus],
      'GET /api/memory/embedding-local': [{ enabled: true, model: 'Xenova/paraphrase-multilingual-MiniLM-L12-v2', dimensions: 384, backend: 'cpu' }],
      'POST /api/memory/embedding-local/availability': [{ status: 'missing', installed: false, model: 'Xenova/paraphrase-multilingual-MiniLM-L12-v2', dimensions: 384, backend: 'cpu', message: 'Model not installed yet.' }],
    });

    render(<EmbeddingsPanel />);

    expect(await screen.findByTestId('embedding-use-local-btn')).toBeDisabled();
    expect(fetchMock.mock.calls.some(([url, init]) => url === '/api/memory/embedding-credentials/active' && init?.method === 'DELETE')).toBe(false);
  });

  it('can configure, probe, and add an Ollama embedding provider without an API key', async () => {
    const user = userEvent.setup();
    const createdCredential: EmbeddingCredential = {
      id: 'cred-ollama',
      name: 'Ollama',
      provider: 'ollama',
      baseUrl: 'http://localhost:11434',
      model: 'nomic-embed-text',
      dimensions: 768,
      createdAt: 1704067200000,
    };
    const fetchMock = installFetchQueue({
      'GET /api/memory/embedding-credentials': [[]],
      'GET /api/memory/status/embedding': [LOCAL_STATUS],
      'GET /api/memory/embedding-local': [{ enabled: true, model: 'Xenova/multilingual-e5-small', dimensions: 384, backend: 'cpu' }],
      'POST /api/memory/embedding-local/availability': [{ status: 'ready', installed: true, model: 'Xenova/multilingual-e5-small', dimensions: 384, backend: 'cpu', message: 'Model installed and ready.' }],
      'POST /api/memory/embedding-credentials/probe': [{ ok: true }],
      'POST /api/memory/embedding-credentials': [createdCredential],
    });

    render(<EmbeddingsPanel />);

    await user.click(await screen.findByTestId('add-embedding-provider-btn'));
    await user.click(screen.getByRole('button', { name: 'Ollama' }));

    expect(screen.getByLabelText('API Key')).not.toBeRequired();
    expect(screen.getByDisplayValue('http://localhost:11434')).toBeInTheDocument();
    expect(screen.getByDisplayValue('nomic-embed-text')).toBeInTheDocument();
    expect(screen.getByDisplayValue('768')).toBeInTheDocument();

    await user.click(screen.getByTestId('add-form-test-btn'));

    await waitFor(() => expect(screen.getByTestId('add-form-test-btn')).toHaveTextContent('OK!'));

    await user.click(screen.getByTestId('embedding-add-btn'));

    await waitFor(() => expect(screen.getByTestId('embedding-credential-card')).toHaveTextContent('Ollama'));

    const calls = fetchMock.mock.calls as [string, RequestInit | undefined][];
    const probeCall = calls.find(([url, init]) =>
      url === '/api/memory/embedding-credentials/probe' && init?.method === 'POST',
    );
    const createCall = calls.find(([url, init]) =>
      url === '/api/memory/embedding-credentials' && init?.method === 'POST',
    );

    expect(JSON.parse(String(probeCall?.[1]?.body))).toMatchObject({
      name: 'Ollama',
      provider: 'ollama',
      apiKey: '',
      baseUrl: 'http://localhost:11434',
      model: 'nomic-embed-text',
      dimensions: 768,
    });

    expect(JSON.parse(String(createCall?.[1]?.body))).toMatchObject({
      name: 'Ollama',
      provider: 'ollama',
      apiKey: '',
      baseUrl: 'http://localhost:11434',
      model: 'nomic-embed-text',
      dimensions: 768,
    });
  });

  it('normalizes an unsupported saved local model so the user can apply a supported one immediately', async () => {
    installFetchQueue({
      'GET /api/memory/embedding-credentials': [[]],
      'GET /api/memory/status/embedding': [LOCAL_STATUS],
      'GET /api/memory/embedding-local': [{
        enabled: true,
        model: 'text-embedding-3-small',
        dimensions: 1536,
        backend: 'cpu',
      }],
      'POST /api/memory/embedding-local/availability': [{ status: 'missing', installed: false, model: 'text-embedding-3-small', dimensions: 1536, backend: 'cpu', message: 'Model not installed yet.' }],
    });

    render(<EmbeddingsPanel />);

    expect(await screen.findByTestId('embedding-local-model')).toHaveValue('Xenova/multilingual-e5-small');
    expect(screen.getByTestId('embedding-local-config-warning')).toHaveTextContent('text-embedding-3-small');
    expect(screen.getByTestId('embedding-local-save')).toBeEnabled();
  });

  it('can run a local embedding health test', async () => {
    const user = userEvent.setup();
    const fetchMock = installFetchQueue({
      'GET /api/memory/embedding-credentials': [[]],
      'GET /api/memory/status/embedding': [LOCAL_STATUS],
      'GET /api/memory/embedding-local': [{ enabled: true, model: 'Xenova/multilingual-e5-small', dimensions: 384, backend: 'cpu' }],
      'POST /api/memory/embedding-local/availability': [{ status: 'ready', installed: true, model: 'Xenova/multilingual-e5-small', dimensions: 384, backend: 'cpu', message: 'Model installed and ready.' }],
      'POST /api/memory/embedding-local/test': [{ ok: true, model: 'Xenova/multilingual-e5-small', dimensions: 384, backend: 'cpu' }],
    });

    render(<EmbeddingsPanel />);

    await user.click(await screen.findByTestId('embedding-local-test-btn'));

    await waitFor(() => {
      const call = fetchMock.mock.calls.find(([url, init]) => url === '/api/memory/embedding-local/test' && init?.method === 'POST');
      expect(call).toBeDefined();
      expect(JSON.parse(String(call?.[1]?.body))).toMatchObject({
        enabled: true,
        model: 'Xenova/multilingual-e5-small',
        dimensions: 384,
        backend: 'cpu',
      });
      expect(screen.getByText(/Local embedding ready:/i)).toBeInTheDocument();
    });
  });

  it('shows a runtime mismatch warning when saved local config differs from the active local runtime', async () => {
    installFetchQueue({
      'GET /api/memory/embedding-credentials': [[]],
      'GET /api/memory/status/embedding': [LOCAL_STATUS],
      'GET /api/memory/embedding-local': [{
        enabled: true,
        model: 'Xenova/multilingual-e5-base',
        dimensions: 768,
        backend: 'cpu',
      }],
      'POST /api/memory/embedding-local/availability': [{ status: 'ready', installed: true, model: 'Xenova/multilingual-e5-base', dimensions: 768, backend: 'cpu', message: 'Model installed and ready.' }],
    });

    render(<EmbeddingsPanel />);

    expect(await screen.findByTestId('embedding-local-runtime-mismatch')).toHaveTextContent(
      'Active runtime differs: Xenova/multilingual-e5-small (384d). Apply local settings or Use local to sync it.',
    );
    expect(screen.getByTestId('embedding-local-save')).toBeDisabled();
  });

  it('shows the local embedding test error returned by the API', async () => {
    const user = userEvent.setup();
    installFetchQueue({
      'GET /api/memory/embedding-credentials': [[]],
      'GET /api/memory/status/embedding': [LOCAL_STATUS],
      'GET /api/memory/embedding-local': [{ enabled: true, model: 'Xenova/multilingual-e5-small', dimensions: 384, backend: 'cpu' }],
      'POST /api/memory/embedding-local/availability': [{ status: 'ready', installed: true, model: 'Xenova/multilingual-e5-small', dimensions: 384, backend: 'cpu', message: 'Model installed and ready.' }],
      'POST /api/memory/embedding-local/test': [{ ok: false, error: 'pipeline init failed', model: 'Xenova/multilingual-e5-small', dimensions: 384, backend: 'cpu' }],
    });

    render(<EmbeddingsPanel />);

    await user.click(await screen.findByTestId('embedding-local-test-btn'));

    await waitFor(() => {
      expect(screen.getByText('pipeline init failed')).toBeInTheDocument();
    });
  });

  it('shows install action and blocks local test until the model is installed', async () => {
    installFetchQueue({
      'GET /api/memory/embedding-credentials': [[]],
      'GET /api/memory/status/embedding': [LOCAL_STATUS],
      'GET /api/memory/embedding-local': [{ enabled: true, model: 'Xenova/multilingual-e5-small', dimensions: 384, backend: 'cpu' }],
      'POST /api/memory/embedding-local/availability': [{ status: 'missing', installed: false, model: 'Xenova/multilingual-e5-small', dimensions: 384, backend: 'cpu', message: 'Model not installed yet.' }],
    });

    render(<EmbeddingsPanel />);

    expect(await screen.findByTestId('embedding-local-install-btn')).toHaveTextContent('Install model');
    expect(screen.getByTestId('embedding-local-test-btn')).toBeDisabled();
    expect(screen.getByTestId('embedding-local-availability-message')).toHaveTextContent('Model not installed yet.');
  });

  it('starts local install and shows an indeterminate progress indicator while installing', async () => {
    const user = userEvent.setup();
    const fetchMock = installFetchQueue({
      'GET /api/memory/embedding-credentials': [[]],
      'GET /api/memory/status/embedding': [LOCAL_STATUS],
      'GET /api/memory/embedding-local': [{ enabled: true, model: 'Xenova/multilingual-e5-small', dimensions: 384, backend: 'cpu' }],
      'POST /api/memory/embedding-local/availability': [{ status: 'missing', installed: false, model: 'Xenova/multilingual-e5-small', dimensions: 384, backend: 'cpu', message: 'Model not installed yet.' }],
      'POST /api/memory/embedding-local/install': [
        { status: 'installing', installed: false, model: 'Xenova/multilingual-e5-small', dimensions: 384, backend: 'cpu', message: 'Installing local model...' },
      ],
    });

    render(<EmbeddingsPanel />);

    await user.click(await screen.findByTestId('embedding-local-install-btn'));

    expect(fetchMock.mock.calls.some(([url, init]) => url === '/api/memory/embedding-local/install' && init?.method === 'POST')).toBe(true);
    expect(await screen.findByTestId('embedding-local-install-progress')).toBeInTheDocument();
    expect(screen.getByTestId('embedding-local-availability-message')).toHaveTextContent('Installing local model...');
    expect(screen.getByTestId('embedding-local-test-btn')).toBeDisabled();
  });
});
