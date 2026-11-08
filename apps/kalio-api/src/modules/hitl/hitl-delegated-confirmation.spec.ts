import { describe, expect, it, vi } from 'vitest';
import type { HitlConfig } from '@kalio/types';
import { HitlPolicyService } from './hitl-policy.service';
import { ToolDispatchService } from '../chat/tool-dispatch.service';
import { TurnState } from '../chat/turn-state';
import type { StreamContext } from '../chat/interfaces/stream-context.interface';

function evaluated() {
  return { assessment: { checks: { goal_alignment: 0.99, in_scope: 0.99, destructive_effect: 0.01,
    unauthorized_export: 0.01, evidence_sufficient: 0.99 }, contextFingerprint: 'a'.repeat(64) },
  model: 'test-jev', validateContext: () => true };
}

function fixture() {
  const config: HitlConfig = { mode: 'jev', confirmationAuthority: 'decision_model', autoPersonaId: null,
    unattendedFallback: 'pause', representativePersonaId: null, notificationChannel: 'none', externalPolicyEnabled: false,
    externalPolicyPersonaId: null, raAppApprovalTimeoutMs: 0, jevApprovalThreshold: 0.95, rules: [] };
  const settings = { getConfig: vi.fn(async () => structuredClone(config)), revision: 1, changing: false };
  const model = { evaluateApproval: vi.fn().mockResolvedValue(evaluated()) };
  const policy = Reflect.construct(HitlPolicyService, [settings, {}, model]) as HitlPolicyService;
  const request = { kind: 'tool' as const, sessionId: 's', toolCallId: 'c', name: 'terminal_spawn', args: { command: 'rg', cwd: '/project', args: ['foo'] } };
  return { config, settings, model, policy, request };
}
describe('delegated Jev confirmation authority', () => {
  it('waits for a human before Jev and only re-evaluates after the timeout path', async () => {
    const f = fixture(); f.config.confirmationAuthority = 'human_then_decision'; f.config.humanReviewTimeoutMs = 120_000;
    expect(await f.policy.resolveApproval(f.request)).toHaveProperty('status', 'manual');
    expect(f.model.evaluateApproval).not.toHaveBeenCalled();
    expect(await f.policy.getManualReviewTimeoutMs(f.request)).toBe(120_000);
    const delegated = await f.policy.resolveUnattendedApproval(f.request);
    expect(delegated).toMatchObject({ status: 'approved', source: 'jev' });
    expect(await delegated.validateBeforeExecution?.()).toBe(true);
  });
  it('keeps no-timeout and always-ask rules infinite', async () => {
    const f = fixture(); f.config.confirmationAuthority = 'human_then_decision'; f.config.humanReviewTimeoutMs = 0;
    expect(await f.policy.getManualReviewTimeoutMs(f.request)).toBe(0);
    f.config.humanReviewTimeoutMs = 60_000;
    f.config.rules = [{ id: 'human', kind: 'tool', name: 'terminal_spawn', decision: 'ask_user' }];
    expect(await f.policy.getManualReviewTimeoutMs(f.request)).toBe(0);
    expect(await f.policy.resolveUnattendedApproval(f.request)).toHaveProperty('status', 'manual');
    expect(f.model.evaluateApproval).not.toHaveBeenCalled();
  });
  it.each(['terminal_spawn', 'fs_write', 'custom_registered_tool'])('lets Jev assess %s only with explicit delegation', async name => {
    const f = fixture();
    const approved = await f.policy.resolveApproval({ ...f.request, name });
    expect(approved).toMatchObject({ status: 'approved', source: 'jev' });
    expect(await approved.validateBeforeExecution?.()).toBe(true);
    expect(await approved.validateBeforeExecution?.()).toBe(false);
    f.config.confirmationAuthority = 'human';
    expect(await f.policy.resolveApproval({ ...f.request, name })).toHaveProperty('status', 'manual');
  });
  it.each(['deny', 'ask_user'] as const)('keeps %s stronger than any matching allow', async decision => {
    const f = fixture(); f.config.rules = [
      { id: 'allow', kind: 'tool', name: '*', decision: 'allow' },
      { id: 'stop', kind: 'tool', name: 'terminal_spawn', decision },
    ];
    expect(await f.policy.resolveApproval(f.request)).toHaveProperty('status', decision === 'deny' ? 'rejected' : 'manual');
    expect(f.model.evaluateApproval).not.toHaveBeenCalled();
  });
  it('does not let an allow rule bypass delegated model assessment', async () => {
    const f = fixture(); f.config.rules = [{ id: 'allow', kind: 'tool', name: '*', decision: 'allow' }];
    const unsafe = evaluated(); unsafe.assessment.checks.destructive_effect = 0.99;
    f.model.evaluateApproval.mockResolvedValue(unsafe);
    expect(await f.policy.resolveApproval(f.request)).toMatchObject({ status: 'rejected', source: 'jev' });
    expect(f.model.evaluateApproval).toHaveBeenCalledOnce();
  });

  it('does not let a subagent auto-approve list bypass a Jev hard deny', async () => {
    const f = fixture(), execute = vi.fn();
    f.config.rules = [{ id: 'deny-write', kind: 'tool', name: 'fs_write', decision: 'deny' }];
    const dispatch = new ToolDispatchService([{ meta: { name: 'fs_write', description: '', parameters: { type: 'object' }, requiresConfirmation: true }, execute }], null, f.policy, null);
    const ctx: StreamContext = { sessionId: 's', messageId: 'm', state: new TurnState(), emit: vi.fn(), abortSignal: new AbortController().signal };
    Object.assign(ctx, { agentRun: { agentType: 'subagent', autoApproveTools: ['fs_write'] } });
    expect((await dispatch.dispatch('c', 'fs_write', {}, ctx)).status).toBe('cancelled');
    expect(execute).not.toHaveBeenCalled(); expect(f.model.evaluateApproval).not.toHaveBeenCalled();
  });
  it.each(['uncertain', 'unavailable', 'invalid'])('keeps %s model output manual', async kind => {
    const f = fixture();
    if (kind === 'unavailable') f.model.evaluateApproval.mockRejectedValue(new Error('offline'));
    else {
      const result = evaluated(); result.assessment.checks.evidence_sufficient = kind === 'invalid' ? NaN : 0.6;
      f.model.evaluateApproval.mockResolvedValue(result);
    }
    expect(await f.policy.resolveApproval(f.request)).toHaveProperty('status', 'manual');
  });
  it('rejects changed arguments and configuration during inference', async () => {
    for (const change of ['args', 'config']) {
      const f = fixture(); f.model.evaluateApproval.mockImplementation(async () => {
        if (change === 'args') f.request.args.command = 'different'; else f.settings.revision++;
        return evaluated();
      });
      expect(await f.policy.resolveApproval(f.request)).toHaveProperty('status', 'manual');
    }
  });
  it.each(['args', 'policy', 'abort'] as const)('does not enter the real dispatcher executor after %s changes', async change => {
    const f = fixture(), controller = new AbortController(), execute = vi.fn();
    const tool = { meta: { name: 'terminal_spawn', description: '', parameters: { type: 'object' }, requiresConfirmation: true }, execute };
    const dispatch = new ToolDispatchService([tool], null, f.policy, null);
    const ctx: StreamContext = { sessionId: 's', messageId: 'm', emit: vi.fn(), state: new TurnState(), abortSignal: controller.signal,
      markToolRunning: async () => {
        if (change === 'args') f.request.args.command = 'different';
        if (change === 'policy') f.settings.revision++;
        if (change === 'abort') controller.abort();
      } };
    expect((await dispatch.dispatch('c', 'terminal_spawn', f.request.args, ctx)).status).toBe('cancelled');
    expect(execute).not.toHaveBeenCalled();
  });

  it('returns a structured failure when the final policy read throws', async () => {
    const f = fixture(), execute = vi.fn();
    const tool = { meta: { name: 'terminal_spawn', description: '', parameters: { type: 'object' }, requiresConfirmation: true }, execute };
    const dispatch = new ToolDispatchService([tool], null, f.policy, null);
    const ctx: StreamContext = { sessionId: 's', messageId: 'm', state: new TurnState(), emit: vi.fn(), abortSignal: new AbortController().signal,
      markToolRunning: async () => { f.settings.getConfig.mockRejectedValue(new Error('database unavailable')); } };
    expect(await dispatch.dispatch('c', 'terminal_spawn', f.request.args, ctx)).toMatchObject({ status: 'error', errorCode: 'APPROVAL_VALIDATION_FAILED' });
    expect(execute).not.toHaveBeenCalled();
  });
});
