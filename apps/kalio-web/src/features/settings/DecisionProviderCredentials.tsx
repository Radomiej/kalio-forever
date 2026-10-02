import { useEffect, useState } from 'react';
import type { Credential, CreateCredentialDto } from '@kalio/types';
import { apiFetch } from './llm-panel.utils';

/** Decision-only credentials cannot become the conversational LLM provider. */
export function DecisionProviderCredentials() {
  const [credentials, setCredentials] = useState<Credential[]>([]);
  const [provider, setProvider] = useState('typesafe');
  const [name, setName] = useState('TypeSafe');
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    void apiFetch<Credential[]>('/credentials').then(setCredentials).catch((cause: unknown) => setError(cause instanceof Error ? cause.message : 'Cannot load Decision credentials.'));
  }, []);
  const add = async () => {
    setBusy(true);
    setError(null);
    try {
      const dto: CreateCredentialDto = { provider, name: name.trim(), apiKey: key.trim() };
      const saved = await apiFetch<Credential>('/credentials', { method: 'POST', body: JSON.stringify(dto) });
      setCredentials((current) => [...current, saved]);
      setKey('');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Cannot save Decision credential.'); }
    finally { setBusy(false); }
  };
  const remove = async (id: string) => {
    setBusy(true);
    setError(null);
    try {
      await apiFetch(`/credentials/${encodeURIComponent(id)}`, { method: 'DELETE' });
      setCredentials((current) => current.filter((item) => item.id !== id));
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Cannot remove Decision credential.'); }
    finally { setBusy(false); }
  };
  return <section aria-label="Decision provider credentials" className="space-y-3 rounded-lg border border-base-300 p-4">
    <h3 className="font-semibold">Decision providers</h3>
    <p className="text-xs text-base-content/60">OpenRouter credentials above can also serve Decision Settings. Add native TypeSafe or custom Decisions API credentials here; they do not change the chat provider. Local keyless servers need no credential.</p>
    {error && <p role="alert" className="text-sm text-error">{error}</p>}
    <ul className="space-y-2">{credentials.filter((item) => item.provider === 'typesafe' || item.provider === 'decision').map((item) => <li key={item.id} className="flex items-center justify-between gap-3"><span>{item.name} ({item.provider})</span><button type="button" className="btn btn-ghost btn-xs" disabled={busy} onClick={() => { void remove(item.id); }} aria-label={`Remove Decision credential ${item.name}`}>Remove credential</button></li>)}</ul>
    <fieldset disabled={busy} className="grid gap-3 sm:grid-cols-2">
      <label className="form-control gap-1"><span>Credential provider</span><select aria-label="Decision credential provider" className="select select-bordered select-sm" value={provider} onChange={(event) => { setProvider(event.target.value); setName(event.target.value === 'typesafe' ? 'TypeSafe' : 'Decision API'); }}><option value="typesafe">TypeSafe</option><option value="decision">Custom Decisions API</option></select></label>
      <label className="form-control gap-1"><span>Credential name</span><input aria-label="Decision credential name" className="input input-bordered input-sm" maxLength={200} value={name} onChange={(event) => setName(event.target.value)} /></label>
      <label className="form-control gap-1"><span>API key (write-only)</span><input aria-label="Decision API key" className="input input-bordered input-sm" type="password" autoComplete="new-password" value={key} onChange={(event) => setKey(event.target.value)} /></label>
      <button type="button" className="btn btn-outline btn-sm self-end" disabled={!name.trim() || !key.trim()} onClick={() => { void add(); }}>{busy ? 'Saving…' : 'Add Decision credential'}</button>
    </fieldset>
  </section>;
}
