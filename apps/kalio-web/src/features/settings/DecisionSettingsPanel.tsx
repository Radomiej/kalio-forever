import { useCallback, useEffect, useState } from 'react';
import type { Credential, DecisionSettings } from '@kalio/types';
import { apiFetch } from './llm-panel.utils';

const DEFAULT_CONFIG: DecisionSettings = { provider: 'openrouter', credentialId: null, model: 'typesafe/jev-1.13', endpoint: '' };
const MODELS = { openrouter: 'typesafe/jev-1.13', typesafe: 'jev-1.13.0', custom: '' };

export function DecisionSettingsPanel() {
  const [config, setConfig] = useState<DecisionSettings>(DEFAULT_CONFIG);
  const [credentials, setCredentials] = useState<Credential[]>([]);
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const load = useCallback(async () => {
    setLoading(true);
    setLoaded(false);
    setError(null);
    try {
      const [settings, available] = await Promise.all([
        apiFetch<DecisionSettings>('/decision/config'), apiFetch<Credential[]>('/credentials'),
      ]);
      setConfig(settings);
      setCredentials(available);
      setLoaded(true);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Cannot load Decision Settings.'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const change = (patch: Partial<DecisionSettings>) => { setConfig((value) => ({ ...value, ...patch })); setSaved(false); };
  const save = async () => {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      setConfig(await apiFetch<DecisionSettings>('/decision/config', { method: 'PUT', body: JSON.stringify(config) }));
      setSaved(true);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Cannot save Decision Settings.'); }
    finally { setSaving(false); }
  };
  const compatible = credentials.filter((credential) => config.provider === 'custom' || credential.provider.toLowerCase() === config.provider);
  if (loading) return <p role="status">Loading Decision Settings…</p>;
  return (
    <section aria-label="Decision Settings" className="space-y-4" data-testid="decision-settings-panel">
      <div><h2 className="text-base font-semibold">Decision Settings</h2>
        <p className="mt-1 text-xs text-base-content/60">Choose the typed decision model used by HITL Approvals and Architect Auto-routing. Conversational LLM settings are independent.</p></div>
      {error && <div role="alert" className="alert alert-warning text-sm"><span>{error}</span><button type="button" className="btn btn-xs" onClick={() => { void load(); }}>Reload settings</button></div>}
      <fieldset disabled={saving || !loaded} className="space-y-4">
        <label className="form-control gap-1"><span>Decision provider</span>
          <select aria-label="Decision provider" className="select select-bordered w-full" value={config.provider} onChange={(event) => {
            const provider = event.target.value as DecisionSettings['provider'];
            change({ provider, model: MODELS[provider], credentialId: null, endpoint: '' });
          }}>
            <option value="openrouter">OpenRouter (default)</option><option value="typesafe">TypeSafe (native Jev API)</option><option value="custom">Custom / local Decisions API</option>
          </select></label>
        <label className="form-control gap-1"><span>Decision model</span>
          <input aria-label="Decision model" className="input input-bordered w-full" maxLength={200} value={config.model} onChange={(event) => change({ model: event.target.value })} />
        </label>
        <p className="text-xs text-base-content/60">Jev 1.13 is the default. Other models must support typed noul and choice decisions; a chat API alone is insufficient.</p>
        {config.provider === 'custom' && <label className="form-control gap-1"><span>Decision endpoint (full POST URL)</span>
          <input aria-label="Decision endpoint" className="input input-bordered w-full" type="url" value={config.endpoint} maxLength={2000} placeholder="http://127.0.0.1:9090/decide" onChange={(event) => change({ endpoint: event.target.value })} />
        </label>}
        <label className="form-control gap-1"><span>Decision credential</span>
          <select aria-label="Decision credential" className="select select-bordered w-full" value={config.credentialId ?? ''} onChange={(event) => change({ credentialId: event.target.value || null })}>
            <option value="">{config.provider === 'custom' ? 'No authentication (keyless server)' : 'Automatically use first available compatible credential'}</option>
            {config.credentialId && !compatible.some((item) => item.id === config.credentialId) && <option value={config.credentialId}>Unavailable credential — choose another</option>}
            {compatible.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select></label>
        <p className="text-xs text-base-content/60">Provider credentials are stored separately in Providers. Keys are resolved only by the backend. For a custom endpoint, explicitly select a credential only if you trust that server.</p>
        {config.provider !== 'custom' && compatible.length === 0 && <p role="status" className="text-sm text-warning">No compatible credential yet. Add one in Providers before enabling automatic decisions.</p>}
        <p className="text-xs text-base-content/60">Approval thresholds and hard rules remain in HITL Approvals; routing confidence and fallback remain on each Architect node.</p>
        <button type="button" className="btn btn-primary" disabled={!config.model.trim() || (config.provider === 'custom' && !config.endpoint.trim())} onClick={() => { void save(); }}>{saving ? 'Saving…' : 'Save Decision Settings'}</button>
      </fieldset>
      {saved && <p role="status" className="text-sm text-success">Decision Settings saved.</p>}
    </section>
  );
}
