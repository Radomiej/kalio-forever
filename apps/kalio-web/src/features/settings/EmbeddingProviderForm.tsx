import { AlertCircle, Loader2, Plus, Zap } from 'lucide-react';
import type { FormEvent } from 'react';

export const PROVIDER_LABELS: Record<string, string> = {
  openai:     'OpenAI',
  cometapi:   'CometAPI',
  openrouter: 'OpenRouter',
  ollama:     'Ollama',
  custom:     'Custom',
};

export const PROVIDER_BASE_URLS: Record<string, string> = {
  openai:     'https://api.openai.com/v1',
  cometapi:   'https://api.cometapi.com/v1',
  openrouter: 'https://openrouter.ai/api/v1',
  ollama:     'http://localhost:11434',
  custom:     '',
};

export const PROVIDER_DEFAULT_MODELS: Record<string, string> = {
  openai:     'text-embedding-3-small',
  cometapi:   'text-embedding-3-small',
  openrouter: 'openai/text-embedding-3-small',
  ollama:     'nomic-embed-text',
  custom:     '',
};

export const PROVIDER_DEFAULT_DIMS: Record<string, number> = {
  openai:     1536,
  cometapi:   1536,
  openrouter: 1536,
  ollama:     768,
  custom:     1536,
};

const ALL_PROVIDERS = ['openai', 'cometapi', 'openrouter', 'ollama', 'custom'] as const;

export interface AddForm {
  name: string;
  provider: string;
  apiKey: string;
  baseUrl: string;
  model: string;
  dimensions: number;
  nameEdited?: boolean;
}

export function emptyForm(): AddForm {
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

interface EmbeddingProviderFormProps {
  form: AddForm;
  syncing: boolean;
  addTestState: 'idle' | 'testing' | 'ok' | 'error';
  addTestError: string | null;
  onSubmit: (event: FormEvent) => void;
  onCancel: () => void;
  onFormChange: (updater: (form: AddForm) => AddForm) => void;
  onProviderChange: (provider: string) => void;
  onTest: () => void;
}

export function EmbeddingProviderForm({
  form,
  syncing,
  addTestState,
  addTestError,
  onSubmit,
  onCancel,
  onFormChange,
  onProviderChange,
  onTest,
}: EmbeddingProviderFormProps) {
  return (
    <form
      className="flex flex-col gap-4 border border-base-300 rounded-lg p-4 bg-base-200/40"
      onSubmit={onSubmit}
      data-testid="embedding-add-form"
    >
      <h3 className="text-sm font-semibold">Add Embedding Provider</h3>

      <div className="flex flex-col gap-1">
        <span className="text-xs text-base-content/60">Provider</span>
        <div className="flex gap-1 flex-wrap">
          {ALL_PROVIDERS.map((p) => (
            <button
              key={p}
              type="button"
              className={`btn btn-xs ${form.provider === p ? 'btn-primary' : 'btn-ghost border border-base-300'}`}
              onClick={() => onProviderChange(p)}
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
          onChange={(e) => onFormChange((f) => ({ ...f, name: e.target.value, nameEdited: true }))}
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
          onChange={(e) => onFormChange((f) => ({ ...f, apiKey: e.target.value }))}
          required={form.provider !== 'ollama'}
        />
      </label>

      <label className="form-control gap-1">
        <span className="text-xs text-base-content/60">Base URL</span>
        <input
          className="input input-bordered input-sm font-mono"
          value={form.baseUrl}
          onChange={(e) => onFormChange((f) => ({ ...f, baseUrl: e.target.value }))}
          required
        />
      </label>

      <div className="flex gap-3">
        <label className="form-control gap-1 flex-1">
          <span className="text-xs text-base-content/60">Embedding model</span>
          <input
            className="input input-bordered input-sm font-mono"
            value={form.model}
            onChange={(e) => onFormChange((f) => ({ ...f, model: e.target.value }))}
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
            onChange={(e) => onFormChange((f) => ({ ...f, dimensions: parseInt(e.target.value, 10) || 1536 }))}
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
          onClick={onTest}
          disabled={addTestState === 'testing'}
          data-testid="add-form-test-btn"
        >
          {addTestState === 'testing' ? <Loader2 size={12} className="animate-spin" /> : <Zap size={12} />}
          {addTestState === 'ok' ? 'OK!' : addTestState === 'error' ? 'Failed' : 'Test'}
        </button>
        <div className="flex gap-2">
          <button type="button" className="btn btn-ghost btn-sm" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary btn-sm" disabled={syncing} data-testid="embedding-add-btn">
            {syncing ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
            Add Provider
          </button>
        </div>
      </div>
    </form>
  );
}
