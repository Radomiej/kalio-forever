import { useCallback, useEffect, useState } from 'react';
import { AlertCircle, Loader2, Save, ShieldAlert } from 'lucide-react';
import type { Persona } from '@kalio/types';
import { controlPlaneFetch } from '../../services/controlPlaneFetch';
import { HITLUnattendedSection, MAX_RAAPP_APPROVAL_TIMEOUT_MINUTES } from './HITLSettingsPanel.Unattended';
import { HITLJevSettings } from './HITLSettingsPanel.Jev';
import { HITLHardRules } from './HITLSettingsPanel.Rules';
import type { HitlConfig } from './hitl-settings.types';

const DEFAULT_CONFIG: HitlConfig = {
  mode: 'manual',
  autoPersonaId: null,
  jevInstructions: '',
  jevApprovalThreshold: 0.9,
  rules: [],
  unattendedFallback: 'pause',
  representativePersonaId: null,
  notificationChannel: 'none',
  externalPolicyEnabled: false,
  externalPolicyPersonaId: null,
  raAppApprovalTimeoutMs: 600_000,
};

function normalizeConfig(config: Partial<HitlConfig>): HitlConfig {
  return {
    ...DEFAULT_CONFIG,
    ...config,
    autoPersonaId: config.autoPersonaId ?? null,
    jevInstructions: config.jevInstructions ?? '',
    jevApprovalThreshold: config.jevApprovalThreshold ?? DEFAULT_CONFIG.jevApprovalThreshold,
    rules: config.rules ?? [],
    representativePersonaId: config.representativePersonaId ?? null,
    externalPolicyPersonaId: config.externalPolicyPersonaId ?? null,
  };
}

async function apiFetch<T>(path: string, opts?: RequestInit): Promise<T> {
  const response = await controlPlaneFetch(`/api${path}`, {
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
      setConfig(normalizeConfig(loadedConfig));
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
  const jevThresholdValidationMessage = config.jevApprovalThreshold < 0.51
    || config.jevApprovalThreshold > 0.99
    || !Number.isFinite(config.jevApprovalThreshold)
    ? 'Jev approval threshold must be between 0.51 and 0.99.'
    : null;
  const invalidRuleIndex = config.rules.findIndex((rule) => !rule.name.trim());
  const ruleValidationMessage = invalidRuleIndex >= 0
    ? `Rule ${invalidRuleIndex + 1} needs an operation or tool name.`
    : null;
  const externalPolicyValidationMessage = config.externalPolicyEnabled && !config.externalPolicyPersonaId
    ? 'Choose a persona for the external HITL policy service.'
    : null;
  const representativeValidationMessage = config.unattendedFallback === 'representative' && !config.representativePersonaId
    ? 'Choose a representative persona for unattended approvals.'
    : null;
  const timeoutMinutes = Math.round(config.raAppApprovalTimeoutMs / 60_000);
  const timeoutValidationMessage = config.raAppApprovalTimeoutMs < 0
    || config.raAppApprovalTimeoutMs > MAX_RAAPP_APPROVAL_TIMEOUT_MINUTES * 60_000
    || !Number.isInteger(config.raAppApprovalTimeoutMs)
    ? 'RA-App approval timeout must be between 0 and 1440 minutes.'
    : null;

  const handleSave = async () => {
    if (personaValidationMessage || jevThresholdValidationMessage || ruleValidationMessage || externalPolicyValidationMessage || representativeValidationMessage || timeoutValidationMessage) {
      setError(personaValidationMessage ?? jevThresholdValidationMessage ?? ruleValidationMessage ?? externalPolicyValidationMessage ?? representativeValidationMessage ?? timeoutValidationMessage);
      return;
    }

    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const payload: HitlConfig = {
        mode: config.mode,
        autoPersonaId: config.mode === 'auto' || config.mode === 'jev' ? config.autoPersonaId : null,
        jevInstructions: config.jevInstructions,
        jevApprovalThreshold: config.jevApprovalThreshold,
        rules: config.rules,
        unattendedFallback: config.unattendedFallback,
        representativePersonaId: config.representativePersonaId,
        notificationChannel: config.notificationChannel,
        externalPolicyEnabled: config.externalPolicyEnabled,
        externalPolicyPersonaId: config.externalPolicyPersonaId,
        raAppApprovalTimeoutMs: config.raAppApprovalTimeoutMs,
      };
      const updated = await apiFetch<HitlConfig>('/hitl/config', {
        method: 'PUT',
        body: JSON.stringify(payload),
      });
      setConfig(normalizeConfig(updated));
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
          Manual asks the user, Auto persona delegates to a persona, Jev evaluates eligible operations, and Bypass skips fixed rules and prompts after earlier permission checks pass.
        </p>
      </div>

      {error && (
        <div role="alert" className="flex items-start gap-2 p-3 rounded-lg bg-error/10 border border-error/20 text-error text-xs">
          <AlertCircle size={14} className="mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {saved && !error && (
        <div role="status" className="flex items-start gap-2 p-3 rounded-lg bg-success/10 border border-success/20 text-success text-xs">
          <ShieldAlert size={14} className="mt-0.5 shrink-0" />
          <span>HITL settings saved.</span>
        </div>
      )}

      <fieldset className="space-y-3 rounded-lg border border-base-300/50 bg-base-200/30 p-4">
        <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-base-content/60">Approval mode</legend>

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
            aria-label="Jev"
            type="radio"
            name="hitl-mode"
            className="radio radio-sm mt-0.5"
            checked={config.mode === 'jev'}
            onChange={() => {
              setConfig((current) => ({ ...current, mode: 'jev' }));
              setError(null);
              setSaved(false);
            }}
          />
          <span>
            <span className="block text-sm font-medium">Decision agent (Jev)</span>
            <span className="block text-xs text-base-content/50">The configured Decision model evaluates eligible operations; uncertain results go to the fallback persona or user.</span>
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
      </fieldset>

      <div className="space-y-2 rounded-lg border border-base-300/50 bg-base-200/30 p-4">
        <label className="form-control gap-1">
            <span className="text-xs font-semibold uppercase tracking-wide text-base-content/60">
              {config.mode === 'jev' ? 'Jev fallback persona (optional)' : 'Approval persona'}
            </span>
          <select
            aria-label="Approval persona"
            className="select select-sm select-bordered w-full"
            value={config.autoPersonaId ?? ''}
            disabled={config.mode !== 'auto' && config.mode !== 'jev'}
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
          {config.mode === 'jev'
            ? 'Used when Jev is uncertain or unavailable. If no persona is selected, the user decides.'
            : config.mode === 'auto'
              ? <>The selected persona must return JSON in the shape <span className="font-mono">&#123;agree, reason&#125;</span>.</>
              : 'Select a persona to use Auto persona mode.'}
        </p>
      </div>

      {config.mode === 'jev' && (
        <HITLJevSettings
          config={config}
          onChange={(next) => {
            setConfig(next);
            setError(null);
            setSaved(false);
          }}
        />
      )}

      <HITLHardRules
        config={config}
        onChange={(next) => {
          setConfig(next);
          setError(null);
          setSaved(false);
        }}
      />

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
    </div>
  );
}
