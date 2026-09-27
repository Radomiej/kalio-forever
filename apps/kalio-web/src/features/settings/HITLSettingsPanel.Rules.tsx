import { nanoid } from 'nanoid';
import type { HitlApprovalKind, HitlHardRule, HitlRuleDecision } from '@kalio/types';
import type { HitlConfig } from './hitl-settings.types';

const RULE_KINDS: Array<{ value: HitlHardRule['kind']; label: string }> = [
  { value: '*', label: 'Any operation' },
  { value: 'tool', label: 'Tool' },
  { value: 'raapp_native', label: 'RA-App native operation' },
];

const RULE_DECISIONS: Array<{ value: HitlRuleDecision; label: string }> = [
  { value: 'deny', label: 'Deny' },
  { value: 'ask_user', label: 'Ask user' },
  { value: 'allow', label: 'Allow' },
];

export function HITLHardRules({
  config,
  onChange,
}: {
  config: HitlConfig;
  onChange: (next: HitlConfig) => void;
}) {
  const updateRule = (id: string, patch: Partial<HitlHardRule>) => onChange({
    ...config,
    rules: config.rules.map((rule) => rule.id === id ? { ...rule, ...patch } : rule),
  });

  const addRule = () => onChange({
    ...config,
    rules: [...config.rules, { id: nanoid(), kind: 'tool', name: '*', decision: 'ask_user' }],
  });

  const removeRule = (id: string) => onChange({
    ...config,
    rules: config.rules.filter((rule) => rule.id !== id),
  });

  return (
    <section className="space-y-3 rounded-lg border border-base-300/50 bg-base-200/30 p-4" aria-label="HITL hard rules">
      <div>
        <h3 className="text-xs font-semibold uppercase tracking-wide text-base-content/60">Hard rules</h3>
        <p className="mt-1 text-xs text-base-content/50">
          Rules apply before Manual, Auto persona, and Jev. When rules match, Deny takes precedence over Ask user, then Allow. Bypass skips these rules; earlier permission denials still apply.
        </p>
      </div>

      {config.rules.map((rule, index) => (
        <fieldset key={rule.id} className="space-y-2 rounded-lg border border-base-300/50 bg-base-100/50 p-3">
          <legend className="px-1 text-xs font-medium">Rule {index + 1}</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="form-control gap-1">
              <span className="text-xs text-base-content/60">Operation type</span>
              <select
                aria-label={`Rule ${index + 1} operation type`}
                className="select select-sm select-bordered w-full"
                value={rule.kind}
                onChange={(event) => updateRule(rule.id, { kind: event.target.value as HitlApprovalKind | '*' })}
              >
                {RULE_KINDS.map((kind) => <option key={kind.value} value={kind.value}>{kind.label}</option>)}
              </select>
            </label>
            <label className="form-control gap-1">
              <span className="text-xs text-base-content/60">Operation or tool name</span>
              <input
                aria-label={`Rule ${index + 1} name`}
                className="input input-sm input-bordered w-full"
                value={rule.name}
                onChange={(event) => updateRule(rule.id, { name: event.target.value })}
                placeholder="*"
              />
            </label>
            <label className="form-control gap-1">
              <span className="text-xs text-base-content/60">Decision</span>
              <select
                aria-label={`Rule ${index + 1} decision`}
                className="select select-sm select-bordered w-full"
                value={rule.decision}
                onChange={(event) => updateRule(rule.id, { decision: event.target.value as HitlRuleDecision })}
              >
                {RULE_DECISIONS.map((decision) => <option key={decision.value} value={decision.value}>{decision.label}</option>)}
              </select>
            </label>
            <label className="form-control gap-1">
              <span className="text-xs text-base-content/60">Executable (optional)</span>
              <input
                aria-label={`Rule ${index + 1} executable`}
                className="input input-sm input-bordered w-full"
                value={rule.executable ?? ''}
                onChange={(event) => updateRule(rule.id, { executable: event.target.value.trim() ? event.target.value : undefined })}
                placeholder="powershell.exe"
              />
            </label>
          </div>
          <label className="form-control gap-1">
            <span className="text-xs text-base-content/60">Command argument contains (optional)</span>
            <input
              aria-label={`Rule ${index + 1} argument substring`}
              className="input input-sm input-bordered w-full"
              value={rule.argumentsContains ?? ''}
              onChange={(event) => updateRule(rule.id, { argumentsContains: event.target.value.trim() ? event.target.value : undefined })}
              placeholder="--production"
            />
          </label>
          <div className="flex justify-end">
            <button type="button" className="btn btn-ghost btn-xs text-error" onClick={() => removeRule(rule.id)}>
              Remove rule
            </button>
          </div>
        </fieldset>
      ))}

      <button type="button" className="btn btn-outline btn-xs" onClick={addRule}>Add hard rule</button>
    </section>
  );
}
