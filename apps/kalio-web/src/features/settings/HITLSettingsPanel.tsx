import { useCallback, useEffect, useState } from 'react';
import { AlertCircle, Loader2, Save, ShieldAlert } from 'lucide-react';
import type { Persona } from '@kalio/types';

type HitlMode = 'manual' | 'auto' | 'bypass';
type HitlUnattendedFallback = 'pause' | 'representative';
type HitlNotificationChannel = 'none' | 'telegram';

interface HitlConfig {
  mode: HitlMode;
  autoPersonaId: string | null;
  unattendedFallback: HitlUnattendedFallback;
  representativePersonaId: string | null;
  notificationChannel: HitlNotificationChannel;
  externalPolicyEnabled: boolean;
  externalPolicyPersonaId: string | null;
  raAppApprovalTimeoutMs: number;
}

const DEFAULT_CONFIG: HitlConfig = {
  mode: 'manual',
  autoPersonaId: null,
  unattendedFallback: 'pause',
  representativePersonaId: null,
  notificationChannel: 'none',
  externalPolicyEnabled: false,
  externalPolicyPersonaId: null,
  raAppApprovalTimeoutMs: 600_000,
};

const MAX_RAAPP_APPROVAL_TIMEOUT_MINUTES = 24 * 60;

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
        unattendedFallback: loadedConfig.unattendedFallback ?? 'pause',
        representativePersonaId: loadedConfig.representativePersonaId ?? null,
        notificationChannel: loadedConfig.notificationChannel ?? 'none',
        externalPolicyEnabled: loadedConfig.externalPolicyEnabled,
        externalPolicyPersonaId: loadedConfig.externalPolicyPersonaId ?? null,
        raAppApprovalTimeoutMs: loadedConfig.raAppApprovalTimeoutMs ?? DEFAULT_CONFIG.raAppApprovalTimeoutMs,
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
    if (personaValidationMessage || externalPolicyValidationMessage || representativeValidationMessage || timeoutValidationMessage) {
      setError(personaValidationMessage ?? externalPolicyValidationMessage ?? representativeValidationMessage ?? timeoutValidationMessage);
      return;
    }

    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const payload: {
        mode: HitlMode;
        autoPersonaId?: string | null;
        unattendedFallback: HitlUnattendedFallback;
        representativePersonaId?: string | null;
        notificationChannel: HitlNotificationChannel;
        externalPolicyEnabled: boolean;
        externalPolicyPersonaId?: string | null;
        raAppApprovalTimeoutMs: number;
      } = {
        mode: config.mode,
        unattendedFallback: config.unattendedFallback,
        representativePersonaId: config.representativePersonaId,
        notificationChannel: config.notificationChannel,
        externalPolicyEnabled: config.externalPolicyEnabled,
        externalPolicyPersonaId: config.externalPolicyPersonaId,
        raAppApprovalTimeoutMs: config.raAppApprovalTimeoutMs,
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

      <div className="space-y-3 rounded-lg border border-base-300/50 bg-base-200/30 p-4">
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-base-content/60">Unattended approvals</h3>
          <p className="text-xs text-base-content/50 mt-1">
            Controls what happens when a manual approval request times out. User cancellation and aborts still stop execution.
          </p>
        </div>

        <label className="flex items-start gap-3 rounded-lg border border-base-300/50 bg-base-100/50 p-3 cursor-pointer">
          <input
            aria-label="Pause on timeout"
            type="radio"
            name="hitl-unattended"
            className="radio radio-sm mt-0.5"
            checked={config.unattendedFallback === 'pause'}
            onChange={() => {
              setConfig((current) => ({ ...current, unattendedFallback: 'pause' }));
              setError(null);
              setSaved(false);
            }}
          />
          <span>
            <span className="block text-sm font-medium">Pause on timeout</span>
            <span className="block text-xs text-base-content/50">Leave the run waiting for the user instead of guessing.</span>
          </span>
        </label>

        <label className="flex items-start gap-3 rounded-lg border border-base-300/50 bg-base-100/50 p-3 cursor-pointer">
          <input
            aria-label="Representative on timeout"
            type="radio"
            name="hitl-unattended"
            className="radio radio-sm mt-0.5"
            checked={config.unattendedFallback === 'representative'}
            onChange={() => {
              setConfig((current) => ({ ...current, unattendedFallback: 'representative' }));
              setError(null);
              setSaved(false);
            }}
          />
          <span>
            <span className="block text-sm font-medium">Representative on timeout</span>
            <span className="block text-xs text-base-content/50">A selected persona answers only after the user did not respond.</span>
          </span>
        </label>

        <label className="form-control gap-1">
          <span className="text-xs font-semibold uppercase tracking-wide text-base-content/60">Representative persona</span>
          <select
            aria-label="Representative persona"
            className="select select-sm select-bordered w-full"
            value={config.representativePersonaId ?? ''}
            disabled={config.unattendedFallback !== 'representative'}
            onChange={(event) => {
              const nextPersonaId = event.target.value.trim();
              setConfig((current) => ({
                ...current,
                representativePersonaId: nextPersonaId.length > 0 ? nextPersonaId : null,
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

        <label className="form-control gap-1">
          <span className="text-xs font-semibold uppercase tracking-wide text-base-content/60">Notification channel</span>
          <select
            aria-label="Notification channel"
            className="select select-sm select-bordered w-full"
            value={config.notificationChannel}
            onChange={(event) => {
              setConfig((current) => ({
                ...current,
                notificationChannel: event.target.value === 'telegram' ? 'telegram' : 'none',
              }));
              setError(null);
              setSaved(false);
            }}
          >
            <option value="none">None</option>
            <option value="telegram">Telegram</option>
          </select>
        </label>
        <p className="text-xs text-base-content/50">
          Telegram sends approval prompts to the registered relay chat. Replies must include approve or reject plus the request id.
        </p>

        <label className="form-control gap-1">
          <span className="text-xs font-semibold uppercase tracking-wide text-base-content/60">RA-App approval timeout</span>
          <input
            aria-label="RA-App approval timeout minutes"
            className="input input-sm input-bordered w-full"
            type="number"
            min={0}
            max={MAX_RAAPP_APPROVAL_TIMEOUT_MINUTES}
            step={1}
            value={timeoutMinutes}
            onChange={(event) => {
              const nextMinutes = Number(event.target.value);
              setConfig((current) => ({
                ...current,
                raAppApprovalTimeoutMs: Number.isFinite(nextMinutes)
                  ? Math.round(nextMinutes) * 60_000
                  : current.raAppApprovalTimeoutMs,
              }));
              setError(null);
              setSaved(false);
            }}
          />
          <span className="text-xs text-base-content/50">
            Minutes before pending RA-App native approvals expire. Use 0 to keep them waiting until user action.
          </span>
        </label>
      </div>

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
