import { describe, expect, it, vi } from 'vitest';
import type { HitlConfig } from '@kalio/types';
import { HitlPolicyService } from './hitl-policy.service';
import type { HitlConfigService } from './hitl-config.service';
import type { HitlDecisionService } from './hitl-decision.service';
import type { HitlJevService } from './hitl-jev.service';
import { ToolDispatchService } from '../chat/tool-dispatch.service';
import { TurnState } from '../chat/turn-state';
import type { StreamContext } from '../chat/interfaces/stream-context.interface';

function fixture() {
  const config: HitlConfig = { mode: 'jev', confirmationAuthority: 'decision_model', autoPersonaId: null,
    unattendedFallback: 'pause', representativePersonaId: null, notificationChannel: 'none',
    externalPolicyEnabled: false, externalPolicyPersonaId: null, raAppApprovalTimeoutMs: 0,
    jevApprovalThreshold: 0.95, rules: [] };
  const checks = { goal_alignment: 0.99, in_scope: 0.99, destructive_effect: 0.01,
    unauthorized_export: 0.01, evidence_sufficient: 0.99 };
  let current = true;
  const evaluation = { assessment: { checks, contextFingerprint: 'a'.repeat(64) }, model: 'test-jev',
    validateContext: vi.fn(() => current) };
  const settings = { getConfig: vi.fn(async () => structuredClone(config)), revision: 1, changing: false };
  const model = { evaluateApproval: vi.fn().mockResolvedValue(evaluation) };
  const persona = { evaluateApproval: vi.fn().mockResolvedValue({ decision: 'allow', agree: true }) };
  const policy = new HitlPolicyService(settings as unknown as HitlConfigService,
    persona as unknown as HitlDecisionService, model as unknown as HitlJevService);
  const request = { kind: 'tool' as const, sessionId: 's', runId: 'r', turnId: 't', promptMessageId: 'p',
    toolCallId: 'c', name: 'terminal_spawn', args: { command: 'rg', cwd: '/project', args: ['x'] } };
  return { config, checks, evaluation, settings, model, persona, policy, request, stale: () => { current = false; } };
}

describe('contextual Jev approval at the policy boundary', () => {
  it('requires every named check and a current one-use context before execution', async () => {
    const f = fixture(); const result = await f.policy.resolveApproval(f.request);
    expect(result).toMatchObject({ status: 'approved', source: 'jev' });
    expect(result.reason).toContain('goal_alignment');
    expect(await result.validateBeforeExecution?.()).toBe(true);
    expect(await result.validateBeforeExecution?.()).toBe(false);
  });
  it.each(['destructive_effect', 'unauthorized_export'] as const)('never averages away %s', async axis => {
    const f = fixture(); f.checks[axis] = 0.99;
    expect(await f.policy.resolveApproval(f.request)).toMatchObject({ status: 'rejected', source: 'jev' });
  });
  it('keeps an uncertain axis manual', async () => {
    const f = fixture(); f.checks.evidence_sufficient = 0.7;
    expect(await f.policy.resolveApproval(f.request)).toHaveProperty('status', 'manual');
  });
  it('does not enter the executor when context changes after model assessment', async () => {
    const f = fixture(), execute = vi.fn();
    const tool = { meta: { name: 'terminal_spawn', description: '', parameters: { type: 'object' }, requiresConfirmation: true }, execute };
    const dispatch = new ToolDispatchService([tool], null, f.policy, null);
    const ctx: StreamContext = { sessionId: 's', runId: 'r', turnId: 't', promptMessageId: 'p', messageId: 'm',
      state: new TurnState(), emit: vi.fn(), abortSignal: new AbortController().signal,
      markToolRunning: async () => { f.stale(); } };
    expect((await dispatch.dispatch('c', 'terminal_spawn', f.request.args, ctx)).status).toBe('cancelled');
    expect(f.model.evaluateApproval).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      runId: 'r', turnId: 't', promptMessageId: 'p', sessionId: 's', toolCallId: 'c',
    }));
    expect(execute).not.toHaveBeenCalled();
  }, 2_000);
  it('does not downgrade delegated evaluation to a legacy single probability', async () => {
    const f = fixture(); f.model.evaluateApproval.mockResolvedValue({ probability: 1, model: 'legacy' });
    expect(await f.policy.resolveApproval(f.request)).toHaveProperty('status', 'manual');
  });
  it('does not ask a fallback persona to authorize a failed contextual review', async () => {
    const f = fixture(); f.config.jevFallbackToPersona = true; f.config.autoPersonaId = 'fallback';
    f.model.evaluateApproval.mockRejectedValue(new Error('offline'));
    expect(await f.policy.resolveApproval(f.request)).toHaveProperty('status', 'manual');
    expect(f.persona.evaluateApproval).not.toHaveBeenCalled();
  });
  it('invalidates the approval when host execution identity changes during inference', async () => {
    const f = fixture();
    f.model.evaluateApproval.mockImplementation(async () => { f.request.runId = 'other-run'; return f.evaluation; });
    expect(await f.policy.resolveApproval(f.request)).toHaveProperty('status', 'manual');
  });
  it('does not treat an asynchronous validator as synchronous current-state evidence', async () => {
    const f = fixture();
    f.model.evaluateApproval.mockResolvedValue({ ...f.evaluation, validateContext: async () => true });
    expect(await f.policy.resolveApproval(f.request)).toHaveProperty('status', 'manual');
  });
  it('permits exactly one concurrent consumer and consumes failed validation too', async () => {
    const f = fixture(), approved = await f.policy.resolveApproval(f.request);
    expect(await Promise.all([approved.validateBeforeExecution?.(), approved.validateBeforeExecution?.()])).toEqual([true, false]);
    const other = fixture(), stale = await other.policy.resolveApproval(other.request);
    other.stale();
    expect(await stale.validateBeforeExecution?.()).toBe(false);
    expect(await stale.validateBeforeExecution?.()).toBe(false);
  });
});
