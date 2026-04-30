import { useState, useEffect, useCallback } from 'react';
import { AlertCircle, Loader2, Check, Link, Settings, Info, Plus, Trash2, Zap } from 'lucide-react';
import type { Credential, EmbeddingStatus } from '@kalio/types';

// ── Constants ──────────────────────────────────────────────────────────────

/** Only these providers have a working /embeddings endpoint. */
const EMBEDDING_CAPABLE_PROVIDERS = new Set(['openai', 'cometapi', 'openrouter', 'ollama']);

const EMBEDDING_MODELS: Record<string, Array<{ model: string; dimensions: number }>> = {
  openai:     [{ model: 'text-embedding-3-small', dimensions: 1536 }, { model: 'text-embedding-3-large', dimensions: 3072 }],
  cometapi:   [{ model: 'text-embedding-3-small', dimensions: 1536 }, { model: 'text-embedding-3-large', dimensions: 3072 }],
  openrouter: [{ model: 'text-embedding-3-small', dimensions: 1536 }],
  ollama:     [{ model: 'nomic-embed-text', dimensions: 768 }, { model: 'mxbai-embed-large', dimensions: 1024 }],
};

const CUSTOM_PRESETS = [
  { label: 'OpenAI',       baseUrl: 'https://api.openai.com/v1',   model: 'text-embedding-3-small', dimensions: 1536 },
  { label: 'OpenAI large', baseUrl: 'https://api.openai.com/v1',   model: 'text-embedding-3-large', dimensions: 3072 },
  { label: 'CometAPI',     baseUrl: 'https://api.cometapi.com/v1', model: 'text-embedding-3-small', dimensions: 1536 },
  { label: 'Ollama',       baseUrl: 'http://localhost:11434/v1',    model: 'nomic-embed-text',       dimensions: 768 },
];

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

// ── Types ──────────────────────────────────────────────────────────────────

type ConfigMode = 'credential' | 'custom';

interface CredentialForm { credentialId: string; model: string; dimensions: number; }
interface CustomForm { baseUrl: string; apiKey: string; model: string; dimensions: number; }

// ── Component ──────────────────────────────────────────────────────────────

