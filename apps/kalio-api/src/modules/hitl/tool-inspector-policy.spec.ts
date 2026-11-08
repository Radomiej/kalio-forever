import { afterEach, describe, expect, it, vi } from 'vitest';
import type { HitlConfig } from '@kalio/types';
import { HitlPolicyService } from './hitl-policy.service';
import type { HitlConfigService } from './hitl-config.service';
import type { HitlDecisionService } from './hitl-decision.service';
import type { HitlJevService } from './hitl-jev.service';

afterEach(() => vi.unstubAllEnvs());
function fixture() {
  vi.stubEnv('KALIO_INSTALL_PROFILE', 'qa');
  const config: HitlConfig = { mode: 'bypass', autoPersonaId: null, unattendedFallback: 'pause',
    representativePersonaId: null, notificationChannel: 'none', externalPolicyEnabled: false,
    externalPolicyPersonaId: null, raAppApprovalTimeoutMs: 0, rules: [] };
  const settings = { getConfig: async () => structuredClone(config), revision: 1, changing: false };
  const model = { evaluateApproval: vi.fn().mockResolvedValue({ assessment: { checks: {
    goal_alignment: .98, in_scope: .99, destructive_effect: .01, unauthorized_export: .01,
    evidence_sufficient: .99 }, contextFingerprint: 'a'.repeat(64) }, model: 'test', validateContext: () => true }) };
  const policy = new HitlPolicyService(settings as unknown as HitlConfigService,
    {} as HitlDecisionService, model as unknown as HitlJevService);
  const request = { kind: 'tool' as const, sessionId: 's', runId: 'r', turnId: 't', promptMessageId: 'p',
    toolCallId: 'c', name: 'terminal_spawn', args: { command: 'rg', args: ['x'], cwd: 'C:/project' } };
  return { config, model, policy, request };
}

describe('inspector enforcement before approval authority', () => {
  it.each(['resolveApproval', 'resolveUnattendedApproval'] as const)('blocks deletion even in bypass via %s', async method => {
    const f = fixture(); f.request.args.command = 'rm';
    expect(await f.policy[method](f.request)).toMatchObject({ status: 'rejected', source: 'rule' });
    expect(f.model.evaluateApproval).not.toHaveBeenCalled();
  });
  it('does not let an allow rule or human timeout bypass interpreter review', async () => {
    const f = fixture(); f.config.mode = 'jev'; f.config.confirmationAuthority = 'human_then_decision';
    f.config.humanReviewTimeoutMs = 60_000;
    f.config.rules = [{ id: 'allow', kind: 'tool', name: 'terminal_spawn', decision: 'allow' }];
    f.request.args.command = 'node';
    expect(await f.policy.resolveApproval(f.request)).toHaveProperty('status', 'manual');
    expect(await f.policy.resolveUnattendedApproval(f.request)).toHaveProperty('status', 'manual');
    expect(await f.policy.getManualReviewTimeoutMs(f.request)).toBe(0);
    expect(f.model.evaluateApproval).not.toHaveBeenCalled();
  });
  it('preserves explicit user deny precedence and its audit reason', async () => {
    const f = fixture(); f.request.args.command = 'curl';
    f.config.rules = [{ id: 'user-deny', kind: 'tool', name: 'terminal_spawn', decision: 'deny' }];
    expect((await f.policy.resolveApproval(f.request)).reason).toContain('user-deny');
  });
  it('requires the production floor even when request arguments claim development', async () => {
    const f = fixture(); f.config.mode = 'jev'; f.config.confirmationAuthority = 'decision_model';
    f.config.jevApprovalThreshold = .8;
    expect(await f.policy.resolveApproval(f.request)).toHaveProperty('status', 'approved');
    vi.stubEnv('KALIO_INSTALL_PROFILE', 'prod');
    expect(await f.policy.resolveApproval(f.request)).toHaveProperty('status', 'manual');
  });
});
