import { useState, useEffect, useCallback } from 'react';
import { AlertCircle, Loader2, Zap, Check, RefreshCw, Link, Settings } from 'lucide-react';
import type { Credential, EmbeddingStatus } from '@kalio/types';

// ── Types ──────────────────────────────────────────────────────────────────

type Mode = 'credential' | 'custom';

interface CredentialForm {
  credentialId: string;
  model: string;
  dimensions: number;
}

interface CustomForm {
  baseUrl: string;
  apiKey: string;
  model: string;
  dimensions: number;
}

// Preset model options per provider type
const EMBEDDING_MODELS: Record<string, Array<{ model: string; dimensions: number }>> = {
  openai:     [{ model: 'text-embedding-3-small', dimensions: 1536 }, { model: 'text-embedding-3-large', dimensions: 3072 }],
  cometapi:   [{ model: 'text-embedding-3-small', dimensions: 1536 }, { model: 'text-embedding-3-large', dimensions: 3072 }],
  xiaomimimo: [{ model: 'text-embedding-3-small', dimensions: 1536 }],
  openrouter: [{ model: 'text-embedding-3-small', dimensions: 1536 }],
  ollama:     [{ model: 'nomic-embed-text', dimensions: 768 }, { model: 'mxbai-embed-large', dimensions: 1024 }],
  deepseek:   [{ model: 'text-embedding-3-small', dimensions: 1536 }],
};

