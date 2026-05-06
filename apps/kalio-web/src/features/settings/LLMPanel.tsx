import { useState, useEffect, useCallback, useRef } from 'react';
import { Plus, Loader2, AlertCircle, Zap, Info } from 'lucide-react';
import type { Credential, CreateCredentialDto } from '@kalio/types';
import { useSettingsStore } from './settingsStore';
import { ProviderCard } from './ProviderCard';
import { ModelSettingsSection } from './ModelSettingsSection';
import { ToolTimeoutsSection } from './ToolTimeoutsSection';
import {
  ALL_PROVIDER_TYPES,
  isLocalLlmProviderConfig,
  PROVIDER_BASE_URLS,
  PROVIDER_DEFAULT_MODELS,
  PROVIDER_LABELS,
} from './llm-provider-settings';
import {
  DEFAULT_TOOL_TIMEOUT_SETTINGS,
  normalizeToolTimeout,
  type ToolTimeoutKey,
  type ToolTimeoutSettings,
} from './tool-timeout-settings';

interface LLMConfigWithSource {
  provider: string;
  model: string;
  baseUrl: string;
  contextWindowSize: number;
  maxToolAttempts: number;
  source: 'db' | 'env';
}

async function readResponseErrorMessage(res: Response, context: string): Promise<string> {
  const body = await res.text();
  if (!body) {
    return res.statusText ? `HTTP ${res.status}: ${res.statusText}` : `HTTP ${res.status}`;
  }

  const contentType = res.headers.get('content-type') ?? '';
  const looksLikeJson = contentType.toLowerCase().includes('application/json');

  if (!looksLikeJson) {
    return `HTTP ${res.status}: ${body}`;
  }

  try {
    const parsed = JSON.parse(body) as { error?: unknown; message?: unknown };
    if (typeof parsed.error === 'string' && parsed.error.trim().length > 0) {
      return parsed.error;
    }
    if (typeof parsed.message === 'string' && parsed.message.trim().length > 0) {
      return parsed.message;
    }
  } catch (err) {
    console.error(
      `[LLMPanel] Failed to parse ${context} error body`,
      err instanceof Error ? err : new Error(String(err)),
    );
  }

  return `HTTP ${res.status}: ${body}`;
}

