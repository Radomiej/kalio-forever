import { useCallback, useEffect, useState } from 'react';
import { AlertCircle, Loader2, Save, ShieldAlert } from 'lucide-react';
import type { Persona } from '@kalio/types';

type HitlMode = 'manual' | 'auto' | 'bypass';

interface HitlConfig {
  mode: HitlMode;
  autoPersonaId: string | null;
}

const DEFAULT_CONFIG: HitlConfig = {
  mode: 'manual',
  autoPersonaId: null,
};

async function apiFetch<T>(path: string, opts?: RequestInit): Promise<T> {
  const response = await fetch(`/api${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  });

  if (!response.ok) {
    const text = await response.text().catch(() => response.statusText);
    throw new Error(`${response.status}: ${text}`);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return response.json() as Promise<T>;
}

export function HITLSettingsPanel() {
  const [config, setConfig] = useState<HitlConfig>(DEFAULT_CONFIG);
  const [personas, setPersonas] = useState<Persona[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [loadedConfig, loadedPersonas] = await Promise.all([
        apiFetch<HitlConfig>('/hitl/config', { cache: 'no-store' }),
        apiFetch<Persona[]>('/personas', { cache: 'no-store' }),
      ]);
      setConfig({
        mode: loadedConfig.mode,
        autoPersonaId: loadedConfig.autoPersonaId ?? null,
      });
      setPersonas(loadedPersonas);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load HITL settings');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const personaValidationMessage = config.mode === 'auto' && !config.autoPersonaId
    ? 'Choose a persona for auto approvals.'
    : null;

  const handleSave = async () => {
    if (personaValidationMessage) {
      setError(personaValidationMessage);
      return;
    }

    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const updated = await apiFetch<HitlConfig>('/hitl/config', {
        method: 'PUT',
        body: JSON.stringify({
          mode: config.mode,
          autoPersonaId: config.autoPersonaId,
        }),
      });
      setConfig({
        mode: updated.mode,
        autoPersonaId: updated.autoPersonaId ?? null,
      });
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save HITL settings');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 p-6 text-base-content/50" data-testid="hitl-settings-panel">
        <Loader2 size={16} className="animate-spin" />
        <span className="text-sm">Loading…</span>
      </div>
    );
  }

  return (
    <div className="p-4 space-y-5 max-w-xl" data-testid="hitl-settings-panel">
      <div>
        <h2 className="text-sm font-semibold text-base-content/80 mb-0.5">HITL Approvals</h2>
        <p className="text-xs text-base-content/50">
          Choose how approval-gated tools and RA-App native operations are resolved.
          Manual keeps the current user confirmation flow, auto delegates the decision to one persona,
          and bypass approves every approval-gated operation.
        </p>
      </div>

      {error && (
        <div className="flex items-start gap-2 p-3 rounded-lg bg-error/10 border border-error/20 text-error text-xs">
          <AlertCircle size={14} className="mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {saved && !error && (
        <div className="flex items-start gap-2 p-3 rounded-lg bg-success/10 border border-success/20 text-success text-xs">
          <ShieldAlert size={14} className="mt-0.5 shrink-0" />
          <span>HITL settings saved.</span>
        </div>
      )}

      <div className="space-y-3 rounded-lg border border-base-300/50 bg-base-200/30 p-4">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-base-content/60">Approval mode</h3>

        <label className="flex items-start gap-3 rounded-lg border border-base-300/50 bg-base-100/50 p-3 cursor-pointer">
          <input
            aria-label="Manual"
            type="radio"
            name="hitl-mode"
            className="radio radio-sm mt-0.5"
            checked={config.mode === 'manual'}
            onChange={() => {
              setConfig((current) => ({ ...current, mode: 'manual' }));
              setError(null);
              setSaved(false);
            }}
          />
          <span>
            <span className="block text-sm font-medium">Manual</span>
            <span className="block text-xs text-base-content/50">User confirms every approval request.</span>
          </span>
        </label>

        <label className="flex items-start gap-3 rounded-lg border border-base-300/50 bg-base-100/50 p-3 cursor-pointer">
          <input
            aria-label="Auto persona"
            type="radio"
            name="hitl-mode"
            className="radio radio-sm mt-0.5"
            checked={config.mode === 'auto'}
            onChange={() => {
              setConfig((current) => ({ ...current, mode: 'auto' }));
              setError(null);
              setSaved(false);
            }}
          />
          <span>
            <span className="block text-sm font-medium">Auto persona</span>
            <span className="block text-xs text-base-content/50">A selected persona returns JSON approval decisions.</span>
          </span>
        </label>

        <label className="flex items-start gap-3 rounded-lg border border-base-300/50 bg-base-100/50 p-3 cursor-pointer">
          <input
            aria-label="Bypass all"
            type="radio"
            name="hitl-mode"
            className="radio radio-sm mt-0.5"
            checked={config.mode === 'bypass'}
            onChange={() => {
              setConfig((current) => ({ ...current, mode: 'bypass' }));
              setError(null);
              setSaved(false);
            }}
          />
          <span>
            <span className="block text-sm font-medium">Bypass all</span>
            <span className="block text-xs text-base-content/50">Approve every gated operation without prompting.</span>
          </span>
        </label>
      </div>

      <div className="space-y-2 rounded-lg border border-base-300/50 bg-base-200/30 p-4">
        <label className="form-control gap-1">
          <span className="text-xs font-semibold uppercase tracking-wide text-base-content/60">Approval persona</span>
          <select
            aria-label="Approval persona"
            className="select select-sm select-bordered w-full"
            value={config.autoPersonaId ?? ''}
            disabled={config.mode !== 'auto'}
            onChange={(event) => {
              const nextPersonaId = event.target.value.trim();
              setConfig((current) => ({
                ...current,
                autoPersonaId: nextPersonaId.length > 0 ? nextPersonaId : null,
              }));
              setError(null);
              setSaved(false);
            }}
          >
            <option value="">Select a persona…</option>
            {personas.map((persona) => (
              <option key={persona.id} value={persona.id}>{persona.name}</option>
            ))}
          </select>
        </label>
        <p className="text-xs text-base-content/50">
          The selected persona must return JSON in the shape <span className="font-mono">&#123;agree, reason&#125;</span>.
        </p>
      </div>

      <div className="flex justify-end">
        <button
          type="button"
          className="btn btn-primary btn-sm gap-2"
          onClick={() => void handleSave()}
          disabled={saving}
        >
          {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
          Save
        </button>
      </div>
    </div>
  );
}