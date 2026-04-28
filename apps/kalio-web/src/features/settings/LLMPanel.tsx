import { useState, useEffect, useCallback } from 'react';
import { Plus, Loader2, AlertCircle, Zap } from 'lucide-react';
import type { Credential, CreateCredentialDto } from '@kalio/types';
import { useSettingsStore } from './settingsStore';
import { ProviderCard } from './ProviderCard';
import { ModelSettingsSection } from './ModelSettingsSection';

const PROVIDER_LABELS: Record<string, string> = {
  openai:     'OpenAI',
  xiaomimimo: 'Xiaomi MiMo',
  deepseek:   'DeepSeek',
  cometapi:   'CometAPI',
  openrouter: 'OpenRouter',
  ollama:     'Ollama',
  custom:     'Custom',
};

const PROVIDER_BASE_URLS: Record<string, string> = {
  openai:     'https://api.openai.com/v1',
  xiaomimimo: 'https://token-plan-ams.xiaomimimo.com/v1',
  deepseek:   'https://api.deepseek.com/v1',
  cometapi:   'https://api.cometapi.com/v1',
  openrouter: 'https://openrouter.ai/api/v1',
  ollama:     'http://localhost:11434/v1',
  custom:     '',
};

const PROVIDER_DEFAULT_MODELS: Record<string, string> = {
  openai:     'gpt-4o-mini',
  xiaomimimo: 'mimo-v2-omni',
  deepseek:   'deepseek-reasoner',
  cometapi:   'gpt-4o-mini',
  openrouter: 'openai/gpt-4o-mini',
  ollama:     'llama3.2',
  custom:     '',
};

const ALL_PROVIDER_TYPES = ['openai', 'xiaomimimo', 'deepseek', 'cometapi', 'openrouter', 'ollama', 'custom'];

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

interface AddForm {
  name: string;
  provider: string;
  apiKey: string;
  baseUrl: string;
  model: string;
  nameEdited?: boolean;
}

function emptyForm(): AddForm {
  return {
    name: PROVIDER_LABELS['openai'] ?? '',
    provider: 'openai',
    apiKey: '',
    baseUrl: PROVIDER_BASE_URLS['openai'] ?? '',
    model: PROVIDER_DEFAULT_MODELS['openai'] ?? '',
    nameEdited: false,
  };
}

