import { useEffect, useState } from 'react';
import type { ExecutionProfile } from '@kalio/types';
import { getExecutionProfiles } from '../../../services/apiClient';

export function RAAppExecutionProfileControl({ value, onChange }: { value: string; onChange: (id: string) => void }) {
  const [profiles, setProfiles] = useState<ExecutionProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let disposed = false;
    void getExecutionProfiles().then((items) => {
      if (!disposed) setProfiles(items.filter((profile) => profile.enabled));
    }).catch((reason: unknown) => {
      if (!disposed) setError(`Could not load execution profiles: ${reason instanceof Error ? reason.message : String(reason)}`);
    }).finally(() => {
      if (!disposed) setLoading(false);
    });
    return () => { disposed = true; };
  }, []);
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-medium text-base-content/70">App execution profile</span>
      <select aria-label="App execution profile" className="select select-bordered w-full text-xs" value={value}
        onChange={(event) => onChange(event.target.value)} disabled={loading}>
        <option value="">Inherit current Kalio session profile</option>
        {profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.name} · {profile.kind}{profile.model ? ` · ${profile.model}` : ''}</option>)}
      </select>
      {loading && <span role="status" className="text-xs">Loading execution profiles…</span>}
      {error && <span role="alert" className="text-xs text-error">{error}</span>}
    </label>
  );
}
