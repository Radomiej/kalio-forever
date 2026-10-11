import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const fixture = vi.hoisted(() => ({ home: '' }));
vi.mock('node:os', async importOriginal => ({ ...await importOriginal<typeof import('node:os')>(), homedir: () => fixture.home }));
import { KalioConfigService } from './kalio-config.service';
import { parseGoalLaunchPolicyConfig } from './goal-launch-policy.config';

const binding = (flowDefinitionId = 'flow') => ({ flowDefinitionId, schemaId: 'schema', flowDefinitionSha256: 'a'.repeat(64), schemaDefinitionSha256: 'b'.repeat(64) });
const config = () => ({ enabled: true, policyId: 'host-policy', allowedBindings: [binding()] });
describe('explicit goal policy', () => {
  it('publishes exact host constants and detached sorted set', () => {
    const input = { ...config(), allowedBindings: [binding('z'), binding('a')] };
    const output = parseGoalLaunchPolicyConfig(input);
    expect(output).toEqual({ schemaVersion: 1, kind: 'goal_launch_policy', policyId: 'host-policy', selection: 'explicit_allowlist', approvalAuthority: 'decision_browser_goal_launch', behavior: 'attempt_goal_continuation_until_review_or_blocked', approvalBoundary: 'confirmation_required_actions_remain_independent', eligibleDefinitions: [binding('a'), binding('z')] });
    input.allowedBindings[1]!.schemaId = 'changed';
    expect(output?.eligibleDefinitions[0]?.schemaId).toBe('schema');
    expect(input.allowedBindings[0]?.flowDefinitionId).toBe('z');
  });
  it('sorts every tuple component ordinally', () => {
    const rows = [binding(), { ...binding(), schemaDefinitionSha256: 'a'.repeat(64) }, { ...binding(), flowDefinitionSha256: '0'.repeat(64) }, { ...binding(), schemaId: 'a' }];
    expect(parseGoalLaunchPolicyConfig({ ...config(), allowedBindings: rows })?.eligibleDefinitions).toEqual([rows[3], rows[2], rows[1], rows[0]]);
  });
  it.each([undefined, null, {}, { enabled: false, policyId: 7 }])('missing/disabled is ineligible', input => expect(parseGoalLaunchPolicyConfig(input)).toBeNull());
  it.each([ { ...config(), enabled: 'true' }, { ...config(), policyId: '' }, { ...config(), policyId: ' padded' }, { ...config(), policyId: '\ud800' }, { ...config(), policyId: 'x'.repeat(513) }, { ...config(), extra: true }, { ...config(), allowedBindings: [] }, { ...config(), allowedBindings: [binding(), binding()] }, { ...config(), allowedBindings: [{ ...binding(), schemaId: 'x ' }] }, { ...config(), allowedBindings: [{ ...binding(), flowDefinitionSha256: 'A'.repeat(64) }] }, { ...config(), allowedBindings: Array.from({ length: 65 }, (_, i) => binding(String(i))) } ])('rejects malformed active config statically', input => expect(() => parseGoalLaunchPolicyConfig(input)).toThrow('GOAL_LAUNCH_POLICY_INVALID'));
  it('counts Unicode codepoints and accepts exactly 64 bindings', () => {
    expect(parseGoalLaunchPolicyConfig({ ...config(), policyId: '😀'.repeat(512), allowedBindings: Array.from({ length: 64 }, (_, i) => binding(String(i))) })).not.toBeNull();
    expect(() => parseGoalLaunchPolicyConfig({ ...config(), policyId: '😀'.repeat(513) })).toThrow('GOAL_LAUNCH_POLICY_INVALID');
  });
  it('does not execute getters/toJSON or expose content', () => {
    let reads = 0;
    const input = { ...config(), get secret() { reads++; return 'SECRET'; } };
    expect(() => parseGoalLaunchPolicyConfig(input)).toThrow('GOAL_LAUNCH_POLICY_INVALID');
    expect(() => parseGoalLaunchPolicyConfig({ ...config(), toJSON() { reads++; return {}; } })).toThrow('GOAL_LAUNCH_POLICY_INVALID');
    expect(reads).toBe(0);
  });
  it('rejects symbols, cycles, sparse arrays and non-JSON without loss', () => {
    const cyclic: Record<string, unknown> = config(); cyclic.self = cyclic;
    const sparse = new Array<unknown>(1);
    for (const input of [{ ...config(), [Symbol('metadata')]: true }, cyclic, { ...config(), allowedBindings: sparse }, { ...config(), policyId: Infinity }, { ...config(), policyId: undefined }]) {
      expect(() => parseGoalLaunchPolicyConfig(input)).toThrow(/^GOAL_LAUNCH_POLICY_INVALID$/);
    }
  });
});
describe('fresh user-only policy reader', () => {
  const roots: string[] = [];
  afterEach(async () => { await Promise.all(roots.map(path => rm(path, { recursive: true, force: true }))); roots.length = 0; vi.restoreAllMocks(); });
  async function setup() {
    const root = await mkdtemp(join(tmpdir(), 'goal-policy-')); roots.push(root); fixture.home = join(root, 'home');
    await mkdir(join(fixture.home, '.kalio'), { recursive: true });
    return join(fixture.home, '.kalio', 'config.toml');
  }
  const toml = (id: string) => `[goal_launch_policy]\nenabled=true\npolicyId="${id}"\n[[goal_launch_policy.allowedBindings]]\nflowDefinitionId="flow"\nschemaId="schema"\nflowDefinitionSha256="${'a'.repeat(64)}"\nschemaDefinitionSha256="${'b'.repeat(64)}"\n`;
  it('reads fresh despite effective cache and never scans project layers', async () => {
    const path = await setup(); await writeFile(path, toml('one'));
    const service = new KalioConfigService(); await service.getEffectiveConfig();
    const project = join(fixture.home, 'project'); await mkdir(join(project, '.kalio'), { recursive: true });
    await writeFile(join(project, '.kalio', 'config.toml'), toml('project-override'));
    const effective = await service.loadEffectiveConfig({ cwd: project, homeDir: fixture.home });
    expect((effective.config as unknown as { goal_launch_policy: { policyId: string } }).goal_launch_policy.policyId).toBe('project-override');
    const projectScan = vi.spyOn(service, 'loadEffectiveConfig');
    expect((await service.getUserGoalLaunchPolicy())?.policyId).toBe('one');
    await writeFile(path, toml('two'));
    expect((await service.getUserGoalLaunchPolicy())?.policyId).toBe('two');
    expect(projectScan).not.toHaveBeenCalled();
  });
  it('missing file/section returns null', async () => {
    const path = await setup(); const service = new KalioConfigService();
    expect(await service.getUserGoalLaunchPolicy()).toBeNull();
    await writeFile(path, '[runtime]\nmax_tokens=4'); expect(await service.getUserGoalLaunchPolicy()).toBeNull();
  });
  it('sanitizes parsing and preserves legacy parse error', async () => {
    const path = await setup(); await writeFile(path, 'SECRET invalid TOML'); const service = new KalioConfigService();
    await expect(service.getUserGoalLaunchPolicy()).rejects.toThrow(/^GOAL_LAUNCH_POLICY_READ_FAILED$/);
    await expect(service.loadEffectiveConfig({ homeDir: fixture.home })).rejects.toThrow('Failed to parse Kalio config');
  });
  it('sanitizes abort before and after read', async () => {
    await setup(); const service = new KalioConfigService(); const abort = new AbortController(); abort.abort('SECRET');
    await expect(service.getUserGoalLaunchPolicy(abort.signal)).rejects.toThrow(/^GOAL_LAUNCH_POLICY_ABORTED$/);
    const later = new AbortController();
    vi.spyOn(service as unknown as { readConfigFile: () => Promise<unknown> }, 'readConfigFile').mockImplementation(async () => { later.abort('SECRET'); return {}; });
    await expect(service.getUserGoalLaunchPolicy(later.signal)).rejects.toThrow(/^GOAL_LAUNCH_POLICY_ABORTED$/);
  });
});
