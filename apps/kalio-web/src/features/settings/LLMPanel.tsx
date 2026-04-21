import { useState } from 'react';
import { Plus, Trash2, CheckCircle2, Circle, Loader2, AlertCircle } from 'lucide-react';
import {
  useSettingsStore,
  PROVIDER_DEFAULTS,
  DEFAULT_MODELS,
  type LLMProviderType,
  type LLMProvider,
} from './settingsStore';

const API = '/api';

const PROVIDER_TYPES: LLMProviderType[] = ['openai', 'xiaomimimo', 'deepseek', 'cometapi', 'openrouter', 'ollama', 'custom'];

async function apiPost(path: string, body: unknown) {
  const res = await fetch(`${API}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}

async function apiPut(path: string, body?: unknown) {
  const res = await fetch(`${API}${path}`, {
    method: 'PUT',
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
}

async function apiDelete(path: string) {
  const res = await fetch(`${API}${path}`, { method: 'DELETE' });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
}

function emptyForm(): Omit<LLMProvider, 'id'> {
  return {
    type: 'openai',
    label: PROVIDER_DEFAULTS.openai.label,
    baseUrl: PROVIDER_DEFAULTS.openai.baseUrl,
    apiKey: '',
    model: DEFAULT_MODELS.openai,
  };
}

export function LLMPanel() {
  const {
    providers, activeProviderId, contextWindowSize,
    addProvider, updateProvider, removeProvider, setActive, setContextWindowSize,
  } = useSettingsStore();

  const [showForm, setShowForm] = useState(providers.length === 0);
  const [form, setForm] = useState<Omit<LLMProvider, 'id'>>(emptyForm());
  const [syncing, setSyncing] = useState<string | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);

  const handleTypeChange = (type: LLMProviderType) => {
    setForm({
      type,
      label: PROVIDER_DEFAULTS[type].label,
      baseUrl: PROVIDER_DEFAULTS[type].baseUrl,
      apiKey: '',
      model: DEFAULT_MODELS[type],
    });
  };

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    setSyncError(null);
    const localId = addProvider(form);
    try {
      setSyncing(localId);
      const created = await apiPost('/credentials', {
        name: form.label,
        provider: form.type,
        apiKey: form.apiKey,
        baseUrl: form.baseUrl || undefined,
        model: form.model || undefined,
      }) as { id: string };
      updateProvider(localId, { backendId: created.id });
    } catch (err) {
      setSyncError(`Backend sync failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSyncing(null);
    }
    setForm(emptyForm());
    setShowForm(false);
  };

  const handleActivate = async (provider: LLMProvider) => {
    setActive(provider.id);
    let backendId = provider.backendId;
    if (!backendId) {
      try {
        setSyncing(provider.id);
        const created = await apiPost('/credentials', {
          name: provider.label,
          provider: provider.type,
          apiKey: provider.apiKey,
          baseUrl: provider.baseUrl || undefined,
          model: provider.model || undefined,
        }) as { id: string };
        backendId = created.id;
        updateProvider(provider.id, { backendId });
      } catch (err) {
        setSyncError(`Backend sync failed: ${err instanceof Error ? err.message : String(err)}`);
        setSyncing(null);
        return;
      } finally {
        setSyncing(null);
      }
    }
    try {
      setSyncing(provider.id);
      await apiPut(`/credentials/active/${backendId}`);
    } catch (err) {
      setSyncError(`Failed to set active: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSyncing(null);
    }
  };

  const handleRemove = async (provider: LLMProvider) => {
    removeProvider(provider.id);
    if (provider.backendId) {
      try {
        await apiDelete(`/credentials/${provider.backendId}`);
      } catch {
        // Non-fatal
      }
    }
  };

  const handleContextWindowChange = async (size: number) => {
    setContextWindowSize(size);
    try {
      await apiPut('/credentials/settings/context-window', { size });
    } catch {
      // Non-fatal
    }
  };

  return (
    <div className="flex flex-col gap-5" data-testid="llm-panel">
      <div>
        <h2 className="text-base font-semibold mb-1">LLM Providers</h2>
        <p className="text-xs text-base-content/60">
          Configure one or more API providers. The active provider is saved to the database.
        </p>
      </div>

      {syncError && (
        <div className="alert alert-warning py-2 text-xs gap-2">
          <AlertCircle size={14} />
          {syncError}
          <button className="btn btn-ghost btn-xs ml-auto" onClick={() => setSyncError(null)}>✕</button>
        </div>
      )}

      {/* Provider list */}
      {providers.length > 0 && (
        <div className="flex flex-col gap-2">
          {providers.map((p) => (
            <ProviderRow
              key={p.id}
              provider={p}
              isActive={p.id === activeProviderId}
              isSyncing={syncing === p.id}
              onActivate={() => void handleActivate(p)}
              onUpdate={(patch) => updateProvider(p.id, patch)}
              onRemove={() => void handleRemove(p)}
            />
          ))}
        </div>
      )}

      {providers.length === 0 && !showForm && (
        <div className="text-sm text-base-content/50 italic text-center py-6">
          No providers configured. Add one below.
        </div>
      )}

      {/* Add form */}
      {showForm ? (
        <form className="flex flex-col gap-3 border border-base-300 rounded-lg p-4 bg-base-200/40" onSubmit={(e) => void handleAdd(e)} data-testid="add-provider-form">
          <h3 className="text-sm font-semibold">Add Provider</h3>

          <div className="flex gap-2 flex-wrap">
            {PROVIDER_TYPES.map((t) => (
              <button
                key={t}
                type="button"
                className={`btn btn-xs ${form.type === t ? 'btn-primary' : 'btn-ghost border border-base-300'}`}
                onClick={() => handleTypeChange(t)}
              >
                {PROVIDER_DEFAULTS[t].label}
              </button>
            ))}
          </div>

          <label className="form-control gap-1">
            <span className="text-xs text-base-content/60">Label</span>
            <input
              className="input input-bordered input-sm"
              value={form.label}
              onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))}
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
              data-testid="add-provider-apikey"
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

          <div className="flex gap-2 justify-end">
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setShowForm(false)}>Cancel</button>
            <button type="submit" className="btn btn-primary btn-sm" data-testid="add-provider-submit">Add Provider</button>
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

      {/* Context window */}
      <div className="border-t border-base-300 pt-4">
        <h3 className="text-sm font-semibold mb-1">Context Window</h3>
        <p className="text-xs text-base-content/60 mb-3">
          Oldest messages are trimmed automatically when history exceeds this limit.
        </p>
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs text-base-content/60">Max tokens</span>
          <span className="badge badge-neutral font-mono text-xs" data-testid="context-window-value">
            {(contextWindowSize / 1000).toFixed(0)}k
          </span>
        </div>
        <input
          type="range"
          className="range range-sm range-primary w-full"
          min={4000}
          max={200000}
          step={4000}
          value={contextWindowSize}
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

function ProviderRow({
  provider,
  isActive,
  isSyncing,
  onActivate,
  onUpdate,
  onRemove,
}: {
  provider: LLMProvider;
  isActive: boolean;
  isSyncing: boolean;
  onActivate: () => void;
  onUpdate: (patch: Partial<Omit<LLMProvider, 'id'>>) => void;
  onRemove: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [local, setLocal] = useState({ apiKey: provider.apiKey, baseUrl: provider.baseUrl, model: provider.model });

  const handleSave = () => {
    onUpdate(local);
    setEditing(false);
  };

  return (
    <div
      className={`rounded-lg border p-3 flex flex-col gap-2 transition-colors ${isActive ? 'border-sky-500/40 bg-sky-500/5' : 'border-base-300'}`}
      data-testid={`provider-row-${provider.id}`}
    >
      <div className="flex items-center gap-2">
        <button
          className="text-base-content/50 hover:text-sky-400 transition-colors shrink-0"
          onClick={onActivate}
          disabled={isSyncing}
          aria-label={isActive ? 'Active provider' : 'Set as active'}
          data-testid={`provider-activate-${provider.id}`}
        >
          {isSyncing
            ? <Loader2 size={16} className="animate-spin text-info" />
            : isActive
              ? <CheckCircle2 size={16} className="text-sky-400" />
              : <Circle size={16} />
          }
        </button>

        <div className="flex-1 min-w-0">
          <span className="text-sm font-medium">{provider.label}</span>
          <span className="ml-2 badge badge-xs badge-ghost">{provider.type}</span>
          {isActive && <span className="ml-2 badge badge-xs bg-sky-500/20 text-sky-400 border-none">active</span>}
          {!provider.backendId && <span className="ml-2 badge badge-xs badge-warning border-none">local only</span>}
        </div>

        <span className="text-xs text-base-content/40 font-mono truncate max-w-28">{provider.model}</span>

        <button
          className="btn btn-ghost btn-xs text-base-content/40 hover:text-sky-400"
          onClick={() => setEditing((v) => !v)}
        >
          {editing ? 'Cancel' : 'Edit'}
        </button>
        <button
          className="btn btn-ghost btn-xs text-base-content/40 hover:text-error"
          onClick={onRemove}
          data-testid={`provider-remove-${provider.id}`}
        >
          <Trash2 size={14} />
        </button>
      </div>

      {editing && (
        <div className="flex flex-col gap-2 pt-1 border-t border-base-300">
          <label className="form-control gap-1">
            <span className="text-xs text-base-content/50">API Key</span>
            <input className="input input-bordered input-xs font-mono" type="password"
              value={local.apiKey} onChange={(e) => setLocal((l) => ({ ...l, apiKey: e.target.value }))} />
          </label>
          <label className="form-control gap-1">
            <span className="text-xs text-base-content/50">Base URL</span>
            <input className="input input-bordered input-xs font-mono"
              value={local.baseUrl} onChange={(e) => setLocal((l) => ({ ...l, baseUrl: e.target.value }))} />
          </label>
          <label className="form-control gap-1">
            <span className="text-xs text-base-content/50">Model</span>
            <input className="input input-bordered input-xs font-mono"
              value={local.model} onChange={(e) => setLocal((l) => ({ ...l, model: e.target.value }))} />
          </label>
          <button className="btn btn-primary btn-xs self-end" onClick={handleSave}>Save</button>
        </div>
      )}
    </div>
  );
}
