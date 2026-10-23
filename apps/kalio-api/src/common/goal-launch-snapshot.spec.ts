import { afterEach, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { GoalLaunchHostRequirement } from '@kalio/types';
const home = vi.hoisted(() => ({ path: '' }));
vi.mock('node:os', async original => ({ ...await original<typeof import('node:os')>(), homedir: () => home.path }));
import { GoalLaunchSnapshotAdapter, type GoalLaunchSnapshotOwners } from './goal-launch-snapshot';
import { hashGoalLaunchJson } from './goal-launch-canonical';
import { ArchitectureRegistryService } from '../modules/architecture/architecture-registry.service';
import { publishArchitectureGoalSchema } from '../modules/architecture/architecture-goal-schema-publication';
import { publishSchemaAliasFlow } from '../modules/agent-flow/agent-flow-schema-alias';
import { KalioConfigService } from '../config/kalio-config.service';
import { parseGoalLaunchPolicyConfig } from '../config/goal-launch-policy.config';

function fixture() {
  const registry = new ArchitectureRegistryService();
  const schemaId = 'goal-master-delivery-loop'; const flowDefinitionId = 'goal_guard_delivery_loop';
  const schemaDefinition = publishArchitectureGoalSchema(registry.findOne(schemaId)!).publication;
  const schemaDefinitionSha256 = hashGoalLaunchJson(schemaDefinition);
  const flowDefinition = publishSchemaAliasFlow(flowDefinitionId, schemaId, schemaDefinitionSha256).publication;
  const flowDefinitionSha256 = hashGoalLaunchJson(flowDefinition);
  const policy = parseGoalLaunchPolicyConfig({ enabled: true, policyId: 'host-policy', allowedBindings: [{ flowDefinitionId, schemaId, flowDefinitionSha256, schemaDefinitionSha256 }] })!;
  const requirement: GoalLaunchHostRequirement = { kind: 'human_only', toolName: 'run_sub_agentflow', callId: 'call', goalLaunch: {
    schemaVersion: 1, parentWaitingRevision: 1, disclosureSha256: 'a'.repeat(64), argsSha256: 'b'.repeat(64), parentRunId: 'run', parentSessionId: 'session', parentTurnId: 'turn', promptMessageId: 'prompt', assistantMessageId: 'assistant',
    flowDefinitionId, schemaId, policyId: policy.policyId, schemaDefinitionSha256, flowDefinitionSha256, policySha256: hashGoalLaunchJson(policy) } };
  const owners: GoalLaunchSnapshotOwners = { readSchemaPublication: id => { const schema = registry.findOne(id); return schema ? publishArchitectureGoalSchema(schema).publication : null; }, publishAlias: (flow, schema, hash) => publishSchemaAliasFlow(flow, schema, hash).publication, readUserPolicy: async () => policy };
  return { owners, requirement, policy, flowDefinition, schemaDefinition };
}
it('returns detached full real-owner publications and computed bindings', async () => {
  const f = fixture(); const result = await new GoalLaunchSnapshotAdapter(f.owners).readCurrent(f.requirement);
  expect(result).toEqual({ status: 'eligible', flowDefinitionId: f.requirement.goalLaunch.flowDefinitionId, schemaId: f.requirement.goalLaunch.schemaId, policyId: 'host-policy', flowDefinition: f.flowDefinition, schemaDefinition: f.schemaDefinition, policy: f.policy });
  if (result.status === 'eligible') expect(result.policy).not.toBe(f.policy);
});
it.each(['readSchemaPublication', 'publishAlias', 'readUserPolicy'] as const)('requires owner %s, no default', key => {
  const f = fixture(); expect(() => new GoalLaunchSnapshotAdapter({ ...f.owners, [key]: undefined } as unknown as GoalLaunchSnapshotOwners)).toThrow(/^GOAL_LAUNCH_SNAPSHOT_INVALID$/);
});
it('rejects empty constructor and no-op publications', async () => {
  expect(() => new GoalLaunchSnapshotAdapter(undefined as unknown as GoalLaunchSnapshotOwners)).toThrow(/^GOAL_LAUNCH_SNAPSHOT_INVALID$/);
  const f = fixture(); await expect(new GoalLaunchSnapshotAdapter({ ...f.owners, publishAlias: () => undefined }).readCurrent(f.requirement)).rejects.toThrow(/^GOAL_LAUNCH_SNAPSHOT_INVALID$/);
});
it.each(['policy', 'schema'] as const)('missing %s is ineligible', async kind => {
  const f = fixture(); const owners = { ...f.owners, ...(kind === 'policy' ? { readUserPolicy: async () => null } : { readSchemaPublication: () => null }) };
  expect(await new GoalLaunchSnapshotAdapter(owners).readCurrent(f.requirement)).toEqual({ status: 'ineligible' });
});
it.each(['policyId', 'flowDefinitionSha256', 'schemaDefinitionSha256', 'policySha256'] as const)('binding mismatch %s cannot grant eligibility', async field => {
  const f = fixture(); f.requirement.goalLaunch[field] = field === 'policyId' ? 'other' : '0'.repeat(64);
  expect(await new GoalLaunchSnapshotAdapter(f.owners).readCurrent(f.requirement)).toEqual({ status: 'ineligible' });
});
it('requires exact allowlist tuple, never existence inference', async () => {
  const f = fixture(); f.policy.eligibleDefinitions[0]!.flowDefinitionSha256 = '0'.repeat(64); f.requirement.goalLaunch.policySha256 = hashGoalLaunchJson(f.policy);
  expect(await new GoalLaunchSnapshotAdapter(f.owners).readCurrent(f.requirement)).toEqual({ status: 'ineligible' });
});
it.each(['schemaVersion', 'kind', 'selection', 'approvalAuthority', 'behavior', 'approvalBoundary', 'extra'] )('rejects malformed policy %s', async field => {
  const f = fixture(); const policy = { ...f.policy, [field]: 'SECRET' };
  await expect(new GoalLaunchSnapshotAdapter({ ...f.owners, readUserPolicy: async () => policy }).readCurrent(f.requirement)).rejects.toThrow(/^GOAL_LAUNCH_SNAPSHOT_INVALID$/);
});
it('rejects duplicate/unsorted or oversized policy sets', async () => {
  for (const kind of ['duplicate', 'unsorted', 'oversized']) {
    const f = fixture(); const row = f.policy.eligibleDefinitions[0]!;
    f.policy.eligibleDefinitions = kind === 'duplicate' ? [row, row] : kind === 'unsorted' ? [row, { ...row, flowDefinitionId: 'a' }] : Array.from({ length: 65 }, () => row);
    await expect(new GoalLaunchSnapshotAdapter(f.owners).readCurrent(f.requirement)).rejects.toThrow(/^GOAL_LAUNCH_SNAPSHOT_INVALID$/);
  }
});
it('rejects schema embedded ID, extra wrapper fields and alias links', async () => {
  const f = fixture();
  for (const publication of [{ ...f.schemaDefinition, definition: { ...f.schemaDefinition.definition, id: 'other' } }, { ...f.schemaDefinition, extra: true }]) {
    await expect(new GoalLaunchSnapshotAdapter({ ...f.owners, readSchemaPublication: () => publication }).readCurrent(f.requirement)).rejects.toThrow(/^GOAL_LAUNCH_SNAPSHOT_INVALID$/);
  }
  for (const patch of [{ schemaDefinitionSha256: '0'.repeat(64) }, { schemaId: 'other' }, { flowDefinitionId: 'other' }, { sha256: 'fake' }]) {
    await expect(new GoalLaunchSnapshotAdapter({ ...f.owners, publishAlias: () => ({ ...f.flowDefinition, ...patch }) }).readCurrent(f.requirement)).rejects.toThrow(/^GOAL_LAUNCH_SNAPSHOT_INVALID$/);
  }
});
it('detaches original requirement before asynchronous owner mutation', async () => {
  const f = fixture(); const original = f.requirement.goalLaunch.schemaId;
  const result = await new GoalLaunchSnapshotAdapter({ ...f.owners, readUserPolicy: async () => { f.requirement.goalLaunch.schemaId = 'forged'; return f.policy; } }).readCurrent(f.requirement);
  expect(result.status).toBe('eligible'); if (result.status === 'eligible') expect(result.schemaId).toBe(original);
});
it('detaches policy before schema owner mutation', async () => {
  const f = fixture(); const schemaOwner = f.owners.readSchemaPublication;
  const result = await new GoalLaunchSnapshotAdapter({ ...f.owners, readSchemaPublication: id => { f.policy.policyId = 'forged'; return schemaOwner(id); } }).readCurrent(f.requirement);
  expect(result.status).toBe('eligible'); if (result.status === 'eligible') expect(result.policyId).toBe('host-policy');
});
it('rejects hostile getters without invocation and leaks no owner failure', async () => {
  const f = fixture(); let calls = 0;
  const policy = { ...f.policy, get secret() { calls++; return 'SECRET'; } };
  await expect(new GoalLaunchSnapshotAdapter({ ...f.owners, readUserPolicy: async () => policy }).readCurrent(f.requirement)).rejects.toThrow(/^GOAL_LAUNCH_SNAPSHOT_INVALID$/); expect(calls).toBe(0);
  for (const key of ['readSchemaPublication', 'publishAlias', 'readUserPolicy'] as const) {
    await expect(new GoalLaunchSnapshotAdapter({ ...f.owners, [key]: () => { throw new Error('SECRET'); } }).readCurrent(f.requirement)).rejects.toThrow(/^GOAL_LAUNCH_SNAPSHOT_READ_FAILED$/);
  }
});
it('sanitizes abort before entry and after policy await', async () => {
  const f = fixture(); const controller = new AbortController(); controller.abort('SECRET');
  await expect(new GoalLaunchSnapshotAdapter(f.owners).readCurrent(f.requirement, controller.signal)).rejects.toThrow(/^GOAL_LAUNCH_SNAPSHOT_ABORTED$/);
  const later = new AbortController(); await expect(new GoalLaunchSnapshotAdapter({ ...f.owners, readUserPolicy: async signal => { expect(signal).toBe(later.signal); later.abort('SECRET'); throw new Error('SECRET'); } }).readCurrent(f.requirement, later.signal)).rejects.toThrow(/^GOAL_LAUNCH_SNAPSHOT_ABORTED$/);
});
const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(path => rm(path, { recursive: true, force: true }))); });
it('integrates actual registry, alias publisher and fresh temporary user policy', async () => {
  const f = fixture(); home.path = await mkdtemp(join(tmpdir(), 'goal-snapshot-')); roots.push(home.path); await mkdir(join(home.path, '.kalio'));
  const row = f.policy.eligibleDefinitions[0]!;
  const path = join(home.path, '.kalio', 'config.toml');
  await writeFile(path, `[goal_launch_policy]\nenabled=true\npolicyId="host-policy"\n[[goal_launch_policy.allowedBindings]]\nflowDefinitionId="${row.flowDefinitionId}"\nschemaId="${row.schemaId}"\nflowDefinitionSha256="${row.flowDefinitionSha256}"\nschemaDefinitionSha256="${row.schemaDefinitionSha256}"\n`);
  const config = new KalioConfigService(); const adapter = new GoalLaunchSnapshotAdapter({ ...f.owners, readUserPolicy: signal => config.getUserGoalLaunchPolicy(signal) });
  expect((await adapter.readCurrent(f.requirement)).status).toBe('eligible');
  await writeFile(path, '[goal_launch_policy]\nenabled=false'); expect(await adapter.readCurrent(f.requirement)).toEqual({ status: 'ineligible' });
});
