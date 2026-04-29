import { useState, useEffect, useCallback } from 'react';
import { AlertCircle, Loader2, Zap, Check, RefreshCw } from 'lucide-react';

interface EmbeddingStatus {
  provider: string;
  model: string;
  dimensions: number;
  baseUrlMasked: string;
  configured: boolean;
}

interface EmbeddingForm {
  baseUrl: string;
  apiKey: string;
  model: string;
  dimensions: number;
}

const PROVIDER_PRESETS: Array<{ label: string; baseUrl: string; model: string; dimensions: number }> = [
  { label: 'OpenAI', baseUrl: 'https://api.openai.com/v1', model: 'text-embedding-3-small', dimensions: 1536 },
  { label: 'OpenAI large', baseUrl: 'https://api.openai.com/v1', model: 'text-embedding-3-large', dimensions: 3072 },
  { label: 'CometAPI', baseUrl: 'https://api.cometapi.com/v1', model: 'text-embedding-3-small', dimensions: 1536 },
  { label: 'Ollama', baseUrl: 'http://localhost:11434/v1', model: 'nomic-embed-text', dimensions: 768 },
];

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

function emptyForm(): EmbeddingForm {
  return {
    baseUrl: 'https://api.openai.com/v1',
    apiKey: '',
    model: 'text-embedding-3-small',
    dimensions: 1536,
  };
}

