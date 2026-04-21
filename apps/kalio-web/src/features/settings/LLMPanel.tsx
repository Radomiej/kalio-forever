import { useState } from 'react';
import { Plus, Trash2, CheckCircle2, Circle } from 'lucide-react';
import { nanoid } from 'nanoid';
import {
  useSettingsStore,
  PROVIDER_DEFAULTS,
  DEFAULT_MODELS,
  type LLMProviderType,
  type LLMProvider,
} from './settingsStore';

const PROVIDER_TYPES: LLMProviderType[] = ['openai', 'cometapi', 'openrouter', 'ollama', 'custom'];

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
  const { providers, activeProviderId, addProvider, updateProvider, removeProvider, setActive } =
    useSettingsStore();

  const [showForm, setShowForm] = useState(providers.length === 0);
  const [form, setForm] = useState<Omit<LLMProvider, 'id'>>(emptyForm());

  const handleTypeChange = (type: LLMProviderType) => {
    setForm({
      type,
      label: PROVIDER_DEFAULTS[type].label,
      baseUrl: PROVIDER_DEFAULTS[type].baseUrl,
      apiKey: '',
      model: DEFAULT_MODELS[type],
    });
  };

  const handleAdd = (e: React.FormEvent) => {
    e.preventDefault();
    addProvider(form);
    setForm(emptyForm());
    setShowForm(false);
  };

  return (
    <div className="flex flex-col gap-5" data-testid="llm-panel">
      <div>
        <h2 className="text-base font-semibold mb-1">LLM Providers</h2>
        <p className="text-xs text-base-content/60">
          Configure one or more API providers. The active provider is used for all chat sessions.
        </p>
      </div>

      {/* Provider list */}
      {providers.length > 0 && (
        <div className="flex flex-col gap-2">
          {providers.map((p) => (
            <ProviderRow
              key={p.id}
              provider={p}
              isActive={p.id === activeProviderId}
              onActivate={() => setActive(p.id)}
              onUpdate={(patch) => updateProvider(p.id, patch)}
              onRemove={() => removeProvider(p.id)}
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
        <form className="flex flex-col gap-3 border border-base-300 rounded-lg p-4 bg-base-200/40" onSubmit={handleAdd} data-testid="add-provider-form">
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
    </div>
  );
}

function ProviderRow({
  provider,
  isActive,
  onActivate,
  onUpdate,
  onRemove,
}: {
  provider: LLMProvider;
  isActive: boolean;
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
          aria-label={isActive ? 'Active provider' : 'Set as active'}
          data-testid={`provider-activate-${provider.id}`}
        >
          {isActive ? <CheckCircle2 size={16} className="text-sky-400" /> : <Circle size={16} />}
        </button>

        <div className="flex-1 min-w-0">
          <span className="text-sm font-medium">{provider.label}</span>
          <span className="ml-2 badge badge-xs badge-ghost">{provider.type}</span>
          {isActive && <span className="ml-2 badge badge-xs bg-sky-500/20 text-sky-400 border-none">active</span>}
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
