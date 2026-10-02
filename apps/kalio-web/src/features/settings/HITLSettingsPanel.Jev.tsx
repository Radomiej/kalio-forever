import type { HitlConfig } from './hitl-settings.types';
import { useState } from 'react';
import { DecisionSettingsPanel } from './DecisionSettingsPanel';

export function HITLJevSettings({
  config,
  onChange,
}: {
  config: HitlConfig;
  onChange: (next: HitlConfig) => void;
}) {
  const [showDecisions, setShowDecisions] = useState(false);

  return (
    <section className="space-y-3 rounded-lg border border-base-300/50 bg-base-200/30 p-4" aria-label="Jev approval settings">
      <div>
        <h3 className="text-xs font-semibold uppercase tracking-wide text-base-content/60">Jev approval settings</h3>
        <p className="mt-1 text-xs text-base-content/50">
          Jev evaluates whether an eligible operation should be approved. Earlier permission checks and hard rules always run first; a high-risk operation may be approved only after those checks pass.
        </p>
      </div>

      <p className="text-xs text-base-content/60">Provider and model come from Agent Settings → Decision Settings, shared with Architect Auto-routing.</p>
      <button type="button" className="btn btn-outline btn-sm" onClick={() => setShowDecisions((value) => !value)}>{showDecisions ? 'Hide Decision Settings' : 'Configure Decision Settings'}</button>
      {showDecisions && <DecisionSettingsPanel />}

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
