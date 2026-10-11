import { nanoid } from 'nanoid';
import type { HitlHardRule } from '@kalio/types';
import type { HitlConfig } from './hitl-settings.types';

export function HITLHardRules({ config, onChange }: {
  config: HitlConfig;
  onChange: (next: HitlConfig) => void;
}) {
  const rules = config.rules ?? [];
  const update = (id: string, patch: Partial<HitlHardRule>) => onChange({
    ...config, rules: rules.map((rule) => rule.id === id ? { ...rule, ...patch } : rule),
  });
  return (
    <section aria-label="HITL hard rules" className="space-y-3 rounded-lg border border-base-300/50 bg-base-200/30 p-4">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-base-content/60">Hard rules</h3>
      <p className="text-xs text-base-content/60">Scope rules by operation type and exact name, optionally executable or argument text. Use * to match any name in that scope. Deny takes precedence over Ask user and all approval modes. Destructive operations still require user confirmation.</p>
      {rules.length === 0 && <p className="text-xs text-base-content/60">No hard rules configured.</p>}
      {rules.map((rule, index) => (
        <fieldset key={rule.id} className="space-y-2 min-w-0 rounded-lg border border-base-300/50 p-3">
          <legend className="px-1 text-xs font-medium">Rule {index + 1}</legend>
          {rule.decision === 'allow' ? <p className="text-xs text-warning">Existing Allow rule: {rule.kind} / {rule.name}. Editing automatic allow rules is unavailable here.</p> : <>
            <label className="form-control gap-1"><span>Operation type</span>
              <select aria-label={`Rule ${index + 1} operation type`} className="select select-sm select-bordered w-full" value={rule.kind}
                onChange={(event) => update(rule.id, { kind: event.target.value as HitlHardRule['kind'] })}>
                <option value="tool">Tool</option><option value="raapp_native">RA-App native operation</option>
                <option value="external_security">External security request</option><option value="*">Any operation type</option>
              </select></label>
            <label className="form-control gap-1"><span>Operation or tool name</span>
              <input aria-label={`Rule ${index + 1} name`} className="input input-sm input-bordered w-full" value={rule.name}
                onChange={(event) => update(rule.id, { name: event.target.value })} /></label>
            <label className="form-control gap-1"><span>Decision</span>
              <select aria-label={`Rule ${index + 1} decision`} className="select select-sm select-bordered w-full" value={rule.decision}
                onChange={(event) => update(rule.id, { decision: event.target.value === 'deny' ? 'deny' : 'ask_user' })}>
                <option value="deny">Deny</option><option value="ask_user">Ask user</option>
              </select></label>
            <label className="form-control gap-1"><span>Executable (optional)</span>
              <input aria-label={`Rule ${index + 1} executable`} className="input input-sm input-bordered w-full" value={rule.executable ?? ''}
                onChange={(event) => update(rule.id, { executable: event.target.value || undefined })} /></label>
            <label className="form-control gap-1"><span>Command argument contains (optional)</span>
              <input aria-label={`Rule ${index + 1} argument substring`} className="input input-sm input-bordered w-full" value={rule.argumentsContains ?? ''}
                onChange={(event) => update(rule.id, { argumentsContains: event.target.value || undefined })} /></label>
          </>}
          <button type="button" className="btn btn-ghost btn-xs" aria-label={`Remove rule ${index + 1}`}
            onClick={() => onChange({ ...config, rules: rules.filter((item) => item.id !== rule.id) })}>Remove rule</button>
        </fieldset>
      ))}
      <button type="button" className="btn btn-outline btn-sm" disabled={rules.length >= 100}
        onClick={() => onChange({ ...config, rules: [...rules, { id: nanoid(), kind: 'tool', name: '', decision: 'deny' }] })}>Add deny rule</button>
    </section>
  );
}