async function apiFetch<T>(path: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  });
  if (!res.ok) {
    throw new Error(await readResponseErrorMessage(res, `apiFetch(${path})`));
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
  const [maxToolAttempts, setMaxToolAttempts] = useState(8);
  const [toolTimeouts, setToolTimeouts] = useState<ToolTimeoutSettings>(DEFAULT_TOOL_TIMEOUT_SETTINGS);
  const [envConfig, setEnvConfig] = useState<LLMConfigWithSource | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<AddForm>(emptyForm());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState<string | null>(null);
  const [testState, setTestState] = useState<'idle' | 'testing' | 'ok' | 'error'>('idle');
  const [testError, setTestError] = useState<string | null>(null);
  const persistedContextWindow = useRef(32000);
  const persistedMaxToolAttempts = useRef(8);
  const persistedToolTimeouts = useRef<ToolTimeoutSettings>({ ...DEFAULT_TOOL_TIMEOUT_SETTINGS });

  const setBackendConfig = useSettingsStore((s) => s.setBackendConfig);
  const allowsKeylessAuth = isLocalLlmProviderConfig(form.provider, form.baseUrl);

  const reportUpdateError = useCallback((message: string, err: unknown) => {
    const error = err instanceof Error ? err : new Error(String(err));
    console.error(`[LLMPanel] ${message}`, error);
    setError(message);
  }, []);

  const refreshBackendConfig = useCallback(async () => {
    try {
      const cfg = await apiFetch<{ provider: string; model: string; baseUrl: string; contextWindowSize: number; maxToolAttempts: number }>('/llm/config');
      setBackendConfig(cfg);
      setMaxToolAttempts(cfg.maxToolAttempts ?? 8);
    } catch { /* non-fatal */ }
  }, [setBackendConfig]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [creds, active, cw, toolTimeouts, llmCfg] = await Promise.all([
        apiFetch<Credential[]>('/credentials'),
        apiFetch<{ credentialId: string | null }>('/credentials/active'),
        apiFetch<{ size: number }>('/credentials/settings/context-window'),
        apiFetch<ToolTimeoutSettings>('/credentials/settings/tool-timeouts'),
        apiFetch<LLMConfigWithSource>('/llm/config'),
      ]);
      setCredentials(creds);
      setActiveId(active.credentialId);
      setContextWindow(cw.size);
      persistedContextWindow.current = cw.size;
      setToolTimeouts(toolTimeouts);
      persistedToolTimeouts.current = toolTimeouts;
      setEnvConfig(llmCfg);
      setMaxToolAttempts(llmCfg.maxToolAttempts ?? 8);
      persistedMaxToolAttempts.current = llmCfg.maxToolAttempts ?? 8;
      setBackendConfig(llmCfg);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [setBackendConfig]);

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
        throw new Error(await readResponseErrorMessage(res, 'provider test'));
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
        apiKey: form.apiKey || undefined,
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
    const previousValue = persistedContextWindow.current;
    setContextWindow(size);
    try {
      await apiFetch('/credentials/settings/context-window', {
        method: 'PUT',
        body: JSON.stringify({ size }),
      });
      persistedContextWindow.current = size;
      await refreshBackendConfig();
    } catch (err) {
      reportUpdateError('Failed to update context window', err);
      setContextWindow(previousValue);
    }
  };

  const handleMaxToolAttemptsChange = async (size: number) => {
    const normalized = Math.max(1, Math.min(100, Math.round(size)));
    const previousValue = persistedMaxToolAttempts.current;
    setMaxToolAttempts(normalized);
    try {
      await apiFetch('/credentials/settings/max-tool-attempts', {
        method: 'PUT',
        body: JSON.stringify({ size: normalized }),
      });
      persistedMaxToolAttempts.current = normalized;
      await refreshBackendConfig();
    } catch (err) {
      reportUpdateError('Failed to update max tool attempts', err);
      setMaxToolAttempts(previousValue);
    }
  };

  const handleToolTimeoutInputChange = (key: ToolTimeoutKey, value: number) => {
    const normalized = normalizeToolTimeout(key, value);
    setToolTimeouts((current) => ({ ...current, [key]: normalized }));
  };

  const commitToolTimeoutChange = async (key: ToolTimeoutKey, value: number) => {
    const normalized = normalizeToolTimeout(key, value);
    const previousValue = persistedToolTimeouts.current[key];
    if (normalized === previousValue) return;

    try {
      await apiFetch('/credentials/settings/tool-timeouts', {
        method: 'PUT',
        body: JSON.stringify({ [key]: normalized }),
      });
      persistedToolTimeouts.current = { ...persistedToolTimeouts.current, [key]: normalized };
    } catch (err) {
      reportUpdateError('Failed to update tool timeout', err);
      setToolTimeouts((current) => ({ ...current, [key]: previousValue }));
    }
  };

  return (
    <div className="flex flex-col gap-5" data-testid="llm-panel">
      <div>
        <h2 className="text-base font-semibold mb-1">LLM Settings</h2>
        <p className="text-xs text-base-content/60">
          Configure model behavior, runtime limits, and provider credentials.
          Active provider selection is stored in the database, and API keys remain write-only.
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
            <>
              {envConfig && envConfig.source === 'env' && envConfig.model && envConfig.model !== 'mock' ? (
                <div className="border border-base-300 rounded-lg p-3 bg-base-200/40 flex flex-col gap-1" data-testid="env-provider-card">
                  <div className="flex items-center gap-2">
                    <Info size={13} className="text-sky-400 shrink-0" />
                    <span className="text-xs font-semibold text-base-content/80">Env Provider (read-only)</span>
                    <span className="badge badge-ghost badge-xs ml-auto">active</span>
                  </div>
                  <div className="text-xs text-base-content/60 pl-5 space-y-0.5">
                    <div>Provider: <span className="font-mono text-base-content/80">{PROVIDER_LABELS[envConfig.provider] ?? envConfig.provider}</span></div>
                    <div>Model: <span className="font-mono text-base-content/80">{envConfig.model}</span></div>
                    {envConfig.baseUrl && <div>Base URL: <span className="font-mono text-base-content/80">{envConfig.baseUrl}</span></div>}
                  </div>
                  <p className="text-[10px] text-base-content/40 pl-5 mt-1">
                    Configured via environment variables. Add a provider above to override.
                  </p>
                </div>
              ) : (
                <div className="text-sm text-base-content/50 italic text-center py-6">
                  No credentials configured. Add one below.
                </div>
              )}
            </>
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
                <span className="text-xs text-base-content/60">
                  API Key {allowsKeylessAuth ? <span className="text-base-content/40">(optional for local providers)</span> : null}
                </span>
                <input
                  className="input input-bordered input-sm font-mono"
                  type="password"
                  placeholder={allowsKeylessAuth ? 'Optional for local endpoint' : 'sk-…'}
                  value={form.apiKey}
                  onChange={(e) => setForm((f) => ({ ...f, apiKey: e.target.value }))}
                  data-testid="add-provider-apikey"
                  required={!allowsKeylessAuth}
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
                  disabled={(!allowsKeylessAuth && !form.apiKey) || testState === 'testing'}
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

      <div className="border-t border-base-300 pt-4">
        <h3 className="text-sm font-semibold mb-1">Agent Loop Limit</h3>
        <p className="text-xs text-base-content/60 mb-3">
          Max tool-attempt loop iterations per turn before automatic stop.
          Increase for complex test scenarios (for example 25).
        </p>
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs text-base-content/60">Max tool attempts</span>
          <span className="badge badge-neutral font-mono text-xs" data-testid="max-tool-attempts-value">
            {maxToolAttempts}
          </span>
        </div>
        <input
          type="range"
          className="range range-sm range-primary w-full"
          min={1}
          max={100}
          step={1}
          value={maxToolAttempts}
          onChange={(e) => void handleMaxToolAttemptsChange(parseInt(e.target.value, 10))}
          data-testid="max-tool-attempts-slider"
        />
        <div className="flex justify-between text-[10px] text-base-content/40 mt-1 px-1">
          <span>1</span><span>8</span><span>25</span><span>100</span>
        </div>
      </div>

      <ToolTimeoutsSection
        values={toolTimeouts}
        onInputChange={handleToolTimeoutInputChange}
        onCommit={(key, value) => void commitToolTimeoutChange(key, value)}
      />
    </div>
  );
}
