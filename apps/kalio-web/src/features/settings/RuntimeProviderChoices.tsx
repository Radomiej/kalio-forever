import { useEffect, useState } from 'react';
import type { ExecutionProfile } from '@kalio/types';
import { getExecutionProfiles } from '../../services/apiClient';
import { decisionSettingsRequest } from './decision-settings.transport';

/** Uses the same durable execution profiles as chat and app launch. */
export function RuntimeProviderChoices() {
  const [profiles, setProfiles] = useState<ExecutionProfile[]>([]);
  const [selected, setSelected] = useState('');
  const [saved, setSaved] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    Promise.all([
      getExecutionProfiles(),
      decisionSettingsRequest('/api/runtime/default-profile').then((response) => response.json() as Promise<{ executionProfileId: string | null }>),
    ]).then(([available, response]) => {
      if (!alive) return;
      setProfiles(available.filter((profile) => profile.enabled && profile.kind !== 'direct-llm'));
      setSelected(response.executionProfileId ?? '');
      setSaved(response.executionProfileId ?? '');
    }).catch(() => { if (alive) setError('Could not load connected agents.'); });
    return () => { alive = false; };
  }, []);

  const save = async () => {
    if (!selected || busy) return;
    setBusy(true);
    setError(null);
    try {
      await decisionSettingsRequest('/api/runtime/default-profile', { method: 'PUT', body: JSON.stringify({ executionProfileId: selected }) });
      setSaved(selected);
    } catch {
      setError('Could not save the default agent. Your previous choice is unchanged.');
    } finally {
      setBusy(false);
    }
  };

  if (!profiles.length && !error) return null;
  return (
    <div className="space-y-2 border border-base-300 rounded-lg p-3">
      <label className="form-control gap-2">
        <span className="text-sm font-medium">Connected agents</span>
        <select aria-label="Default connected agent" className="select select-bordered select-sm w-full"
          value={selected} disabled={busy} onChange={(event) => setSelected(event.target.value)}>
          <option value="">Choose an agent</option>
          {saved && !profiles.some((profile) => profile.id === saved) ? <option value={saved}>Saved agent unavailable</option> : null}
          {profiles.map((profile) => <option key={profile.id} value={profile.id}>
            {profile.kind === 'devin-cli-acp' ? 'Devin' : profile.kind === 'codex-app-server' ? 'Codex' : profile.name} · {profile.model}
          </option>)}
        </select>
      </label>
      <button type="button" className="btn btn-primary btn-sm" disabled={busy || !selected || selected === saved}
        onClick={() => void save()}>{busy ? 'Saving…' : selected === saved && saved ? 'Default agent saved' : 'Use by default'}</button>
      {error ? <p role="alert" className="text-sm text-error">{error}</p> : null}
    </div>
  );
}
