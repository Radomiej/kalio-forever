import type { HostGoalPolicyFactory } from './architecture-goal-projection.service';

/** User-approved coding default. Evidence kinds are requirements, never proof.
 * QUALITY_GATE must be backed by the independent reviewer, not worker prose.
 * Commit/publication are separate explicit requirements, never implicit here. */
export const codingGoalCompletionPolicy: HostGoalPolicyFactory = (active) => {
  const ids = active.map(criterion => criterion.id);
  if (!ids.length || ids.some(id => typeof id !== 'string' || !id || id.trim() !== id)
    || new Set(ids).size !== ids.length) throw new Error('GOAL_CODING_POLICY_INVALID');
  return { requiredEvidenceKindsByCriterion: Object.fromEntries(ids.map(id =>
    [id, ['BUILD_RESULT', 'QUALITY_GATE'] as const])) };
};
