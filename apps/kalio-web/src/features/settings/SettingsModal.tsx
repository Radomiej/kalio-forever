import { useState, type FormEvent } from 'react';
import { apiClient } from '../../services/apiClient';
import type { Credential, CreateCredentialDto } from '@kalio/types';

interface SettingsModalProps {
  onClose: () => void;
}

export function SettingsModal({ onClose }: SettingsModalProps) {
  const [credentials, setCredentials] = useState<Credential[]>([]);
  const [form, setForm] = useState<CreateCredentialDto>({
    name: '',
    provider: 'CometAPI',
    apiKey: '',
    baseUrl: '',
    model: '',
  });
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  const load = () => {
    if (loaded) return;
    setLoaded(true);
    apiClient
      .get<Credential[]>('/api/credentials')
      .then((r) => setCredentials(r.data))
      .catch((err: unknown) => console.error('[SettingsModal] load failed', err));
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      const { data } = await apiClient.post<Credential>('/api/credentials', form);
      setCredentials((prev) => [...prev, data]);
      setForm({ name: '', provider: 'CometAPI', apiKey: '', baseUrl: '', model: '' });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save credential');
    }
  };

  const handleRemove = async (id: string) => {
    await apiClient.delete(`/api/credentials/${id}`);
    setCredentials((prev) => prev.filter((c) => c.id !== id));
  };

  return (
    <div data-testid="settings-modal" className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={load}>
      <div className="card w-[480px] bg-base-100 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="card-body">
          <div className="flex items-center justify-between">
            <h2 data-testid="settings-title" className="card-title">Settings</h2>
            <button data-testid="settings-close" className="btn btn-ghost btn-sm" onClick={onClose}>✕</button>
          </div>

          <h3 className="mt-2 text-sm font-semibold">API Credentials</h3>

          {error && <div data-testid="settings-error" className="alert alert-error py-1 text-xs">{error}</div>}

          <form data-testid="credential-form" onSubmit={handleSubmit} className="flex flex-col gap-2">
            <input data-testid="cred-name" className="input input-bordered input-sm" placeholder="Name" value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} required />
            <input data-testid="cred-provider" className="input input-bordered input-sm" placeholder="Provider" value={form.provider}
              onChange={(e) => setForm((f) => ({ ...f, provider: e.target.value }))} required />
            <input data-testid="cred-apikey" className="input input-bordered input-sm" type="password" placeholder="API Key" value={form.apiKey}
              onChange={(e) => setForm((f) => ({ ...f, apiKey: e.target.value }))} required />
            <input data-testid="cred-baseurl" className="input input-bordered input-sm" placeholder="Base URL (optional)" value={form.baseUrl}
              onChange={(e) => setForm((f) => ({ ...f, baseUrl: e.target.value }))} />
            <input data-testid="cred-model" className="input input-bordered input-sm" placeholder="Model (optional)" value={form.model}
              onChange={(e) => setForm((f) => ({ ...f, model: e.target.value }))} />
            <button data-testid="cred-submit" className="btn btn-primary btn-sm" type="submit">Save</button>
          </form>

          <div className="mt-2 space-y-1">
            {credentials.map((c) => (
              <div key={c.id} data-testid="credential-item" className="flex items-center justify-between rounded border border-base-300 px-2 py-1 text-xs">
                <span>{c.name} <span className="text-base-content/50">({c.provider})</span></span>
                <button data-testid="cred-remove" className="btn btn-ghost btn-xs text-error" onClick={() => handleRemove(c.id)}>✕</button>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
