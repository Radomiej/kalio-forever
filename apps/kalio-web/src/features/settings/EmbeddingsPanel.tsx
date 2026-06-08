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
import { LOCAL_BACKEND_LABELS, LOCAL_MODELS, LocalEmbeddingConfigCard } from './LocalEmbeddingConfigCard';

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

const LOCAL_MODEL_BY_ID = new Map<string, (typeof LOCAL_MODELS)[number]>(
  LOCAL_MODELS.map((item) => [item.model, item]),
);
const DEFAULT_LOCAL_MODEL = LOCAL_MODELS[0];

function normalizeLocalConfig(localCfg: UpdateLocalEmbeddingConfigDto) {
  const supportedModel = LOCAL_MODEL_BY_ID.get(localCfg.model);
  if (supportedModel) {
    return { form: localCfg, warning: null as string | null };
  }

  return {
    form: {
      ...localCfg,
      model: DEFAULT_LOCAL_MODEL.model,
      dimensions: DEFAULT_LOCAL_MODEL.dimensions,
    },
    warning: `Saved local model ${localCfg.model} is not supported for local embeddings. Pick a supported local model and apply the settings.`,
  };
}

// ── EmbeddingsPanel ────────────────────────────────────────────────────────

export function EmbeddingsPanel() {
  type LocalEmbeddingAvailability = {
    status: 'missing' | 'installing' | 'ready' | 'error';
    installed: boolean;
    model: string;
    dimensions: number;
    backend: UpdateLocalEmbeddingConfigDto['backend'];
    message: string | null;
  };
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
  const [localTestState, setLocalTestState] = useState<'idle' | 'testing' | 'ok' | 'error'>('idle');
  const [localTestMessage, setLocalTestMessage] = useState<string | null>(null);
  const [localConfigWarning, setLocalConfigWarning] = useState<string | null>(null);
  const [localAvailability, setLocalAvailability] = useState<LocalEmbeddingAvailability | null>(null);
  const [localForm, setLocalForm] = useState<UpdateLocalEmbeddingConfigDto>({
    enabled: true,
    model: 'Xenova/multilingual-e5-small',
    dimensions: 384,
    backend: 'cpu',
  });
  const [localDirty, setLocalDirty] = useState(false);
  const [reindexResult, setReindexResult] = useState<string | null>(null);

  const refreshLocalAvailability = useCallback(async (config?: UpdateLocalEmbeddingConfigDto) => {
    if (config) {
      return apiFetch<LocalEmbeddingAvailability>('/memory/embedding-local/availability', {
        method: 'POST',
        body: JSON.stringify(config),
      });
    }
    return apiFetch<LocalEmbeddingAvailability>('/memory/embedding-local/availability');
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [creds, st, localCfg] = await Promise.all([
        apiFetch<EmbeddingCredential[]>('/memory/embedding-credentials'),
        apiFetch<EmbeddingStatus>('/memory/status/embedding'),
        apiFetch<UpdateLocalEmbeddingConfigDto>('/memory/embedding-local'),
      ]);
      const normalizedLocal = normalizeLocalConfig(localCfg);
      const availability = await refreshLocalAvailability(normalizedLocal.form);
      setCredentials(creds);
      setStatus(st);
      setActiveId(st.activeCredentialId ?? null);
      setLocalForm(normalizedLocal.form);
      setLocalDirty(Boolean(normalizedLocal.warning));
      setLocalConfigWarning(normalizedLocal.warning);
      setLocalAvailability(availability);
      setLocalTestState('idle');
      setLocalTestMessage(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [refreshLocalAvailability]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (localAvailability?.status !== 'installing') {
      return;
    }
    const handle = window.setTimeout(() => {
      refreshLocalAvailability(localForm)
        .then((availability) => {
          setLocalAvailability(availability);
        })
        .catch(() => {
          // keep current installing state until the next explicit action
        });
    }, 1200);
    return () => window.clearTimeout(handle);
  }, [localAvailability, localForm, refreshLocalAvailability]);

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
      setLocalForm(localForm);
      setLocalDirty(false);
      setLocalConfigWarning(null);
      setLocalAvailability(await refreshLocalAvailability(localForm));
      setReindexResult('Settings saved. Run reindex to refresh existing memories.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save local embedding config');
    } finally {
      setSyncing(null);
    }
  };

  const activateLocalProvider = async () => {
    setSyncing('use-local');
    setError(null);
    try {
      if (localDirty) {
        const savedStatus = await apiFetch<EmbeddingStatus>('/memory/embedding-local', {
          method: 'PUT',
          body: JSON.stringify(localForm),
        });
        setStatus(savedStatus);
        setActiveId(savedStatus.activeCredentialId ?? null);
        setLocalDirty(false);
        setLocalConfigWarning(null);
        setLocalAvailability(await refreshLocalAvailability(localForm));
      }
      const availability = await refreshLocalAvailability(localForm);
      setLocalAvailability(availability);
      if (availability.status !== 'ready') {
        setError(
          availability.status === 'installing'
            ? 'Local model is still installing. Wait for installation to finish before using local embeddings.'
            : 'Local model is not installed yet. Install the selected local model before using local embeddings.',
        );
        return;
      }
      const st = await apiFetch<EmbeddingStatus>('/memory/embedding-credentials/active', { method: 'DELETE' });
      setStatus(st);
      setActiveId(st.activeCredentialId ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to activate local embeddings');
    } finally {
      setSyncing(null);
    }
  };

  const testLocalProvider = async () => {
    setLocalTestState('testing');
    setLocalTestMessage(null);
    try {
      const result = await apiFetch<{ ok: boolean; error?: string; model: string; dimensions: number; backend: string }>('/memory/embedding-local/test', {
        method: 'POST',
        body: JSON.stringify(localForm),
      });
      if (result.ok) {
        setLocalTestState('ok');
        setLocalTestMessage(`Local embedding ready: ${result.model} (${result.dimensions}d, ${result.backend})`);
      } else {
        setLocalTestState('error');
        setLocalTestMessage(result.error ?? 'Local embedding test failed');
      }
    } catch (err) {
      setLocalTestState('error');
      setLocalTestMessage(err instanceof Error ? err.message : 'Local embedding test failed');
    }
  };

  const installLocalProvider = async () => {
    setSyncing('install-local');
    setError(null);
    setLocalTestState('idle');
    setLocalTestMessage(null);
    try {
      const result = await apiFetch<LocalEmbeddingAvailability>('/memory/embedding-local/install', {
        method: 'POST',
        body: JSON.stringify(localForm),
      });
      setLocalAvailability(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to install local model');
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
            reindexResult={reindexResult}
              status={status}
              localTestState={localTestState}
              localTestMessage={localTestMessage}
              localConfigWarning={localConfigWarning}
              localAvailability={localAvailability}
              onChange={setLocalForm}
              onDirtyChange={(dirty) => {
                setLocalDirty(dirty);
                setLocalAvailability(null);
                setLocalTestState('idle');
                setLocalTestMessage(null);
              }}
              onSave={() => void saveLocalConfig()}
              onInstall={() => void installLocalProvider()}
              onTest={() => void testLocalProvider()}
              onUseLocal={() => void activateLocalProvider()}
              onReindexAll={() => void reindexAll()}
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
