import { parseGoalLaunchHostRequirement, type GoalLaunchHostRequirement } from '@kalio/types';
import { canonicalGoalLaunchJson, hashGoalLaunchJson } from './goal-launch-canonical';

export type GoalLaunchCurrentSnapshot = { status: 'ineligible' } | {
  status: 'eligible'; flowDefinitionId: string; schemaId: string; policyId: string;
  flowDefinition: unknown; schemaDefinition: unknown; policy: unknown;
};
export interface GoalLaunchSnapshotPort {
  readCurrent(requirement: GoalLaunchHostRequirement, signal?: AbortSignal): Promise<GoalLaunchCurrentSnapshot>;
}
export interface GoalLaunchSnapshotOwners {
  readSchemaPublication(schemaId: string): unknown | null;
  publishAlias(flowDefinitionId: string, schemaId: string, currentSchemaHash: string): unknown;
  readUserPolicy(signal?: AbortSignal): Promise<unknown | null>;
}
const invalid = (): never => { throw new Error('GOAL_LAUNCH_SNAPSHOT_INVALID'); };
function abort(signal?: AbortSignal): void {
  if (signal?.aborted) throw new Error('GOAL_LAUNCH_SNAPSHOT_ABORTED');
}
function detach(raw: unknown): unknown {
  try { return JSON.parse(canonicalGoalLaunchJson(raw)) as unknown; } catch { return invalid(); }
}
function record(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return invalid();
  return raw as Record<string, unknown>;
}
function exact(raw: Record<string, unknown>, fields: readonly string[]): void {
  if (Object.keys(raw).length !== fields.length || fields.some(key => !Object.hasOwn(raw, key))) invalid();
}
function id(raw: unknown): string {
  if (typeof raw !== 'string' || !raw.length || raw.trim() !== raw || [...raw].length > 512) return invalid();
  return raw;
}
function hash(raw: unknown): string {
  if (typeof raw !== 'string' || !/^[a-f0-9]{64}$/.test(raw)) return invalid();
  return raw;
}
const tupleFields = ['flowDefinitionId', 'schemaId', 'flowDefinitionSha256', 'schemaDefinitionSha256'] as const;
type Binding = Record<typeof tupleFields[number], string>;
function compare(a: Binding, b: Binding): number {
  for (const key of tupleFields) { if (a[key] < b[key]) return -1; if (a[key] > b[key]) return 1; }
  return 0;
}
function policyBindings(policy: Record<string, unknown>): Binding[] {
  exact(policy, ['schemaVersion', 'kind', 'policyId', 'selection', 'approvalAuthority', 'behavior', 'approvalBoundary', 'eligibleDefinitions']);
  if (policy.schemaVersion !== 1 || policy.kind !== 'goal_launch_policy' || policy.selection !== 'explicit_allowlist'
    || policy.approvalAuthority !== 'decision_browser_goal_launch' || policy.behavior !== 'attempt_goal_continuation_until_review_or_blocked'
    || policy.approvalBoundary !== 'confirmation_required_actions_remain_independent') return invalid();
  id(policy.policyId);
  if (!Array.isArray(policy.eligibleDefinitions) || policy.eligibleDefinitions.length < 1 || policy.eligibleDefinitions.length > 64) return invalid();
  const bindings = policy.eligibleDefinitions.map((raw: unknown) => {
    const row = record(raw); exact(row, tupleFields);
    return { flowDefinitionId: id(row.flowDefinitionId), schemaId: id(row.schemaId), flowDefinitionSha256: hash(row.flowDefinitionSha256), schemaDefinitionSha256: hash(row.schemaDefinitionSha256) };
  });
  // Publication is already a canonical ordered set. Never repair owner output.
  if (bindings.some((row, index) => index > 0 && compare(bindings[index - 1]!, row) >= 0)) return invalid();
  return bindings;
}

/** Mandatory real owner ports; no default eligibility. This is NOT an atomic
 * multi-owner snapshot or launch authorization. Launch must recheck currentness. */