const CUSTOM_PRESETS = [
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

export function EmbeddingsPanel() {
  const [status, setStatus] = useState<EmbeddingStatus | null>(null);
  const [credentials, setCredentials] = useState<Credential[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [mode, setMode] = useState<Mode>('credential');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [testState, setTestState] = useState<'idle' | 'testing' | 'ok' | 'error'>('idle');
  const [testMsg, setTestMsg] = useState<string | null>(null);

  const [credForm, setCredForm] = useState<CredentialForm>({
    credentialId: '',
    model: 'text-embedding-3-small',
    dimensions: 1536,
  });
  const [customForm, setCustomForm] = useState<CustomForm>({
    baseUrl: 'https://api.openai.com/v1',
    apiKey: '',
    model: 'text-embedding-3-small',
    dimensions: 1536,
  });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [s, creds] = await Promise.all([
        apiFetch<EmbeddingStatus>('/memory/status/embedding'),
        apiFetch<Credential[]>('/credentials'),
      ]);
      setStatus(s);
      setCredentials(creds);
      if (s.credentialId) {
        setCredForm((f) => ({ ...f, credentialId: s.credentialId! }));
        setMode('credential');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const selectedCred = credentials.find((c) => c.id === credForm.credentialId);
  const modelSuggestions = selectedCred
    ? (EMBEDDING_MODELS[selectedCred.provider] ?? [{ model: 'text-embedding-3-small', dimensions: 1536 }])
    : [];

  const handleCredentialChange = (credentialId: string) => {
    const cred = credentials.find((c) => c.id === credentialId);
    const suggestions = cred ? (EMBEDDING_MODELS[cred.provider] ?? []) : [];
    const first = suggestions[0];
    setCredForm({
      credentialId,
      model: first?.model ?? 'text-embedding-3-small',
      dimensions: first?.dimensions ?? 1536,
    });
    setTestState('idle');
  };

  const handleCustomPreset = (p: typeof CUSTOM_PRESETS[number]) => {
    setCustomForm((f) => ({ ...f, baseUrl: p.baseUrl, model: p.model, dimensions: p.dimensions }));
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
      let updated: EmbeddingStatus;
      if (mode === 'credential') {
        updated = await apiFetch<EmbeddingStatus>('/memory/config/embedding/from-credential', {
          method: 'PUT',
          body: JSON.stringify({
            credentialId: credForm.credentialId,
            model: credForm.model,
            dimensions: credForm.dimensions,
          }),
        });
      } else {
        updated = await apiFetch<EmbeddingStatus>('/memory/config/embedding', {
          method: 'PUT',
          body: JSON.stringify({
            baseUrl: customForm.baseUrl,
            apiKey: customForm.apiKey || undefined,
            model: customForm.model,
            dimensions: customForm.dimensions,
          }),
        });
      }
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
          You can reuse an existing LLM provider credential, or configure a separate endpoint.
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
                  {status.credentialName && (
                    <span className="flex items-center gap-1">
                      <Link size={11} className="text-sky-400" />
                      Linked to: <span className="font-medium">{status.credentialName}</span>
                    </span>
                  )}
                  <span>Model: <span className="font-mono">{status.model}</span></span>
                  <span>Dimensions: <span className="font-mono">{status.dimensions}</span></span>
                  <span>Endpoint: <span className="font-mono">{status.baseUrlMasked}</span></span>
                </div>
              )}
              {!status.configured && (
                <p className="text-xs text-base-content/50 ml-5">
                  Memory search will use mock embeddings. Configure a provider below to enable real semantic search.
                </p>
              )}
            </div>
          )}

          {/* Configure form */}
          {showForm ? (
            <form
              className="flex flex-col gap-4 border border-base-300 rounded-lg p-4 bg-base-200/40"
              onSubmit={(e) => void handleSave(e)}
              data-testid="embedding-config-form"
            >
              <h3 className="text-sm font-semibold">Configure Embedding Provider</h3>

              {/* Mode tabs */}
              <div className="flex gap-1 p-1 bg-base-300/50 rounded-lg w-fit">
                <button
                  type="button"
                  className={`btn btn-xs gap-1 ${mode === 'credential' ? 'btn-primary' : 'btn-ghost'}`}
                  onClick={() => setMode('credential')}
                >
                  <Link size={12} /> From existing provider
                </button>
                <button
                  type="button"
                  className={`btn btn-xs gap-1 ${mode === 'custom' ? 'btn-primary' : 'btn-ghost'}`}
                  onClick={() => setMode('custom')}
                >
                  <Settings size={12} /> Custom
                </button>
              </div>

              {mode === 'credential' ? (
                <>
                  <label className="form-control gap-1">
                    <span className="text-xs text-base-content/60">Select provider</span>
                    <select
                      className="select select-bordered select-sm"
                      value={credForm.credentialId}
                      onChange={(e) => handleCredentialChange(e.target.value)}
                      required
                    >
                      <option value="" disabled>— pick a credential —</option>
                      {credentials.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name} ({c.provider}{c.model ? ` · ${c.model}` : ''})
                        </option>
                      ))}
                    </select>
                  </label>

                  {credForm.credentialId && modelSuggestions.length > 0 && (
                    <div className="flex gap-2 flex-wrap">
                      {modelSuggestions.map((s) => (
                        <button
                          key={s.model}
                          type="button"
                          className={`btn btn-xs ${credForm.model === s.model ? 'btn-primary' : 'btn-ghost border border-base-300'}`}
                          onClick={() => setCredForm((f) => ({ ...f, model: s.model, dimensions: s.dimensions }))}
                        >
                          {s.model}
                        </button>
                      ))}
                    </div>
                  )}

                  <div className="flex gap-3">
                    <label className="form-control gap-1 flex-1">
                      <span className="text-xs text-base-content/60">Embedding model</span>
                      <input
                        className="input input-bordered input-sm font-mono"
                        value={credForm.model}
                        onChange={(e) => setCredForm((f) => ({ ...f, model: e.target.value }))}
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
                        value={credForm.dimensions}
                        onChange={(e) => setCredForm((f) => ({ ...f, dimensions: parseInt(e.target.value, 10) || 1536 }))}
                        required
                      />
                    </label>
                  </div>

                  {credentials.length === 0 && (
                    <p className="text-xs text-warning">No LLM credentials configured yet. Add one in the LLM tab first.</p>
                  )}
                </>
              ) : (
                <>
                  <div className="flex gap-2 flex-wrap">
                    {CUSTOM_PRESETS.map((p) => (
                      <button
                        key={`${p.label}-${p.model}`}
                        type="button"
                        className={`btn btn-xs ${customForm.baseUrl === p.baseUrl && customForm.model === p.model ? 'btn-primary' : 'btn-ghost border border-base-300'}`}
                        onClick={() => handleCustomPreset(p)}
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
                      value={customForm.apiKey}
                      onChange={(e) => setCustomForm((f) => ({ ...f, apiKey: e.target.value }))}
                    />
                  </label>

                  <label className="form-control gap-1">
                    <span className="text-xs text-base-content/60">Base URL</span>
                    <input
                      className="input input-bordered input-sm font-mono"
                      value={customForm.baseUrl}
                      onChange={(e) => setCustomForm((f) => ({ ...f, baseUrl: e.target.value }))}
                      required
                    />
                  </label>

                  <div className="flex gap-3">
                    <label className="form-control gap-1 flex-1">
                      <span className="text-xs text-base-content/60">Model</span>
                      <input
                        className="input input-bordered input-sm font-mono"
                        value={customForm.model}
                        onChange={(e) => setCustomForm((f) => ({ ...f, model: e.target.value }))}
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
                        value={customForm.dimensions}
                        onChange={(e) => setCustomForm((f) => ({ ...f, dimensions: parseInt(e.target.value, 10) || 1536 }))}
                        required
                      />
                    </label>
                  </div>
                </>
              )}

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
                  <button type="submit" className="btn btn-primary btn-sm" disabled={saving || (mode === 'credential' && !credForm.credentialId)}>
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
