import { useState, type FormEvent } from 'react';
import { apiClient } from '../../services/apiClient';
import type { Credential, CreateCredentialDto } from '@kalio/types';

const PROVIDER_LABELS: Record<string, string> = {
  openai: 'OpenAI',
  openrouter: 'OpenRouter',
  cometapi: 'CometAPI',
  xiaomimimo: 'Xiaomi MiMo',
  ollama: 'Ollama (Local)',
};

const PROVIDER_BASE_URLS: Record<string, string> = {
  openai: 'https://api.openai.com/v1',
  openrouter: 'https://openrouter.ai/api/v1',
  cometapi: 'https://api.cometapi.com/v1',
  xiaomimimo: 'https://token-plan-ams.xiaomimimo.com/v1',
  ollama: 'http://localhost:11434/v1',
};

const PROVIDER_DEFAULT_MODELS: Record<string, string> = {
  openai: 'gpt-4o-mini',
  openrouter: 'openai/gpt-4o-mini',
  cometapi: 'gpt-4o-mini',
  xiaomimimo: 'mimo-v2-omni',
  ollama: 'qwen2.5:7b',
};

const ALL_PROVIDERS = ['openai', 'openrouter', 'cometapi', 'xiaomimimo', 'ollama'] as const;

export function CredentialsPanel() {
  const [credentials, setCredentials] = useState<Credential[]>([]);
  const [form, setForm] = useState<CreateCredentialDto>({
    name: '',
    provider: 'openai',
    apiKey: '',
    baseUrl: '',
    model: '',
  });
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  if (!loaded) {
    setLoaded(true);
    apiClient
      .get<Credential[]>('/api/credentials')
      .then((r) => setCredentials(r.data))
      .catch((err: unknown) => console.error('[CredentialsPanel] load failed', err));
  }

  const handleProviderChange = (provider: string) => {
    setForm((f) => ({
      ...f,
      provider,
      baseUrl: PROVIDER_BASE_URLS[provider] || '',
      model: PROVIDER_DEFAULT_MODELS[provider] || '',
    }));
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      const { data } = await apiClient.post<Credential>('/api/credentials', form);
      setCredentials((prev) => [...prev, data]);
      setForm({ name: '', provider: 'openai', apiKey: '', baseUrl: '', model: '' });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save credential');
    }
  };

  const handleRemove = async (id: string) => {
    await apiClient.delete(`/api/credentials/${id}`);
    setCredentials((prev) => prev.filter((c) => c.id !== id));
  };

  return (
    <div className="flex flex-col gap-5" data-testid="credentials-panel">
      <div>
        <h2 className="text-base font-semibold mb-1">API Credentials</h2>
        <p className="text-xs text-base-content/60">
          Store named credentials for tools and integrations. Keys are never exposed in API responses.
        </p>
      </div>

      {error && (
        <div data-testid="settings-error" className="alert alert-error py-1 text-xs">{error}</div>
      )}

      <form data-testid="credential-form" onSubmit={handleSubmit} className="flex flex-col gap-2 border border-base-300 rounded-lg p-4 bg-base-200/40">
        <h3 className="text-sm font-semibold">Add Credential</h3>
        <input data-testid="cred-name" className="input input-bordered input-sm" placeholder="Name (e.g. My OpenAI Key)"
          value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} required />
        
        <div className="form-control">
          <label className="label py-1">
            <span className="label-text text-xs">Provider</span>
          </label>
          <select
            data-testid="cred-provider"
            className="select select-bordered select-sm w-full"
            value={form.provider}
            onChange={(e) => handleProviderChange(e.target.value)}
            required
          >
            {ALL_PROVIDERS.map((p) => (
              <option key={p} value={p}>{PROVIDER_LABELS[p]}</option>
            ))}
          </select>
        </div>

        <input data-testid="cred-apikey" className="input input-bordered input-sm font-mono" type="password" placeholder="API Key"
          value={form.apiKey} onChange={(e) => setForm((f) => ({ ...f, apiKey: e.target.value }))} required />
        <input data-testid="cred-baseurl" className="input input-bordered input-sm font-mono" placeholder="Base URL (optional)"
          value={form.baseUrl} onChange={(e) => setForm((f) => ({ ...f, baseUrl: e.target.value }))} />
        <input data-testid="cred-model" className="input input-bordered input-sm" placeholder="Model (optional)"
          value={form.model} onChange={(e) => setForm((f) => ({ ...f, model: e.target.value }))} />
        <button data-testid="cred-submit" className="btn btn-primary btn-sm self-end" type="submit">Save</button>
      </form>

      <div className="flex flex-col gap-1">
        {credentials.length === 0 && (
          <p className="text-xs text-base-content/40 italic text-center py-4">No credentials saved yet.</p>
        )}
        {credentials.map((c) => (
          <div key={c.id} data-testid="credential-item"
            className="flex items-center justify-between rounded border border-base-300 px-3 py-2 text-xs">
            <span className="font-medium">{c.name}</span>
            <span className="text-base-content/50 ml-2">({PROVIDER_LABELS[c.provider] || c.provider})</span>
            <div className="flex-1" />
            <button data-testid="cred-remove" className="btn btn-ghost btn-xs text-error" onClick={() => handleRemove(c.id)}>✕</button>
          </div>
        ))}
      </div>
    </div>
  );
}
