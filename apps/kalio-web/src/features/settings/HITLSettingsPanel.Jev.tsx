import type { HitlConfig } from './hitl-settings.types';

export function HITLJevSettings({ config, onChange }: {
  config: HitlConfig;
  onChange: (next: HitlConfig) => void;
}) {
  return (
    <section aria-label="Jev approval settings" className="space-y-3 rounded-lg border border-base-300/50 bg-base-200/30 p-4">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-base-content/60">Jev approval settings</h3>
      <p className="text-xs text-base-content/60">
        Jev uses the shared provider, model and credential in Decision Settings. Permission denials and hard deny rules take precedence.
        By default, uncertainty, unavailable credentials or a provider error require manual approval.
      </p>
      <label className="form-control gap-1">
        <span className="text-xs font-semibold text-base-content/70">Approval authority</span>
        <select className="select select-sm select-bordered w-full" aria-describedby="jev-terminal-approval-help"
          value={config.confirmationAuthority ?? 'human'}
          onChange={(event) => onChange({ ...config, confirmationAuthority: event.target.value === 'decision_model' ? 'decision_model'
            : event.target.value === 'human_then_decision' ? 'human_then_decision' : 'human' })}>
          <option value="human">Always ask me</option>
          <option value="decision_model">Decision model</option>
          <option value="human_then_decision">Ask me, then Jev</option>
        </select>
      </label>
      {config.confirmationAuthority === 'human_then_decision' && <label className="form-control gap-1">
        <span className="text-xs font-semibold text-base-content/70">Time before Jev takes over</span>
        <select className="select select-sm select-bordered w-full" value={config.humanReviewTimeoutMs ?? 60_000}
          onChange={event => onChange({ ...config, humanReviewTimeoutMs: Number(event.target.value) })}>
          <option value={0}>No timeout</option><option value={60000}>1 minute</option>
          <option value={120000}>2 minutes</option><option value={300000}>5 minutes</option>
        </select>
      </label>}
      <p id="jev-terminal-approval-help" className="text-xs text-base-content/60">Deny and ask-user rules take precedence. Uncertainty or provider failure requires manual approval.</p>
      {config.confirmationAuthority !== 'human' && config.confirmationAuthority !== undefined && <p className="text-xs text-warning" role="note">
        Jev may approve commands and file changes without asking you. Terminal commands run with Kalio's system permissions; this is not an OS sandbox.
      </p>}
      <label className="form-control gap-1">
        <span className="text-xs font-semibold text-base-content/70">Approval threshold</span>
        <input aria-label="Jev approval threshold" type="number" min="0.5" max="1" step="any"
          className="input input-sm input-bordered w-full" value={Number.isNaN(config.jevApprovalThreshold) ? '' : config.jevApprovalThreshold ?? 0.95}
          onChange={(event) => onChange({ ...config, jevApprovalThreshold: event.target.value === '' ? NaN : Number(event.target.value) })} />
      </label>
      <p className="text-xs text-base-content/60">The default is 0.95. The threshold must be greater than 0.5 and at most 1.</p>
      <label className="form-control gap-1">
        <span className="text-xs font-semibold text-base-content/70">Jev instructions</span>
        <textarea aria-label="Jev approval instructions" maxLength={2000}
          className="textarea textarea-sm textarea-bordered min-h-24 w-full" value={config.jevInstructions ?? ''}
          onChange={(event) => onChange({ ...config, jevInstructions: event.target.value })} />
      </label>
      <p className="text-xs text-base-content/60">Selecting Jev changes this draft only. Save to apply the approval mode.</p>
      {config.jevFallbackToPersona && <p className="text-xs text-warning">This saved configuration explicitly enables persona fallback before manual approval.</p>}
    </section>
  );
}
