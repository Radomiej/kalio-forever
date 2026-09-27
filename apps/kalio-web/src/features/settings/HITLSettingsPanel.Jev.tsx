import type { Credential } from '@kalio/types';
import type { HitlConfig } from './hitl-settings.types';

export function HITLJevSettings({
  config,
  credentials,
  credentialError,
  onRetryCredentials,
  onChange,
}: {
  config: HitlConfig;
  credentials: Credential[];
  credentialError: string | null;
  onRetryCredentials: () => void;
  onChange: (next: HitlConfig) => void;
}) {
  const openRouterCredentials = credentials.filter((credential) => credential.provider.toLowerCase() === 'openrouter');

  return (
    <section className="space-y-3 rounded-lg border border-base-300/50 bg-base-200/30 p-4" aria-label="Jev approval settings">
      <div>
        <h3 className="text-xs font-semibold uppercase tracking-wide text-base-content/60">Jev approval settings</h3>
        <p className="mt-1 text-xs text-base-content/50">
          Jev evaluates whether an eligible operation should be approved. Earlier permission checks and hard rules always run first; a high-risk operation may be approved only after those checks pass.
        </p>
      </div>

      {credentialError && (
        <div role="alert" className="flex items-center justify-between gap-3 rounded-lg border border-error/20 bg-error/10 p-3 text-xs text-error">
          <span>OpenRouter credentials could not be loaded: {credentialError}</span>
          <button type="button" className="btn btn-outline btn-xs shrink-0" onClick={onRetryCredentials}>Retry credentials</button>
        </div>
      )}

      <label className="form-control gap-1">
        <span className="text-xs font-semibold text-base-content/70">OpenRouter credential</span>
        <select
          aria-label="Jev OpenRouter credential"
          className="select select-sm select-bordered w-full"
          value={config.jevCredentialId ?? ''}
          onChange={(event) => onChange({ ...config, jevCredentialId: event.target.value || null })}
        >
          <option value="">Select a credential…</option>
          {openRouterCredentials.map((credential) => (
            <option key={credential.id} value={credential.id}>{credential.name}</option>
          ))}
        </select>
      </label>
      <p className="text-xs text-warning">
        Use an OpenRouter management key with Decisions API access. The key stays in backend credentials and is never shown here.
      </p>

      <label className="form-control gap-1">
        <span className="text-xs font-semibold text-base-content/70">Approval threshold</span>
        <input
          aria-label="Jev approval threshold"
          type="number"
          min="0.51"
          max="0.99"
          step="0.01"
          className="input input-sm input-bordered w-40"
          value={config.jevApprovalThreshold}
          onChange={(event) => onChange({ ...config, jevApprovalThreshold: Number(event.target.value) })}
        />
      </label>
      <p className="text-xs text-base-content/50">Approve at or above this probability; deny at or below its complement. The default is 0.90.</p>

      <label className="form-control gap-1">
        <span className="text-xs font-semibold text-base-content/70">Jev instructions</span>
        <textarea
          aria-label="Jev approval instructions"
          className="textarea textarea-sm textarea-bordered min-h-24 w-full"
          maxLength={2_000}
          value={config.jevInstructions}
          onChange={(event) => onChange({ ...config, jevInstructions: event.target.value })}
          placeholder="Add context for evaluating approval requests…"
        />
      </label>
    </section>
  );
}
