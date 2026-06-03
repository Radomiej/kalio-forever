import type { Dispatch, SetStateAction } from 'react';
import type { Persona } from '@kalio/types';
import type { HitlConfig } from './hitl-settings.types';

export const MAX_RAAPP_APPROVAL_TIMEOUT_MINUTES = 24 * 60;

export function HITLUnattendedSection({
  config,
  personas,
  timeoutMinutes,
  setConfig,
  clearStatus,
}: {
  config: HitlConfig;
  personas: Persona[];
  timeoutMinutes: number;
  setConfig: Dispatch<SetStateAction<HitlConfig>>;
  clearStatus: () => void;
}) {
  return (
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
            clearStatus();
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
            clearStatus();
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
            clearStatus();
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
            clearStatus();
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
            clearStatus();
          }}
        />
        <span className="text-xs text-base-content/50">
          Minutes before pending RA-App native approvals expire. Use 0 to keep them waiting until user action.
        </span>
      </label>
    </div>
  );
}