export function EmbeddingsPanel() {
  const [status, setStatus] = useState<EmbeddingStatus | null>(null);
  const [form, setForm] = useState<EmbeddingForm>(emptyForm());
  const [showForm, setShowForm] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [testState, setTestState] = useState<'idle' | 'testing' | 'ok' | 'error'>('idle');
  const [testMsg, setTestMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const s = await apiFetch<EmbeddingStatus>('/memory/status/embedding');
      setStatus(s);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const handlePreset = (preset: typeof PROVIDER_PRESETS[number]) => {
    setForm((f) => ({ ...f, baseUrl: preset.baseUrl, model: preset.model, dimensions: preset.dimensions }));
    setTestState('idle');
  };

  const handleTest = async () => {
    setTestState('testing');
    setTestMsg(null);
    try {
      const res = await apiFetch<{ ok: boolean; error?: string }>('/memory/test/embedding', { method: 'POST' });
      if (res.ok) {
        setTestState('ok');
        setTestMsg('Connection successful');
      } else {
        setTestState('error');
        setTestMsg(res.error ?? 'Test failed');
      }
    } catch (e) {
      setTestState('error');
      setTestMsg(e instanceof Error ? e.message : 'Network error');
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const updated = await apiFetch<EmbeddingStatus>('/memory/config/embedding', {
        method: 'PUT',
        body: JSON.stringify({
          baseUrl: form.baseUrl,
          apiKey: form.apiKey || undefined,
          model: form.model,
          dimensions: form.dimensions,
        }),
      });
      setStatus(updated);
      setShowForm(false);
      setTestState('idle');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-5" data-testid="embeddings-panel">
      <div>
        <h2 className="text-base font-semibold mb-1">Embeddings Provider</h2>
        <p className="text-xs text-base-content/60">
          Configure the embedding model used for semantic memory search.
          Requires an OpenAI-compatible API (e.g. OpenAI, CometAPI) or a local Ollama instance.
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
          <Loader2 size={14} className="animate-spin" /> Loading…
        </div>
      ) : (
        <>
          {/* Current status */}
          {status && (
            <div className={`border rounded-lg p-4 flex flex-col gap-1 ${status.configured ? 'border-sky-500/30 bg-sky-500/5' : 'border-base-300 bg-base-200/50'}`}>
              <div className="flex items-center gap-2 text-sm font-medium">
                {status.configured ? (
                  <Check size={14} className="text-sky-400 shrink-0" />
                ) : (
                  <AlertCircle size={14} className="text-warning shrink-0" />
                )}
                <span>{status.configured ? 'Configured' : 'Not configured'}</span>
                <button className="btn btn-ghost btn-xs ml-auto gap-1" onClick={() => void load()}>
                  <RefreshCw size={12} /> Refresh
                </button>
              </div>
              {status.configured && (
                <div className="text-xs text-base-content/60 ml-5 flex flex-col gap-0.5">
                  <span>Model: <span className="font-mono">{status.model}</span></span>
                  <span>Dimensions: <span className="font-mono">{status.dimensions}</span></span>
                  <span>Endpoint: <span className="font-mono">{status.baseUrlMasked}</span></span>
                </div>
              )}
              {!status.configured && (
                <p className="text-xs text-base-content/50 ml-5">
                  Memory search will use mock embeddings. Add a provider below to enable real semantic search.
                </p>
              )}
            </div>
          )}

          {/* Configure form */}
          {showForm ? (
            <form
              className="flex flex-col gap-3 border border-base-300 rounded-lg p-4 bg-base-200/40"
              onSubmit={(e) => void handleSave(e)}
              data-testid="embedding-config-form"
            >
              <h3 className="text-sm font-semibold">Configure Embedding Provider</h3>

              <div className="flex gap-2 flex-wrap">
                {PROVIDER_PRESETS.map((p) => (
                  <button
                    key={`${p.label}-${p.model}`}
                    type="button"
                    className={`btn btn-xs ${form.baseUrl === p.baseUrl && form.model === p.model ? 'btn-primary' : 'btn-ghost border border-base-300'}`}
                    onClick={() => handlePreset(p)}
                  >
                    {p.label}
                  </button>
                ))}
              </div>

              <label className="form-control gap-1">
                <span className="text-xs text-base-content/60">API Key <span className="text-base-content/40">(leave blank to keep existing)</span></span>
                <input
                  className="input input-bordered input-sm font-mono"
                  type="password"
                  placeholder="sk-… or pplx-…"
                  value={form.apiKey}
                  onChange={(e) => setForm((f) => ({ ...f, apiKey: e.target.value }))}
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
                  <span className="text-xs text-base-content/60">Model</span>
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

              {testMsg && (
                <div className={`text-xs flex gap-1 items-center ${testState === 'ok' ? 'text-success' : 'text-error'}`}>
                  <AlertCircle size={12} /> {testMsg}
                </div>
              )}

              <div className="flex gap-2 items-center justify-between">
                <button
                  type="button"
                  className={`btn btn-ghost btn-xs gap-1 ${testState === 'ok' ? 'text-success' : testState === 'error' ? 'text-error' : 'text-base-content/60'}`}
                  onClick={() => void handleTest()}
                  disabled={testState === 'testing'}
                >
                  {testState === 'testing' ? <Loader2 size={12} className="animate-spin" /> : <Zap size={12} />}
                  {testState === 'ok' ? 'OK!' : testState === 'error' ? 'Failed' : 'Test current'}
                </button>
                <div className="flex gap-2">
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setShowForm(false); setTestState('idle'); }}>
                    Cancel
                  </button>
                  <button type="submit" className="btn btn-primary btn-sm" disabled={saving}>
                    {saving ? <Loader2 size={14} className="animate-spin" /> : null}
                    Save
                  </button>
                </div>
              </div>
            </form>
          ) : (
            <button
              className="btn btn-ghost btn-sm gap-2 self-start text-sky-400 hover:text-sky-300"
              onClick={() => setShowForm(true)}
              data-testid="configure-embedding-btn"
            >
              Configure
            </button>
          )}

          <div className="text-xs text-base-content/40 border-t border-base-300 pt-3">
            Tip: You can also set <code className="font-mono">EMBEDDING_BASE_URL</code> and{' '}
            <code className="font-mono">EMBEDDING_API_KEY</code> in <code className="font-mono">.env</code>.
            Settings configured here take precedence.
          </div>
        </>
      )}
    </div>
  );
}