export function LLMPanel() {
  const [credentials, setCredentials] = useState<Credential[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [contextWindow, setContextWindow] = useState(32000);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<AddForm>(emptyForm());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState<string | null>(null);
  const [testState, setTestState] = useState<'idle' | 'testing' | 'ok' | 'error'>('idle');
  const [testError, setTestError] = useState<string | null>(null);

  const setBackendConfig = useSettingsStore((s) => s.setBackendConfig);

  const refreshBackendConfig = useCallback(async () => {
    try {
      const cfg = await apiFetch<{ provider: string; model: string; baseUrl: string; contextWindowSize: number }>('/llm/config');
      setBackendConfig(cfg);
    } catch { /* non-fatal */ }
  }, [setBackendConfig]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [creds, active, cw] = await Promise.all([
        apiFetch<Credential[]>('/credentials'),
        apiFetch<{ credentialId: string | null }>('/credentials/active'),
        apiFetch<{ size: number }>('/credentials/settings/context-window'),
      ]);
      setCredentials(creds);
      setActiveId(active.credentialId);
      setContextWindow(cw.size);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const handleProviderChange = (provider: string) => {
    setForm((f) => ({
      ...f,
      provider,
      baseUrl: PROVIDER_BASE_URLS[provider] ?? '',
      model: PROVIDER_DEFAULT_MODELS[provider] ?? '',
      name: f.nameEdited ? f.name : (PROVIDER_LABELS[provider] || ''),
    }));
    setTestState('idle');
    setTestError(null);
  };

  const handleTest = async () => {
    setTestState('testing');
    setTestError(null);
    try {
      const params = new URLSearchParams({ provider: form.provider });
      if (form.apiKey) params.set('apiKey', form.apiKey);
      if (form.baseUrl) params.set('baseUrl', form.baseUrl);
      const res = await fetch(`/api/llm/models?${params.toString()}`);
      if (!res.ok) {
        const errJson = await res.json().catch(() => null) as { error?: string } | null;
        throw new Error(errJson?.error ?? `HTTP ${res.status}`);
      }
      const json = await res.json() as { data?: unknown[]; models?: unknown[] };
      const count = (json.data ?? json.models ?? []).length;
      setTestState('ok');
      setTestError(`${count} models available`);
    } catch (e) {
      setTestState('error');
      setTestError(e instanceof Error ? e.message : 'Network error');
    }
  };

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      const dto: CreateCredentialDto = {
        name: form.name,
        provider: form.provider,
        apiKey: form.apiKey,
        baseUrl: form.baseUrl || undefined,
        model: form.model || undefined,
      };
      const created = await apiFetch<Credential>('/credentials', {
        method: 'POST',
        body: JSON.stringify(dto),
      });
      setCredentials((prev) => [...prev, created]);
      setForm(emptyForm());
      setShowForm(false);
      setTestState('idle');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add');
    }
  };

  const handleActivate = async (credentialId: string) => {
    setSyncing(credentialId);
    try {
      await apiFetch(`/credentials/active/${credentialId}`, { method: 'PUT' });
      setActiveId(credentialId);
      await refreshBackendConfig();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to activate');
    } finally {
      setSyncing(null);
    }
  };

  const handleRemove = async (credentialId: string) => {
    setSyncing(credentialId);
    try {
      await apiFetch(`/credentials/${credentialId}`, { method: 'DELETE' });
      setCredentials((prev) => prev.filter((c) => c.id !== credentialId));
      if (activeId === credentialId) {
        setActiveId(null);
        await refreshBackendConfig();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to remove');
    } finally {
      setSyncing(null);
    }
  };

  const handleContextWindowChange = async (size: number) => {
    setContextWindow(size);
    try {
      await apiFetch('/credentials/settings/context-window', {
        method: 'PUT',
        body: JSON.stringify({ size }),
      });
      await refreshBackendConfig();
    } catch { /* non-fatal */ }
  };

  return (
    <div className="flex flex-col gap-5" data-testid="llm-panel">
      <div>
        <h2 className="text-base font-semibold mb-1">LLM Providers</h2>
        <p className="text-xs text-base-content/60">
          Configure one or more API credentials. The active provider is stored in the database.
          API keys are write-only and never returned.
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
          <Loader2 size={14} className="animate-spin" /> Loading credentials…
        </div>
      ) : (
        <>
          {credentials.length > 0 && (
            <div className="flex flex-col gap-2">
              {credentials.map((c) => (
                <ProviderCard
                  key={c.id}
                  credential={c}
                  isActive={c.id === activeId}
                  isSyncing={syncing === c.id}
                  onActivate={(id) => void handleActivate(id)}
                  onRemove={(id) => void handleRemove(id)}
                />
              ))}
            </div>
          )}

          {credentials.length === 0 && !showForm && (
            <div className="text-sm text-base-content/50 italic text-center py-6">
              No credentials configured. Add one below.
            </div>
          )}

          {showForm ? (
            <form
              className="flex flex-col gap-3 border border-base-300 rounded-lg p-4 bg-base-200/40"
              onSubmit={(e) => void handleAdd(e)}
              data-testid="add-provider-form"
            >
              <h3 className="text-sm font-semibold">Add Provider</h3>

              <label className="form-control gap-1">
                <span className="text-xs text-base-content/60">Name <span className="text-base-content/40">(optional — defaults to provider)</span></span>
                <input
                  className="input input-bordered input-sm"
                  placeholder="e.g. My OpenAI Key"
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value, nameEdited: true }))}
                  required
                />
              </label>

              <div className="flex gap-2 flex-wrap">
                {ALL_PROVIDER_TYPES.map((t) => (
                  <button
                    key={t}
                    type="button"
                    className={`btn btn-xs ${form.provider === t ? 'btn-primary' : 'btn-ghost border border-base-300'}`}
                    onClick={() => handleProviderChange(t)}
                  >
                    {PROVIDER_LABELS[t]}
                  </button>
                ))}
              </div>

              <label className="form-control gap-1">
                <span className="text-xs text-base-content/60">API Key</span>
                <input
                  className="input input-bordered input-sm font-mono"
                  type="password"
                  placeholder="sk-…"
                  value={form.apiKey}
                  onChange={(e) => setForm((f) => ({ ...f, apiKey: e.target.value }))}
                  data-testid="add-provider-apikey"
                  required
                />
              </label>

              <label className="form-control gap-1">
                <span className="text-xs text-base-content/60">Base URL</span>
                <input
                  className="input input-bordered input-sm font-mono"
                  value={form.baseUrl}
                  onChange={(e) => setForm((f) => ({ ...f, baseUrl: e.target.value }))}
                />
              </label>

              <label className="form-control gap-1">
                <span className="text-xs text-base-content/60">Model</span>
                <input
                  className="input input-bordered input-sm font-mono"
                  value={form.model}
                  onChange={(e) => setForm((f) => ({ ...f, model: e.target.value }))}
                  data-testid="add-provider-model"
                />
              </label>

              {testError && (
                <div className={`text-xs flex gap-1 items-center ${testState === 'ok' ? 'text-success' : 'text-error'}`}>
                  <AlertCircle size={12} /> {testError}
                </div>
              )}

              <div className="flex gap-2 items-center justify-between">
                <button
                  type="button"
                  className={`btn btn-ghost btn-xs gap-1 ${testState === 'ok' ? 'text-success' : testState === 'error' ? 'text-error' : 'text-base-content/60'}`}
                  onClick={() => void handleTest()}
                  disabled={!form.apiKey || testState === 'testing'}
                  data-testid="add-provider-test"
                >
                  {testState === 'testing' ? <Loader2 size={12} className="animate-spin" /> : <Zap size={12} />}
                  {testState === 'ok' ? 'Connected!' : testState === 'error' ? 'Failed' : 'Test'}
                </button>
                <div className="flex gap-2">
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setShowForm(false); setTestState('idle'); }}>Cancel</button>
                  <button type="submit" className="btn btn-primary btn-sm" data-testid="add-provider-submit">Add Provider</button>
                </div>
              </div>
            </form>
          ) : (
            <button
              className="btn btn-ghost btn-sm gap-2 self-start text-sky-400 hover:text-sky-300"
              onClick={() => setShowForm(true)}
              data-testid="add-provider-btn"
            >
              <Plus size={14} /> Add Provider
            </button>
          )}
        </>
      )}

      {/* Model + Generation settings */}
      <ModelSettingsSection
        activeCredential={credentials.find((c) => c.id === activeId) ?? null}
        onModelChange={(updated) => setCredentials((prev) => prev.map((c) => c.id === updated.id ? updated : c))}
      />

      {/* Context window */}
      <div className="border-t border-base-300 pt-4">
        <h3 className="text-sm font-semibold mb-1">Context Window</h3>
        <p className="text-xs text-base-content/60 mb-3">
          Oldest messages are trimmed automatically when history exceeds this limit.
          Stored in the backend.
        </p>
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs text-base-content/60">Max tokens</span>
          <span className="badge badge-neutral font-mono text-xs" data-testid="context-window-value">
            {(contextWindow / 1000).toFixed(0)}k
          </span>
        </div>
        <input
          type="range"
          className="range range-sm range-primary w-full"
          min={4000}
          max={200000}
          step={4000}
          value={contextWindow}
          onChange={(e) => void handleContextWindowChange(parseInt(e.target.value, 10))}
          data-testid="context-window-slider"
        />
        <div className="flex justify-between text-[10px] text-base-content/40 mt-1 px-1">
          <span>4k</span><span>32k</span><span>128k</span><span>200k</span>
        </div>
      </div>
    </div>
  );
}
