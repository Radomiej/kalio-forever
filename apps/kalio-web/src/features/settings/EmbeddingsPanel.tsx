import { useState, useEffect, useCallback } from 'react';
import { Plus, Loader2, AlertCircle, Zap, Info, Check, Trash2 } from 'lucide-react';
import type { EmbeddingCredential, CreateEmbeddingCredentialDto, EmbeddingStatus } from '@kalio/types';

// ── Constants ──────────────────────────────────────────────────────────────

const PROVIDER_LABELS: Record<string, string> = {
  openai:     'OpenAI',
  cometapi:   'CometAPI',
  openrouter: 'OpenRouter',
  ollama:     'Ollama',
  custom:     'Custom',
};

const PROVIDER_BASE_URLS: Record<string, string> = {
  openai:     'https://api.openai.com/v1',
  cometapi:   'https://api.cometapi.com/v1',
  openrouter: 'https://openrouter.ai/api/v1',
  ollama:     'http://localhost:11434',
  custom:     '',
};

const PROVIDER_DEFAULT_MODELS: Record<string, string> = {
  openai:     'text-embedding-3-small',
  cometapi:   'text-embedding-3-small',
  openrouter: 'openai/text-embedding-3-small',
  ollama:     'nomic-embed-text',
  custom:     '',
};

const PROVIDER_DEFAULT_DIMS: Record<string, number> = {
  openai:     1536,
  cometapi:   1536,
  openrouter: 1536,
  ollama:     768,
  custom:     1536,
};

const ALL_PROVIDERS = ['openai', 'cometapi', 'openrouter', 'ollama', 'custom'] as const;

// ── Helpers ────────────────────────────────────────────────────────────────

async function apiFetch<T>(path: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`${res.status}: ${text}`);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

// ── Add form type ──────────────────────────────────────────────────────────

interface AddForm {
  name: string;
  provider: string;
  apiKey: string;
  baseUrl: string;
  model: string;
  dimensions: number;
  nameEdited?: boolean;
}

function emptyForm(): AddForm {
  return {
    name:        PROVIDER_LABELS['openai'] ?? 'OpenAI',
    provider:    'openai',
    apiKey:      '',
    baseUrl:     PROVIDER_BASE_URLS['openai'] ?? '',
    model:       PROVIDER_DEFAULT_MODELS['openai'] ?? '',
    dimensions:  PROVIDER_DEFAULT_DIMS['openai'] ?? 1536,
    nameEdited:  false,
  };
}

// ── EmbeddingCredentialCard ────────────────────────────────────────────────

interface EmbeddingCredentialCardProps {
  cred: EmbeddingCredential;
  isActive: boolean;
  onActivate: () => void;
  onRemove: () => void;
  onTest: () => void;
  testState: 'idle' | 'testing' | 'ok' | 'error';
  testError: string | null;
  syncing: boolean;
}

function EmbeddingCredentialCard({
  cred, isActive, onActivate, onRemove, onTest, testState, testError, syncing,
}: EmbeddingCredentialCardProps) {
  const [confirmRemove, setConfirmRemove] = useState(false);

  return (
    <div
      className={`border rounded-lg p-3 flex flex-col gap-2 transition-colors ${isActive ? 'border-sky-500/50 bg-sky-500/5' : 'border-base-300 bg-base-200/30'}`}
      data-testid="embedding-credential-card"
    >
      <div className="flex items-center gap-2">
        {isActive && <Check size={13} className="text-sky-400 shrink-0" />}
        <span className="text-sm font-medium flex-1">{cred.name}</span>
        <span className="badge badge-ghost badge-xs opacity-60">{PROVIDER_LABELS[cred.provider] ?? cred.provider}</span>
        {isActive && <span className="badge badge-info badge-xs">active</span>}
      </div>
      <div className="text-xs text-base-content/60 pl-1 flex flex-col gap-0.5">
        <span>Model: <span className="font-mono">{cred.model}</span></span>
        <span>Dimensions: <span className="font-mono">{cred.dimensions}</span></span>
        <span>Endpoint: <span className="font-mono">{cred.baseUrl}</span></span>
      </div>
      <div className="flex items-center gap-2 pt-1 flex-wrap">
        {!isActive && (
          <button
            className="btn btn-primary btn-xs"
            disabled={syncing}
            onClick={onActivate}
            data-testid="embedding-activate-btn"
          >
            {syncing ? <Loader2 size={11} className="animate-spin" /> : null}
            Activate
          </button>
        )}
        <button
          className={`btn btn-xs gap-1 ${testState === 'ok' ? 'btn-success' : testState === 'error' ? 'btn-error btn-outline' : 'btn-outline btn-primary'}`}
          onClick={onTest}
          disabled={testState === 'testing'}
          data-testid="embedding-test-btn"
        >
          {testState === 'testing' ? <Loader2 size={11} className="animate-spin" /> : <Zap size={11} />}
          {testState === 'ok' ? 'OK!' : testState === 'error' ? 'Failed' : 'Test'}
        </button>
        {testError && <span className="text-xs text-error">{testError}</span>}
        <div className="flex-1" />
        {confirmRemove ? (
          <div className="flex items-center gap-2">
            <span className="text-xs text-warning">Remove?</span>
            <button className="btn btn-xs btn-error" disabled={syncing} onClick={onRemove}>
              {syncing ? <Loader2 size={11} className="animate-spin" /> : 'Yes'}
            </button>
            <button className="btn btn-xs btn-ghost" onClick={() => setConfirmRemove(false)}>No</button>
          </div>
        ) : (
          <button
            className="btn btn-ghost btn-xs gap-1 text-base-content/40 hover:text-error"
            onClick={() => setConfirmRemove(true)}
            data-testid="embedding-remove-btn"
          >
            <Trash2 size={12} /> Remove
          </button>
        )}
      </div>
    </div>
  );
}

