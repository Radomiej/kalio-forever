import { useEffect, useState } from 'react';
import type { ExecutionProfile } from '@kalio/types';

export function ImageIntegrationSelect({ value, onChange }: { value: string; onChange: (id: string) => void }) {
  const [profiles, setProfiles] = useState<ExecutionProfile[]>([]);
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    const controller = new AbortController();
    void fetch('/api/runtime/profiles', { signal: controller.signal }).then(async response => {
      if (!response.ok) throw new Error(`Could not load integrations (${response.status}).`);
      const items = await response.json() as ExecutionProfile[];
      setProfiles(items.filter(item => item.kind === 'codex-app-server' && item.enabled && (!item.provider || item.provider === 'openai')));
    }).catch(err => { if (!controller.signal.aborted) setError(err instanceof Error ? err.message : String(err)); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, []);
  return <div className="space-y-2">
    <label className="text-xs text-base-content/70" htmlFor="image-integration">ChatGPT / Codex integration</label>
    <select id="image-integration" className="select select-sm select-bordered w-full" value={value} onChange={event => onChange(event.target.value)} disabled={loading}>
      <option value="">{loading ? 'Loading integrations…' : 'Select an integration'}</option>
      {profiles.map(profile => <option key={profile.id} value={profile.id}>{profile.name} — {profile.model || 'default model'}</option>)}
      {value && !profiles.some(profile => profile.id === value) && <option value={value}>Unavailable integration ({value})</option>}
    </select>
    {error && <p role="alert" className="text-xs text-error">{error}</p>}
    {!loading && !error && !profiles.length && <p className="text-xs text-warning">No enabled ChatGPT / Codex profile. Add one and sign in under Integrations.</p>}
    <p className="text-xs text-base-content/70">Uses the selected integration’s ChatGPT login for generation and editing. No API key is required here. Availability and limits depend on your account and Codex model; OpenAI API billing is separate.</p>
  </div>;
}
