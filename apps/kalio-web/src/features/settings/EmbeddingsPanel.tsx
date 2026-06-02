import { useState, useEffect, useCallback } from 'react';
import { Plus, Loader2, AlertCircle, Info } from 'lucide-react';
import type { EmbeddingCredential, CreateEmbeddingCredentialDto, EmbeddingStatus, UpdateLocalEmbeddingConfigDto } from '@kalio/types';
import { EmbeddingCredentialCard } from './EmbeddingCredentialCard';
import {
  EmbeddingProviderForm,
  PROVIDER_BASE_URLS,
  PROVIDER_DEFAULT_DIMS,
  PROVIDER_DEFAULT_MODELS,
  PROVIDER_LABELS,
  emptyForm,
  type AddForm,
} from './EmbeddingProviderForm';
import { LOCAL_BACKEND_LABELS, LocalEmbeddingConfigCard } from './LocalEmbeddingConfigCard';

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
  const [localForm, setLocalForm] = useState<UpdateLocalEmbeddingConfigDto>({
    enabled: true,
    model: 'Xenova/multilingual-e5-small',
    dimensions: 384,
    backend: 'cpu',
  });
  const [localDirty, setLocalDirty] = useState(false);
  const [reindexPersonaId, setReindexPersonaId] = useState('');
  const [reindexResult, setReindexResult] = useState<string | null>(null);

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
      setLocalForm({
        enabled: st.provider !== 'disabled',
        model: st.model || 'Xenova/multilingual-e5-small',
        dimensions: st.dimensions || 384,
        backend: 'cpu',
      });
      setLocalDirty(false);
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

  const saveLocalConfig = async () => {
    setSyncing('local');
    setError(null);
    try {
      const st = await apiFetch<EmbeddingStatus>('/memory/embedding-local', {
        method: 'PUT',
        body: JSON.stringify(localForm),
      });
      setStatus(st);
      setActiveId(st.activeCredentialId ?? null);
      setLocalDirty(false);
      setReindexResult('Settings saved. Run reindex to refresh existing memories.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save local embedding config');
    } finally {
      setSyncing(null);
    }
  };

  const reindexPersona = async () => {
    if (!reindexPersonaId.trim()) {
      setError('Enter persona id before reindexing');
      return;
    }
    setSyncing('reindex');
    setError(null);
    setReindexResult(null);
    try {
      const result = await apiFetch<{ count: number; model: string }>(`/memory/${encodeURIComponent(reindexPersonaId.trim())}/reembed`, { method: 'POST' });
      setReindexResult(`Reindexed ${result.count} memories`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to reindex memories');
    } finally {
      setSyncing(null);
    }
  };

  const activateLocalProvider = async () => {
    setSyncing('use-local');
    setError(null);
    try {
      const st = await apiFetch<EmbeddingStatus>('/memory/embedding-credentials/active', { method: 'DELETE' });
      setStatus(st);
      setActiveId(st.activeCredentialId ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to activate local embeddings');
    } finally {
      setSyncing(null);
    }
  };

  const reindexAll = async () => {
    setSyncing('reindex');
    setError(null);
    setReindexResult(null);
    try {
      const result = await apiFetch<{ personas: number; count: number; model: string }>('/memory/reembed-all', { method: 'POST' });
      setReindexResult(`Reindexed ${result.count} memories across ${result.personas} personas`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to reindex memories');
    } finally {
      setSyncing(null);
    }
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

  const testAddForm = () => {
    if (!form.apiKey && form.provider !== 'ollama') { setAddTestError('Enter API key before testing'); return; }
    if (!form.baseUrl) { setAddTestError('Enter Base URL before testing'); return; }
    setAddTestState('testing');
    setAddTestError(null);
    apiFetch<{ ok: boolean; error?: string }>('/memory/embedding-credentials/probe', {
      method: 'POST',
      body: JSON.stringify({
        name: form.name,
        provider: form.provider,
        apiKey: form.apiKey,
        baseUrl: form.baseUrl,
        model: form.model,
        dimensions: form.dimensions,
      }),
    }).then((r) => {
      setAddTestState(r.ok ? 'ok' : 'error');
      setAddTestError(r.error ?? null);
    }).catch((err) => {
      setAddTestState('error');
      setAddTestError(err instanceof Error ? err.message : 'Network error');
    });
  };

  return (
    <div className="flex flex-col gap-5" data-testid="embeddings-panel">
      <div>
        <h2 className="text-base font-semibold mb-1">Embeddings Provider</h2>
        <p className="text-xs text-base-content/60">
          Choose how Kalio powers memory and saved search recall.
          Local runs automatically; remote providers are optional.
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
            {credentials.length === 0 && !showForm && (
              <p className="text-xs text-base-content/40">No remote embedding providers configured. Local embeddings are used by default.</p>
            )}
            {credentials.map((cred) => (
              <EmbeddingCredentialCard
                key={cred.id}
                cred={cred}
                isActive={cred.id === activeId}
                providerLabel={PROVIDER_LABELS[cred.provider] ?? cred.provider}
                onActivate={() => void handleActivate(cred.id)}
                onRemove={() => void handleRemove(cred.id)}
                onTest={() => void handleTest(cred.id)}
                testState={testStates[cred.id] ?? 'idle'}
                testError={testErrors[cred.id] ?? null}
                syncing={syncing === cred.id}
              />
            ))}
          </div>

          {(status?.source === 'local' || status?.source === 'disabled' || status?.source === 'env') && !activeId && (
            <div className="border border-sky-500/20 bg-sky-500/5 rounded-lg p-3 flex flex-col gap-1" data-testid="embedding-env-card">
              <div className="flex items-center gap-2">
                <Info size={13} className="text-sky-400 shrink-0" />
                <span className="text-sm font-medium flex-1">{status.source === 'env' ? 'Env Provider' : 'Local embeddings'}</span>
                <span className={`badge badge-xs ${status.source === 'disabled' ? 'badge-warning' : 'badge-ghost'}`}>
                  {status.source === 'disabled' ? 'disabled' : 'active'}
                </span>
              </div>
              <div className="text-xs text-base-content/60 pl-5 flex flex-col gap-0.5">
                <span>Model: <span className="font-mono">{status.model}</span></span>
                {status.modelParameters && <span>Parameters: <span className="font-mono">{status.modelParameters}</span></span>}
                {status.backend && (
                  <span>
                    Compute: <span className="font-mono">{LOCAL_BACKEND_LABELS[status.backend] ?? status.backend}</span>
                    {status.activeBackend ? <span> / active <span className="font-mono">{LOCAL_BACKEND_LABELS[status.activeBackend] ?? status.activeBackend}</span></span> : null}
                  </span>
                )}
                {status.backend !== 'cpu' && status.gpuAvailable === false && (
                  <span>GPU unavailable on this machine; CPU will be used.</span>
                )}
              </div>
            </div>
          )}

          <LocalEmbeddingConfigCard
            form={localForm}
            dirty={localDirty}
            syncing={syncing}
            reindexPersonaId={reindexPersonaId}
            reindexResult={reindexResult}
            status={status}
            onChange={setLocalForm}
            onDirtyChange={setLocalDirty}
            onSave={() => void saveLocalConfig()}
            onUseLocal={() => void activateLocalProvider()}
            onReindex={() => void reindexPersona()}
            onReindexAll={() => void reindexAll()}
            onReindexPersonaChange={setReindexPersonaId}
          />

          {/* Add provider form */}
          {showForm ? (
            <EmbeddingProviderForm
              form={form}
              syncing={syncing === 'add'}
              addTestState={addTestState}
              addTestError={addTestError}
              onSubmit={(e) => void handleAdd(e)}
              onCancel={() => { setShowForm(false); setForm(emptyForm()); }}
              onFormChange={setForm}
              onProviderChange={handleProviderChange}
              onTest={testAddForm}
            />
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
            Saved search results and persona memories use the active provider. Reindex after changing providers to refresh existing recall.
          </p>
        </>
      )}
    </div>
  );
}
