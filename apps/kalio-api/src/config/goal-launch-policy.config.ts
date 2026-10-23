import { canonicalGoalLaunchJson } from '../common/goal-launch-canonical';

export interface GoalLaunchEligibleDefinition {
  flowDefinitionId: string;
  schemaId: string;
  flowDefinitionSha256: string;
  schemaDefinitionSha256: string;
}
export interface GoalLaunchPolicyPublication {
  schemaVersion: 1;
  kind: 'goal_launch_policy';
  policyId: string;
  selection: 'explicit_allowlist';
  approvalAuthority: 'decision_browser_goal_launch';
  behavior: 'attempt_goal_continuation_until_review_or_blocked';
  approvalBoundary: 'confirmation_required_actions_remain_independent';
  eligibleDefinitions: GoalLaunchEligibleDefinition[];
}
const invalid = (): never => { throw new Error('GOAL_LAUNCH_POLICY_INVALID'); };
const fields = ['flowDefinitionId', 'schemaId', 'flowDefinitionSha256', 'schemaDefinitionSha256'] as const;
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid();
  return value as Record<string, unknown>;
}
function exact(value: Record<string, unknown>, keys: readonly string[]): void {
  if (Object.keys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key))) invalid();
}
function id(value: unknown): string {
  if (typeof value !== 'string' || !value.length || value.trim() !== value || [...value].length > 512) return invalid();
  return value;
}
function hash(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) return invalid();
  return value;
}
function compare(a: GoalLaunchEligibleDefinition, b: GoalLaunchEligibleDefinition): number {
  for (const key of fields) { if (a[key] < b[key]) return -1; if (a[key] > b[key]) return 1; }
  return 0;
}
/** Explicit host-config limit: 1..64 bindings. Canonical set order is the full
 * ordinal tuple, never locale ordering or identifier/hash normalization. */
export function parseGoalLaunchPolicyConfig(raw: unknown): GoalLaunchPolicyPublication | null {
  if (raw === undefined || raw === null) return null;
  try {
    const input = object(JSON.parse(canonicalGoalLaunchJson(raw)) as unknown);
    if (!Object.hasOwn(input, 'enabled') || input.enabled === false) return null;
    exact(input, ['enabled', 'policyId', 'allowedBindings']);
    if (input.enabled !== true || !Array.isArray(input.allowedBindings) || input.allowedBindings.length < 1 || input.allowedBindings.length > 64) return invalid();
    const eligibleDefinitions = input.allowedBindings.map((rawBinding: unknown) => {
      const row = object(rawBinding); exact(row, fields);
      return { flowDefinitionId: id(row.flowDefinitionId), schemaId: id(row.schemaId), flowDefinitionSha256: hash(row.flowDefinitionSha256), schemaDefinitionSha256: hash(row.schemaDefinitionSha256) };
    }).sort(compare);
    if (eligibleDefinitions.some((row, index) => index > 0 && compare(row, eligibleDefinitions[index - 1]!) === 0)) return invalid();
    return { schemaVersion: 1, kind: 'goal_launch_policy', policyId: id(input.policyId), selection: 'explicit_allowlist', approvalAuthority: 'decision_browser_goal_launch', behavior: 'attempt_goal_continuation_until_review_or_blocked', approvalBoundary: 'confirmation_required_actions_remain_independent', eligibleDefinitions };
  } catch { return invalid(); }
}