export function EmbeddingsPanel() {
  const [status, setStatus] = useState<EmbeddingStatus | null>(null);
  const [credentials, setCredentials] = useState<Credential[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [configMode, setConfigMode] = useState<ConfigMode>('credential');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [testState, setTestState] = useState<'idle' | 'testing' | 'ok' | 'error'>('idle');
  const [testMsg, setTestMsg] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);

  const [credForm, setCredForm] = useState<CredentialForm>({
    credentialId: '', model: 'text-embedding-3-small', dimensions: 1536,
  });
  const [customForm, setCustomForm] = useState<CustomForm>({
    baseUrl: 'https://api.openai.com/v1', apiKey: '', model: 'text-embedding-3-small', dimensions: 1536,
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
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const embeddingCapableCreds = credentials.filter((c) => EMBEDDING_CAPABLE_PROVIDERS.has(c.provider));
  const selectedCred = credentials.find((c) => c.id === credForm.credentialId);
  const modelSuggestions = selectedCred ? (EMBEDDING_MODELS[selectedCred.provider] ?? []) : [];

  const openForm = () => {
    setShowForm(true);
    setTestState('idle');
    setTestMsg(null);
    setConfirmRemove(false);
    if (embeddingCapableCreds.length > 0 && !credForm.credentialId) {
      const first = embeddingCapableCreds[0]!;
      const suggestions = EMBEDDING_MODELS[first.provider] ?? [];
      setCredForm({
        credentialId: first.id,
        model: suggestions[0]?.model ?? 'text-embedding-3-small',
        dimensions: suggestions[0]?.dimensions ?? 1536,
      });
    }
  };

  const handleCredentialChange = (credentialId: string) => {
    const cred = credentials.find((c) => c.id === credentialId);
    const suggestions = cred ? (EMBEDDING_MODELS[cred.provider] ?? []) : [];
    const first = suggestions[0];
    setCredForm({ credentialId, model: first?.model ?? 'text-embedding-3-small', dimensions: first?.dimensions ?? 1536 });
    setTestState('idle');
  };

  const handleTest = async () => {
    setTestState('testing');
    setTestMsg(null);
    try {
      const res = await apiFetch<{ ok: boolean; error?: string }>('/memory/test/embedding', { method: 'POST' });
      if (res.ok) { setTestState('ok'); setTestMsg('Connection successful'); }
      else { setTestState('error'); setTestMsg(res.error ?? 'Test failed'); }
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
      if (configMode === 'credential') {
        updated = await apiFetch<EmbeddingStatus>('/memory/config/embedding/from-credential', {
          method: 'PUT',
          body: JSON.stringify({ credentialId: credForm.credentialId, model: credForm.model, dimensions: credForm.dimensions }),
        });
      } else {
        updated = await apiFetch<EmbeddingStatus>('/memory/config/embedding', {
          method: 'PUT',
          body: JSON.stringify({ baseUrl: customForm.baseUrl, apiKey: customForm.apiKey || undefined, model: customForm.model, dimensions: customForm.dimensions }),
        });
      }
      setStatus(updated);
      setShowForm(false);
      setTestState('idle');
      setTestMsg(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const handleRemove = async () => {
    setRemoving(true);
    setError(null);
    try {
      const updated = await apiFetch<EmbeddingStatus>('/memory/config/embedding', { method: 'DELETE' });
      setStatus(updated);
      setConfirmRemove(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to remove');
    } finally {
      setRemoving(false);
    }
  };

  return (
    <div className="flex flex-col gap-5" data-testid="embeddings-panel">
      <div>
        <h2 className="text-base font-semibold mb-1">Embeddings Provider</h2>
        <p className="text-xs text-base-content/60">
          Configure the embedding model used for semantic memory search.
          Supports OpenAI, CometAPI, OpenRouter, and Ollama.
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
          {/* DB-configured card */}
          {status?.source === 'db' && (
            <div className="border border-sky-500/30 bg-sky-500/5 rounded-lg p-3 flex flex-col gap-2" data-testid="embedding-configured-card">
              <div className="flex items-center gap-2">
                <Check size={14} className="text-sky-400 shrink-0" />
                <span className="text-sm font-medium flex-1">
                  {status.credentialName ? `Linked to "${status.credentialName}"` : 'Custom endpoint'}
                </span>
                <span className="badge badge-info badge-xs">active</span>
              </div>
              <div className="text-xs text-base-content/60 pl-5 flex flex-col gap-0.5">
                <span>Model: <span className="font-mono">{status.model}</span></span>
                <span>Dimensions: <span className="font-mono">{status.dimensions}</span></span>
                <span>Endpoint: <span className="font-mono">{status.baseUrlMasked}</span></span>
              </div>
              <div className="flex items-center gap-2 pl-5 pt-1 flex-wrap">
                <button
                  className={`btn btn-xs gap-1 ${testState === 'ok' ? 'btn-success' : testState === 'error' ? 'btn-error btn-outline' : 'btn-outline btn-primary'}`}
                  onClick={() => void handleTest()}
                  disabled={testState === 'testing'}
                  data-testid="embedding-test-btn"
                >
                  {testState === 'testing' ? <Loader2 size={11} className="animate-spin" /> : <Zap size={11} />}
                  {testState === 'ok' ? 'OK!' : testState === 'error' ? 'Failed' : 'Test'}
                </button>
                {testMsg && <span className={`text-xs ${testState === 'ok' ? 'text-success' : 'text-error'}`}>{testMsg}</span>}
                <div className="flex-1" />
                <button className="btn btn-ghost btn-xs text-base-content/50 hover:text-sky-300" onClick={openForm}>
                  Reconfigure
                </button>
                {confirmRemove ? (
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-warning">Remove?</span>
                    <button className="btn btn-xs btn-error" disabled={removing} onClick={() => void handleRemove()}>
                      {removing ? <Loader2 size={11} className="animate-spin" /> : 'Yes'}
                    </button>
                    <button className="btn btn-xs btn-ghost" onClick={() => setConfirmRemove(false)}>No</button>
                  </div>
                ) : (
                  <button className="btn btn-ghost btn-xs gap-1 text-base-content/40 hover:text-error" onClick={() => setConfirmRemove(true)} data-testid="embedding-remove-btn">
                    <Trash2 size={12} /> Remove
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Env card */}
          {status?.source === 'env' && !showForm && (
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
                Configured via environment variables. Configure below to override with a DB credential.
              </p>
            </div>
          )}

          {/* Not configured */}
          {status?.source === 'mock' && !showForm && (
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

          {/* Configure form */}
          {showForm ? (
            <form
              className="flex flex-col gap-4 border border-base-300 rounded-lg p-4 bg-base-200/40"
              onSubmit={(e) => void handleSave(e)}
              data-testid="embedding-config-form"
            >
              <h3 className="text-sm font-semibold">Configure Embedding Provider</h3>

              <div className="flex gap-1 p-1 bg-base-300/50 rounded-lg w-fit">
                <button type="button" className={`btn btn-xs gap-1 ${configMode === 'credential' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setConfigMode('credential')}>
                  <Link size={12} /> From existing provider
                </button>
                <button type="button" className={`btn btn-xs gap-1 ${configMode === 'custom' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setConfigMode('custom')}>
                  <Settings size={12} /> Custom endpoint
                </button>
              </div>

              {configMode === 'credential' ? (
                embeddingCapableCreds.length === 0 ? (
                  <div className="text-xs text-warning/80 flex items-start gap-2">
                    <AlertCircle size={13} className="mt-0.5 shrink-0" />
                    <span>
                      No embedding-capable credentials found. Add an <strong>OpenAI</strong>, <strong>CometAPI</strong>,{' '}
                      <strong>OpenRouter</strong>, or <strong>Ollama</strong> provider in the LLM Providers tab first.
                    </span>
                  </div>
                ) : (
                  <>
                    <label className="form-control gap-1">
                      <span className="text-xs text-base-content/60">Select provider</span>
                      <select
                        className="select select-bordered select-sm"
                        value={credForm.credentialId}
                        onChange={(e) => handleCredentialChange(e.target.value)}
                        required
                      >
                        <option value="" disabled>pick a credential</option>
                        {embeddingCapableCreds.map((c) => (
                          <option key={c.id} value={c.id}>{c.name} ({c.provider})</option>
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
                        <input className="input input-bordered input-sm font-mono" value={credForm.model} onChange={(e) => setCredForm((f) => ({ ...f, model: e.target.value }))} required />
                      </label>
                      <label className="form-control gap-1 w-28">
                        <span className="text-xs text-base-content/60">Dimensions</span>
                        <input className="input input-bordered input-sm font-mono" type="number" min={64} max={4096} value={credForm.dimensions} onChange={(e) => setCredForm((f) => ({ ...f, dimensions: parseInt(e.target.value, 10) || 1536 }))} required />
                      </label>
                    </div>
                  </>
                )
              ) : (
                <>
                  <div className="flex gap-2 flex-wrap">
                    {CUSTOM_PRESETS.map((p) => (
                      <button
                        key={`${p.label}-${p.model}`}
                        type="button"
                        className={`btn btn-xs ${customForm.baseUrl === p.baseUrl && customForm.model === p.model ? 'btn-primary' : 'btn-ghost border border-base-300'}`}
                        onClick={() => setCustomForm((f) => ({ ...f, baseUrl: p.baseUrl, model: p.model, dimensions: p.dimensions }))}
                      >
                        {p.label}
                      </button>
                    ))}
                  </div>

                  <label className="form-control gap-1">
                    <span className="text-xs text-base-content/60">API Key <span className="text-base-content/40">(leave blank to keep existing)</span></span>
                    <input className="input input-bordered input-sm font-mono" type="password" placeholder="sk-..." value={customForm.apiKey} onChange={(e) => setCustomForm((f) => ({ ...f, apiKey: e.target.value }))} />
                  </label>

                  <label className="form-control gap-1">
                    <span className="text-xs text-base-content/60">Base URL</span>
                    <input className="input input-bordered input-sm font-mono" value={customForm.baseUrl} onChange={(e) => setCustomForm((f) => ({ ...f, baseUrl: e.target.value }))} required />
                  </label>

                  <div className="flex gap-3">
                    <label className="form-control gap-1 flex-1">
                      <span className="text-xs text-base-content/60">Model</span>
                      <input className="input input-bordered input-sm font-mono" value={customForm.model} onChange={(e) => setCustomForm((f) => ({ ...f, model: e.target.value }))} required />
                    </label>
                    <label className="form-control gap-1 w-28">
                      <span className="text-xs text-base-content/60">Dimensions</span>
                      <input className="input input-bordered input-sm font-mono" type="number" min={64} max={4096} value={customForm.dimensions} onChange={(e) => setCustomForm((f) => ({ ...f, dimensions: parseInt(e.target.value, 10) || 1536 }))} required />
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
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setShowForm(false); setTestState('idle'); setTestMsg(null); }}>Cancel</button>
                  <button
                    type="submit"
                    className="btn btn-primary btn-sm"
                    disabled={saving || (configMode === 'credential' && (!credForm.credentialId || embeddingCapableCreds.length === 0))}
                    data-testid="embedding-save-btn"
                  >
                    {saving ? <Loader2 size={14} className="animate-spin" /> : null}
                    Save
                  </button>
                </div>
              </div>
            </form>
          ) : (
            status?.source !== 'db' && (
              <button className="btn btn-ghost btn-sm gap-2 self-start text-sky-400 hover:text-sky-300" onClick={openForm} data-testid="configure-embedding-btn">
                <Plus size={14} />
                {status?.source === 'env' ? 'Override with DB config' : 'Configure provider'}
              </button>
            )
          )}

          <p className="text-xs text-base-content/40 border-t border-base-300 pt-3">
            Tip: You can also set <code className="font-mono">EMBEDDING_BASE_URL</code> and{' '}
            <code className="font-mono">EMBEDDING_API_KEY</code> in <code className="font-mono">.env</code>.
            DB settings configured here take precedence.
          </p>
        </>
      )}
    </div>
  );
}
