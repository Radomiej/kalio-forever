import { cloneGoalCompletionJson } from './architecture-goal-completion-state';

const keys = ['goalBinding', 'completionBinding', 'criterionId'] as const;
const hashes = ['goalFingerprint', 'sourceFingerprint', 'evidenceFingerprint', 'policyFingerprint'] as const;
function fail(): never { throw new Error('GOAL_ROUTE_AUDIT_INVALID'); }
function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
function positive(value: unknown): boolean { return typeof value === 'number' && Number.isSafeInteger(value) && value > 0; }
function hash(value: unknown): boolean { return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value); }
function exact(value: Record<string, unknown>, required: readonly string[], optional: readonly string[] = []): boolean {
  return required.every(key => Object.hasOwn(value, key))
    && Object.keys(value).every(key => required.includes(key) || optional.includes(key));
}

/** Persistence projection only, never authorization. Recovery must still verify
 * these exact fields against current trusted state, receipt, node and visit. */
export function goalRouteAuditData(data: Record<string, unknown> | undefined): Record<string, unknown> {
  try {
    if (!data || !keys.some(key => Object.hasOwn(data, key))) return {};
    const selected: Record<string, unknown> = {};
    for (const key of keys) {
      if (!Object.hasOwn(data, key)) continue;
      const descriptor = Object.getOwnPropertyDescriptor(data, key);
      if (!descriptor?.enumerable || !('value' in descriptor)) return fail();
      selected[key] = cloneGoalCompletionJson(descriptor.value);
    }
    const goal = selected.goalBinding;
    if (!record(goal) || !exact(goal, ['stateRevision', 'sourceVersion', 'sourceFingerprint'], ['proposalFingerprint'])
      || !positive(goal.stateRevision) || !positive(goal.sourceVersion) || !hash(goal.sourceFingerprint)
      || Object.hasOwn(goal, 'proposalFingerprint') && !hash(goal.proposalFingerprint)) return fail();
    if (Object.hasOwn(selected, 'completionBinding')) {
      const completion = selected.completionBinding;
      if (!record(completion) || !exact(completion, ['goalVersion', ...hashes])
        || !positive(completion.goalVersion) || completion.goalVersion !== goal.sourceVersion
        || hashes.some(key => !hash(completion[key])) || completion.sourceFingerprint !== goal.sourceFingerprint) return fail();
    }
    if (Object.hasOwn(selected, 'criterionId') && (!Object.hasOwn(selected, 'completionBinding')
      || typeof selected.criterionId !== 'string' || !selected.criterionId.trim())) return fail();
    return selected;
  } catch { return fail(); }
}
