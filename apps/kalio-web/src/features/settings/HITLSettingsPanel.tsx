import { useCallback, useEffect, useState } from 'react';
import { AlertCircle, Loader2, Save, ShieldAlert } from 'lucide-react';
import type { Persona, UpdateHitlConfigDto } from '@kalio/types';
import { HITLUnattendedSection, MAX_RAAPP_APPROVAL_TIMEOUT_MINUTES } from './HITLSettingsPanel.Unattended';
import { HITLJevSettings } from './HITLSettingsPanel.Jev';
import { HITLHardRules } from './HITLSettingsPanel.Rules';
import { decisionSettingsRequest } from './decision-settings.transport';
import type { HitlConfig } from './hitl-settings.types';

const DEFAULT_CONFIG: HitlConfig = {
  mode: 'manual',
  autoPersonaId: null,
  unattendedFallback: 'pause',
  representativePersonaId: null,
  notificationChannel: 'none',
  externalPolicyEnabled: false,
  externalPolicyPersonaId: null,
  raAppApprovalTimeoutMs: 600_000,
  jevApprovalThreshold: 0.95,
  jevInstructions: '',
  jevFallbackToPersona: false,
  rules: [],
};

async function apiFetch<T>(path: string, opts?: RequestInit): Promise<T> {
  const options: RequestInit = {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  };
  const response = path === '/hitl/config'
    ? await decisionSettingsRequest('/api/hitl/config', options)
    : await fetch(`/api${path}`, options);

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
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLoaded(false);
    setSaved(false);
    setError(null);
    try {
      const [loadedConfig, loadedPersonas] = await Promise.all([
        apiFetch<HitlConfig>('/hitl/config', { cache: 'no-store' }),
        apiFetch<Persona[]>('/personas', { cache: 'no-store' }),
      ]);
      setConfig({
        mode: loadedConfig.mode,
        autoPersonaId: loadedConfig.autoPersonaId ?? null,
        unattendedFallback: loadedConfig.unattendedFallback ?? 'pause',
        representativePersonaId: loadedConfig.representativePersonaId ?? null,
        notificationChannel: loadedConfig.notificationChannel ?? 'none',
        externalPolicyEnabled: loadedConfig.externalPolicyEnabled,
        externalPolicyPersonaId: loadedConfig.externalPolicyPersonaId ?? null,
        raAppApprovalTimeoutMs: loadedConfig.raAppApprovalTimeoutMs ?? DEFAULT_CONFIG.raAppApprovalTimeoutMs,
        // TODO: legacy fallback — older persisted HITL configs predate Jev and rules.
        jevApprovalThreshold: loadedConfig.jevApprovalThreshold ?? 0.95,
        jevInstructions: loadedConfig.jevInstructions ?? '',
        jevFallbackToPersona: loadedConfig.jevFallbackToPersona ?? false,
        rules: loadedConfig.rules ?? [],
      });
      setPersonas(loadedPersonas);
      setLoaded(true);
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
  const externalPolicyValidationMessage = config.externalPolicyEnabled && !config.externalPolicyPersonaId
    ? 'Choose a persona for the external HITL policy service.'
    : null;
  const representativeValidationMessage = config.unattendedFallback === 'representative' && !config.representativePersonaId
    ? 'Choose a representative persona for unattended approvals.'
    : null;
  const timeoutMinutes = Math.round(config.raAppApprovalTimeoutMs / 60_000);
  const jevThreshold = config.jevApprovalThreshold ?? 0.95;
  const jevValidationMessage = !Number.isFinite(jevThreshold) || jevThreshold <= 0.5 || jevThreshold > 1
    ? 'Jev approval threshold must be greater than 0.5 and at most 1.'
    : (config.jevInstructions?.length ?? 0) > 2000
      ? 'Jev instructions must be at most 2000 characters.'
      : null;
  const rulesValidationMessage = (config.rules?.length ?? 0) > 100 || config.rules?.some((rule) => !rule.name.trim()
    || (rule.executable !== undefined && !rule.executable.trim())
    || (rule.argumentsContains !== undefined && !rule.argumentsContains.trim()))
    ? 'Hard rules require an operation name and non-empty optional filters (at most 100 rules).'
    : null;
  const timeoutValidationMessage = config.raAppApprovalTimeoutMs < 0
    || config.raAppApprovalTimeoutMs > MAX_RAAPP_APPROVAL_TIMEOUT_MINUTES * 60_000
    || !Number.isInteger(config.raAppApprovalTimeoutMs)
    ? 'RA-App approval timeout must be between 0 and 1440 minutes.'
    : null;

  const handleSave = async () => {
    if (!loaded || saving) return;
    if (personaValidationMessage || externalPolicyValidationMessage || representativeValidationMessage || timeoutValidationMessage || jevValidationMessage || rulesValidationMessage) {
      setError(personaValidationMessage ?? externalPolicyValidationMessage ?? representativeValidationMessage ?? timeoutValidationMessage ?? jevValidationMessage ?? rulesValidationMessage);
      return;
    }

    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const payload: UpdateHitlConfigDto = {
        mode: config.mode,
        unattendedFallback: config.unattendedFallback,
        representativePersonaId: config.representativePersonaId,
        notificationChannel: config.notificationChannel,
        externalPolicyEnabled: config.externalPolicyEnabled,
        externalPolicyPersonaId: config.externalPolicyPersonaId,
        raAppApprovalTimeoutMs: config.raAppApprovalTimeoutMs,
        jevApprovalThreshold: jevThreshold,
        jevInstructions: config.jevInstructions,
        jevFallbackToPersona: config.jevFallbackToPersona,
        rules: config.rules ?? [],
      };
      if (config.mode === 'auto') {
        payload.autoPersonaId = config.autoPersonaId;
      }
      const updated = await apiFetch<HitlConfig>('/hitl/config', {
        method: 'PUT',
        body: JSON.stringify(payload),
      });
      setConfig({
        mode: updated.mode,
        autoPersonaId: updated.autoPersonaId ?? null,
        unattendedFallback: updated.unattendedFallback ?? 'pause',
        representativePersonaId: updated.representativePersonaId ?? null,
        notificationChannel: updated.notificationChannel ?? 'none',
        externalPolicyEnabled: updated.externalPolicyEnabled,
        externalPolicyPersonaId: updated.externalPolicyPersonaId ?? null,
        raAppApprovalTimeoutMs: updated.raAppApprovalTimeoutMs ?? DEFAULT_CONFIG.raAppApprovalTimeoutMs,
        jevApprovalThreshold: updated.jevApprovalThreshold ?? 0.95,
        jevInstructions: updated.jevInstructions ?? '',
        jevFallbackToPersona: updated.jevFallbackToPersona ?? false,
        rules: updated.rules ?? [],
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
          Jev uses typed decisions with manual fallback, and bypass skips prompts only after permission and hard-rule checks.
        </p>
      </div>

      {error && (
        <div role="alert" className="flex items-start gap-2 p-3 rounded-lg bg-error/10 border border-error/20 text-error text-xs">
          <AlertCircle size={14} className="mt-0.5 shrink-0" />
          <span>{error}</span>
          {!loaded && <button type="button" className="btn btn-xs" onClick={() => void load()}>Retry</button>}
        </div>
      )}

      {saved && !error && (
        <div role="status" className="flex items-start gap-2 p-3 rounded-lg bg-success/10 border border-success/20 text-success text-xs">
          <ShieldAlert size={14} className="mt-0.5 shrink-0" />
          <span>HITL settings saved.</span>
        </div>
      )}

      <fieldset disabled={saving || !loaded} className="space-y-5">
      <div className="space-y-3 rounded-lg border border-base-300/50 bg-base-200/30 p-4">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-base-content/60">Approval mode</h3>
        <label className="flex items-start gap-3 rounded-lg border border-base-300/50 bg-base-100/50 p-3 cursor-pointer">
          <input aria-label="Jev typed decisions" type="radio" name="hitl-mode" className="radio radio-sm mt-0.5"
            checked={config.mode === 'jev'} onChange={() => {
              setConfig((current) => ({ ...current, mode: 'jev' })); setError(null); setSaved(false);
            }} />
          <span><span className="block text-sm font-medium">Jev typed decisions</span>
            <span className="block text-xs text-base-content/60">Use typed decisions; uncertain requests return to manual approval.</span></span>
        </label>

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
            <span className="block text-xs text-base-content/50">Skip prompts after permission and hard-rule checks. Destructive operations still require confirmation.</span>
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

      {config.mode === 'jev' && <HITLJevSettings config={config} onChange={(next) => {
        setConfig(next); setError(null); setSaved(false);
      }} />}
      <HITLHardRules config={config} onChange={(next) => {
        setConfig(next); setError(null); setSaved(false);
      }} />
      <HITLUnattendedSection
        config={config}
        personas={personas}
        timeoutMinutes={timeoutMinutes}
        setConfig={setConfig}
        clearStatus={() => {
          setError(null);
          setSaved(false);
        }}
      />
      <div className="space-y-3 rounded-lg border border-base-300/50 bg-base-200/30 p-4">
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-base-content/60">External HITL policy service</h3>
          <p className="text-xs text-base-content/50 mt-1">
            Exposes <span className="font-mono">POST /api/security/policy/evaluate</span> for external security approvals.
            Requests are logged to audit and, when the request has a Kalio session id, added to that conversation.
          </p>
        </div>

        <label className="flex items-start gap-3 rounded-lg border border-base-300/50 bg-base-100/50 p-3 cursor-pointer">
          <input
            aria-label="Enable external HITL policy"
            type="checkbox"
            className="toggle toggle-sm mt-0.5"
            checked={config.externalPolicyEnabled}
            onChange={(event) => {
              setConfig((current) => ({ ...current, externalPolicyEnabled: event.target.checked }));
              setError(null);
              setSaved(false);
            }}
          />
          <span>
            <span className="block text-sm font-medium">Enable external security policy endpoint</span>
            <span className="block text-xs text-base-content/50">Use a persona to allow, deny, or ask the user for external agent/tool requests.</span>
          </span>
        </label>

        <label className="form-control gap-1">
          <span className="text-xs font-semibold uppercase tracking-wide text-base-content/60">External policy persona</span>
          <select
            aria-label="External policy persona"
            className="select select-sm select-bordered w-full"
            value={config.externalPolicyPersonaId ?? ''}
            disabled={!config.externalPolicyEnabled}
            onChange={(event) => {
              const nextPersonaId = event.target.value.trim();
              setConfig((current) => ({
                ...current,
                externalPolicyPersonaId: nextPersonaId.length > 0 ? nextPersonaId : null,
              }));
              setError(null);
              setSaved(false);
            }}
          >
            <option value="">Select a persona...</option>
            {personas.map((persona) => (
              <option key={persona.id} value={persona.id}>{persona.name}</option>
            ))}
          </select>
        </label>
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
      </fieldset>
    </div>
  );
}