// ── EmbeddingsPanel ────────────────────────────────────────────────────────

export function EmbeddingsPanel() {
  const [credentials, setCredentials] = useState<EmbeddingCredential[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [status, setStatus] = useState<EmbeddingStatus | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<AddForm>(emptyForm());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState<string | null>(null);
  const [testStates, setTestStates] = useState<Record<string, 'idle' | 'testing' | 'ok' | 'error'>>({});
  const [testErrors, setTestErrors] = useState<Record<string, string | null>>({});
  const [addTestState, setAddTestState] = useState<'idle' | 'testing' | 'ok' | 'error'>('idle');
  const [addTestError, setAddTestError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [creds, st] = await Promise.all([
        apiFetch<EmbeddingCredential[]>('/memory/embedding-credentials'),
        apiFetch<EmbeddingStatus>('/memory/status/embedding'),
      ]);
      setCredentials(creds);
      setStatus(st);
      setActiveId(st.activeCredentialId ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const handleProviderChange = (provider: string) => {
    const label = PROVIDER_LABELS[provider] ?? provider;
    setForm((f) => ({
      ...f,
      provider,
      baseUrl: PROVIDER_BASE_URLS[provider] ?? '',
      model:   PROVIDER_DEFAULT_MODELS[provider] ?? '',
      dimensions: PROVIDER_DEFAULT_DIMS[provider] ?? 1536,
      name:    f.nameEdited ? f.name : label,
    }));
    setAddTestState('idle');
    setAddTestError(null);
  };

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    setSyncing('add');
    setError(null);
    try {
      const dto: CreateEmbeddingCredentialDto = {
        name: form.name,
        provider: form.provider as EmbeddingCredential['provider'],
        apiKey: form.apiKey,
        baseUrl: form.baseUrl,
        model: form.model,
        dimensions: form.dimensions,
      };
      const created = await apiFetch<EmbeddingCredential>('/memory/embedding-credentials', {
        method: 'POST',
        body: JSON.stringify(dto),
      });
      setCredentials((prev) => [...prev, created]);
      setForm(emptyForm());
      setShowForm(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add');
    } finally {
      setSyncing(null);
    }
  };

  const handleActivate = async (credId: string) => {
    setSyncing(credId);
    setError(null);
    try {
      const st = await apiFetch<EmbeddingStatus>(`/memory/embedding-credentials/active/${credId}`, { method: 'PUT' });
      setStatus(st);
      setActiveId(st.activeCredentialId ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to activate');
    } finally {
      setSyncing(null);
    }
  };

  const handleRemove = async (credId: string) => {
    setSyncing(credId);
    setError(null);
    try {
      const st = await apiFetch<EmbeddingStatus>(`/memory/embedding-credentials/${credId}`, { method: 'DELETE' });
      setCredentials((prev) => prev.filter((c) => c.id !== credId));
      setStatus(st);
      setActiveId(st.activeCredentialId ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to remove');
    } finally {
      setSyncing(null);
    }
  };

  const handleTest = async (credId: string) => {
    setTestStates((p) => ({ ...p, [credId]: 'testing' }));
    setTestErrors((p) => ({ ...p, [credId]: null }));
    try {
      const r = await apiFetch<{ ok: boolean; error?: string }>(`/memory/embedding-credentials/${credId}/test`, { method: 'POST' });
      setTestStates((p) => ({ ...p, [credId]: r.ok ? 'ok' : 'error' }));
      setTestErrors((p) => ({ ...p, [credId]: r.error ?? null }));
    } catch (err) {
      setTestStates((p) => ({ ...p, [credId]: 'error' }));
      setTestErrors((p) => ({ ...p, [credId]: err instanceof Error ? err.message : 'Network error' }));
    }
  };

  return (
    <div className="flex flex-col gap-5" data-testid="embeddings-panel">
      <div>
        <h2 className="text-base font-semibold mb-1">Embeddings Provider</h2>
        <p className="text-xs text-base-content/60">
          Configure providers used for semantic memory search.
          Supports OpenAI, CometAPI, OpenRouter, and Ollama.
          Activate one to use it for all memory operations.
        </p>
      </div>

      {error && (
        <div className="alert alert-warning py-2 text-xs gap-2">
          <AlertCircle size={14} />
          {error}
          <button className="btn btn-ghost btn-xs ml-auto" onClick={() => setError(null)}>✕</button>
        </div>
      )}

      {loading ? (
        <div className="flex items-center gap-2 text-xs text-base-content/50 py-4">
          <Loader2 size={14} className="animate-spin" /> Loading...
        </div>
      ) : (
        <>
          {/* Credential list */}
          <div className="flex flex-col gap-2">
            {credentials.length === 0 && !showForm && status?.source !== 'env' && (
              <p className="text-xs text-base-content/40">No embedding providers configured. Add one below.</p>
            )}
            {credentials.map((cred) => (
              <EmbeddingCredentialCard
                key={cred.id}
                cred={cred}
                isActive={cred.id === activeId}
                onActivate={() => void handleActivate(cred.id)}
                onRemove={() => void handleRemove(cred.id)}
                onTest={() => void handleTest(cred.id)}
                testState={testStates[cred.id] ?? 'idle'}
                testError={testErrors[cred.id] ?? null}
                syncing={syncing === cred.id}
              />
            ))}
          </div>

          {/* Env provider (read-only) — shown only when no DB credential is active */}
          {status?.source === 'env' && !activeId && (
            <div className="border border-sky-500/20 bg-sky-500/5 rounded-lg p-3 flex flex-col gap-1" data-testid="embedding-env-card">
              <div className="flex items-center gap-2">
                <Info size={13} className="text-sky-400 shrink-0" />
                <span className="text-sm font-medium flex-1">Env Provider (read-only)</span>
                <span className="badge badge-ghost badge-xs">active</span>
              </div>
              <div className="text-xs text-base-content/60 pl-5 flex flex-col gap-0.5">
                <span>Model: <span className="font-mono">{status.model}</span></span>
                <span>Endpoint: <span className="font-mono">{status.baseUrlMasked}</span></span>
              </div>
              <p className="text-[10px] text-base-content/40 pl-5 mt-1">
                Configured via environment variables. Add a provider above to override.
              </p>
            </div>
          )}

          {/* Mock warning */}
          {status?.source === 'mock' && credentials.length === 0 && (
            <div className="border border-warning/30 bg-warning/5 rounded-lg p-3 flex flex-col gap-1" data-testid="embedding-mock-card">
              <div className="flex items-center gap-2">
                <AlertCircle size={13} className="text-warning shrink-0" />
                <span className="text-sm font-medium">Not configured</span>
              </div>
              <p className="text-xs text-warning/70 pl-5">
                Memory ingest produces <strong>dummy embeddings</strong> — semantic search will not work.
              </p>
            </div>
          )}

          {/* Add provider form */}
          {showForm ? (
            <form
              className="flex flex-col gap-4 border border-base-300 rounded-lg p-4 bg-base-200/40"
              onSubmit={(e) => void handleAdd(e)}
              data-testid="embedding-add-form"
            >
              <h3 className="text-sm font-semibold">Add Embedding Provider</h3>

              {/* Provider picker */}
              <div className="flex flex-col gap-1">
                <span className="text-xs text-base-content/60">Provider</span>
                <div className="flex gap-1 flex-wrap">
                  {ALL_PROVIDERS.map((p) => (
                    <button
                      key={p}
                      type="button"
                      className={`btn btn-xs ${form.provider === p ? 'btn-primary' : 'btn-ghost border border-base-300'}`}
                      onClick={() => handleProviderChange(p)}
                    >
                      {PROVIDER_LABELS[p] ?? p}
                    </button>
                  ))}
                </div>
              </div>

              <label className="form-control gap-1">
                <span className="text-xs text-base-content/60">Name</span>
                <input
                  className="input input-bordered input-sm"
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value, nameEdited: true }))}
                  placeholder="My OpenAI embeddings"
                  required
                />
              </label>

              <label className="form-control gap-1">
                <span className="text-xs text-base-content/60">API Key</span>
                <input
                  className="input input-bordered input-sm font-mono"
                  type="password"
                  placeholder="sk-..."
                  value={form.apiKey}
                  onChange={(e) => setForm((f) => ({ ...f, apiKey: e.target.value }))}
                  required={form.provider !== 'ollama'}
                />
              </label>

              <label className="form-control gap-1">
                <span className="text-xs text-base-content/60">Base URL</span>
                <input
                  className="input input-bordered input-sm font-mono"
                  value={form.baseUrl}
                  onChange={(e) => setForm((f) => ({ ...f, baseUrl: e.target.value }))}
                  required
                />
              </label>

              <div className="flex gap-3">
                <label className="form-control gap-1 flex-1">
                  <span className="text-xs text-base-content/60">Embedding model</span>
                  <input
                    className="input input-bordered input-sm font-mono"
                    value={form.model}
                    onChange={(e) => setForm((f) => ({ ...f, model: e.target.value }))}
                    required
                  />
                </label>
                <label className="form-control gap-1 w-28">
                  <span className="text-xs text-base-content/60">Dimensions</span>
                  <input
                    className="input input-bordered input-sm font-mono"
                    type="number"
                    min={64}
                    max={4096}
                    value={form.dimensions}
                    onChange={(e) => setForm((f) => ({ ...f, dimensions: parseInt(e.target.value, 10) || 1536 }))}
                    required
                  />
                </label>
              </div>

              {addTestError && (
                <div className="text-xs text-error flex gap-1 items-center">
                  <AlertCircle size={12} /> {addTestError}
                </div>
              )}

              <div className="flex gap-2 items-center justify-between">
                <button
                  type="button"
                  className={`btn btn-ghost btn-xs gap-1 ${addTestState === 'ok' ? 'text-success' : addTestState === 'error' ? 'text-error' : 'text-base-content/60'}`}
                  onClick={() => {
                    if (!form.apiKey && form.provider !== 'ollama') { setAddTestError('Enter API key before testing'); return; }
                    setAddTestState('testing');
                    setAddTestError(null);
                    // Create a temp credential to test — we test by saving then deleting
                    // For simplicity in the add-form, surface a note to user
                    setAddTestState('idle');
                    setAddTestError('Save the credential first, then test it from the list');
                  }}
                  data-testid="add-form-test-btn"
                >
                  <Zap size={12} />
                  {addTestState === 'ok' ? 'OK!' : 'Test hint'}
                </button>
                <div className="flex gap-2">
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setShowForm(false); setForm(emptyForm()); }}>
                    Cancel
                  </button>
                  <button type="submit" className="btn btn-primary btn-sm" disabled={syncing === 'add'} data-testid="embedding-add-btn">
                    {syncing === 'add' ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
                    Add Provider
                  </button>
                </div>
              </div>
            </form>
          ) : (
            <button
              className="btn btn-ghost btn-sm gap-2 self-start text-sky-400 hover:text-sky-300"
              onClick={() => setShowForm(true)}
              data-testid="add-embedding-provider-btn"
            >
              <Plus size={14} />
              Add Provider
            </button>
          )}

          <p className="text-xs text-base-content/40 border-t border-base-300 pt-3">
            Tip: Set <code className="font-mono">EMBEDDING_BASE_URL</code> and{' '}
            <code className="font-mono">EMBEDDING_API_KEY</code> in{' '}
            <code className="font-mono">.env</code> for a startup default. DB credentials take precedence when activated.
          </p>
        </>
      )}
    </div>
  );
}