function captureOwners(owners: GoalLaunchSnapshotOwners): GoalLaunchSnapshotOwners {
    try {
      if (!owners || typeof owners.readSchemaPublication !== 'function' || typeof owners.publishAlias !== 'function'
        || typeof owners.readUserPolicy !== 'function') return invalid();
      return { readSchemaPublication: owners.readSchemaPublication.bind(owners), publishAlias: owners.publishAlias.bind(owners), readUserPolicy: owners.readUserPolicy.bind(owners) };
    } catch { return invalid(); }
}
export class GoalLaunchSnapshotAdapter implements GoalLaunchSnapshotPort {
  private readonly owners: GoalLaunchSnapshotOwners;
  constructor(owners: GoalLaunchSnapshotOwners) { this.owners = captureOwners(owners); }
  async readCurrent(requirement: GoalLaunchHostRequirement, signal?: AbortSignal): Promise<GoalLaunchCurrentSnapshot> {
    abort(signal);
    let captured: GoalLaunchHostRequirement;
    try { captured = parseGoalLaunchHostRequirement(detach(requirement)); } catch { return invalid(); }
    const binding = captured.goalLaunch;
    let rawPolicy: unknown;
    try { rawPolicy = await this.owners.readUserPolicy(signal); }
    catch { abort(signal); throw new Error('GOAL_LAUNCH_SNAPSHOT_READ_FAILED'); }
    abort(signal);
    if (rawPolicy === null) return { status: 'ineligible' };
    const policy = record(detach(rawPolicy)); const bindings = policyBindings(policy);
    let rawSchema: unknown;
    try { rawSchema = this.owners.readSchemaPublication(binding.schemaId); }
    catch { abort(signal); throw new Error('GOAL_LAUNCH_SNAPSHOT_READ_FAILED'); }
    abort(signal);
    if (rawSchema === null) return { status: 'ineligible' };
    const schemaDefinition = record(detach(rawSchema));
    exact(schemaDefinition, ['schemaVersion', 'kind', 'schemaId', 'definition']);
    if (schemaDefinition.schemaVersion !== 1 || schemaDefinition.kind !== 'goal_schema'
      || id(schemaDefinition.schemaId) !== binding.schemaId || id(record(schemaDefinition.definition).id) !== binding.schemaId) return invalid();
    const schemaDefinitionSha256 = hashGoalLaunchJson(schemaDefinition);
    let rawFlow: unknown;
    try { rawFlow = this.owners.publishAlias(binding.flowDefinitionId, binding.schemaId, schemaDefinitionSha256); }
    catch { abort(signal); throw new Error('GOAL_LAUNCH_SNAPSHOT_READ_FAILED'); }
    abort(signal);
    const flowDefinition = record(detach(rawFlow));
    exact(flowDefinition, ['schemaVersion', 'kind', 'flowDefinitionId', 'schemaId', 'schemaDefinitionSha256']);
    if (flowDefinition.schemaVersion !== 1 || flowDefinition.kind !== 'schema_alias'
      || id(flowDefinition.flowDefinitionId) !== binding.flowDefinitionId || id(flowDefinition.schemaId) !== binding.schemaId
      || hash(flowDefinition.schemaDefinitionSha256) !== schemaDefinitionSha256) return invalid();
    const flowDefinitionSha256 = hashGoalLaunchJson(flowDefinition);
    const policySha256 = hashGoalLaunchJson(policy);
    const candidate: Binding = { flowDefinitionId: binding.flowDefinitionId, schemaId: binding.schemaId, flowDefinitionSha256, schemaDefinitionSha256 };
    if (policy.policyId !== binding.policyId || flowDefinitionSha256 !== binding.flowDefinitionSha256
      || schemaDefinitionSha256 !== binding.schemaDefinitionSha256 || policySha256 !== binding.policySha256
      || !bindings.some(row => compare(row, candidate) === 0)) return { status: 'ineligible' };
    abort(signal);
    return { status: 'eligible', flowDefinitionId: binding.flowDefinitionId, schemaId: binding.schemaId, policyId: binding.policyId,
      flowDefinition, schemaDefinition, policy };
  }
}
