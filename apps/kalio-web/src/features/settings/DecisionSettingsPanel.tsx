import { useCallback, useEffect, useState } from 'react';
import type { Credential, DecisionSettings, DecisionSettingsPort } from '@kalio/types';
import { decisionSettingsTransport } from './decision-settings.transport';
import { apiFetch } from './llm-panel.utils';

const DEFAULT_CONFIG: DecisionSettings = { provider: 'openrouter', credentialId: null, model: 'typesafe/jev-1.13', endpoint: '' };
const MODELS = { openrouter: 'typesafe/jev-1.13', typesafe: 'jev-1.13.0', custom: '' };
const DEFAULT_TRANSPORT = { ...decisionSettingsTransport, getCredentials: () => apiFetch<Credential[]>('/credentials') };

export interface DecisionSettingsPanelProps {
  transport?: (Pick<DecisionSettingsPort, 'getConfig' | 'updateConfig'> & { getCredentials(): Promise<Credential[]> }) | null;
}

export function DecisionSettingsPanel({ transport = DEFAULT_TRANSPORT }: DecisionSettingsPanelProps = {}) {
  const [config, setConfig] = useState<DecisionSettings>(DEFAULT_CONFIG);
  const [credentials, setCredentials] = useState<Credential[]>([]);
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const load = useCallback(async () => {
    setLoading(true); setLoaded(false); setSaved(false); setError(null);
    try {
      if (!transport) throw new Error('Authenticated Decision Settings transport is not available.');
      const [settings, available] = await Promise.all([transport.getConfig(), transport.getCredentials()]);
      setConfig(settings); setCredentials(available); setLoaded(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Cannot load Decision Settings.');
    } finally { setLoading(false); }
  }, [transport]);
  useEffect(() => { void load(); }, [load]);
  const change = (patch: Partial<DecisionSettings>) => {
    setConfig((value) => ({ ...value, ...patch })); setSaved(false); setError(null);
  };
  const compatible = credentials.filter((credential) => config.provider === 'custom' || credential.provider.toLowerCase() === config.provider);
  const unavailableCredential = !!config.credentialId && !compatible.some((item) => item.id === config.credentialId);
  let validation: string | null = null;
  if (!config.model.trim()) validation = 'Enter a Decision model.';
  if (config.provider === 'custom') {
    try {
      const endpoint = new URL(config.endpoint);
      if (!['http:', 'https:'].includes(endpoint.protocol) || endpoint.username || endpoint.password) validation = 'Enter an HTTP(S) Decision endpoint without embedded credentials.';
    } catch { validation = 'Enter a valid full HTTP(S) Decision endpoint.'; }
  }
  if (unavailableCredential) validation = 'Select an available compatible credential.';
  const save = async () => {
    if (!transport || !loaded || saving || validation) return;
    setSaving(true); setError(null); setSaved(false);
    try {
      setConfig(await transport.updateConfig({ ...config, model: config.model.trim(), endpoint: config.endpoint.trim() }));
      setSaved(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Cannot save Decision Settings.');
    } finally { setSaving(false); }
  };
  if (loading) return <p role="status" className="p-4">Loading Decision Settings…</p>;
  return (
    <section aria-label="Decision Settings" className="p-4 space-y-4 max-w-xl" data-testid="decision-settings-panel">
      <div><h2 className="text-sm font-semibold">Decision Settings</h2>
        <p className="mt-1 text-xs text-base-content/60">Shared typed decisions for HITL Approvals and Architect Auto-routing. Select the provider, model, credential and endpoint here.</p></div>
      {error && <div role="alert" className="space-y-2 text-sm text-error"><p>{error}</p>
        <button type="button" className="btn btn-outline btn-sm" disabled={saving} onClick={() => void load()}>Reload settings</button></div>}
      <fieldset disabled={saving || !loaded} className="space-y-4 min-w-0">
        <label className="form-control gap-1"><span>Decision provider</span>
          <select aria-label="Decision provider" className="select select-bordered w-full" value={config.provider} onChange={(event) => {
            const provider = event.target.value as DecisionSettings['provider'];
            change({ provider, model: MODELS[provider], credentialId: null, endpoint: '' });
          }}><option value="openrouter">OpenRouter</option><option value="typesafe">TypeSafe (native Jev API)</option><option value="custom">Custom / local Decisions API</option></select></label>
        <label className="form-control gap-1"><span>Decision model</span>
          <input aria-label="Decision model" className="input input-bordered w-full" maxLength={200} value={config.model} onChange={(event) => change({ model: event.target.value })} /></label>
        <p className="text-xs text-base-content/60">Jev 1.13 is the default. Models must support typed probability and choice decisions.</p>
        {config.provider === 'custom' && <label className="form-control gap-1"><span>Decision endpoint (full POST URL)</span>
          <input aria-label="Decision endpoint" className="input input-bordered w-full" type="url" value={config.endpoint} maxLength={2000} placeholder="http://127.0.0.1:9090/decide" onChange={(event) => change({ endpoint: event.target.value })} /></label>}
        <label className="form-control gap-1"><span>Decision credential</span>
          <select aria-label="Decision credential" className="select select-bordered w-full" value={config.credentialId ?? ''} onChange={(event) => change({ credentialId: event.target.value || null })}>
            <option value="">{config.provider === 'custom' ? 'No credential (keyless server)' : 'Automatically use a compatible credential'}</option>
            {unavailableCredential && <option value={config.credentialId ?? ''}>Unavailable credential — choose another</option>}
            {compatible.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select></label>
        <p className="text-xs text-base-content/60">Add provider credentials in LLM Settings. Keys are resolved by the backend. Select a credential for a custom endpoint only if you trust that server.</p>
        {config.provider !== 'custom' && compatible.length === 0 && <p role="status" className="text-sm text-warning">No compatible credential. Add one before enabling automatic decisions.</p>}
        <p className="text-xs text-base-content/60">Approval thresholds and deny rules remain in HITL Approvals; routing confidence and fallback remain on each Architect node. Saving here does not enable automatic approvals.</p>
        {loaded && validation && <p role="alert" className="text-sm text-error">{validation}</p>}
        <button type="button" className="btn btn-primary btn-sm" disabled={!!validation} onClick={() => void save()}>{saving ? 'Saving…' : 'Save Decision Settings'}</button>
      </fieldset>
      {saved && <p role="status" className="text-sm text-success">Decision Settings saved.</p>}
    </section>
  );
}
