import { beforeEach, describe, expect, it, vi } from 'vitest';
import { HitlDecisionService } from './hitl-decision.service';
import { HitlPolicyService } from './hitl-policy.service';
import type { HitlJevService } from './hitl-jev.service';
import type { HitlConfigService } from './hitl-config.service';
import type { HitlConfig } from './hitl.types';
import { ToolConfirmationService } from '../chat/tool-confirmation.service';
import type { StreamContext } from '../chat/interfaces/stream-context.interface';

function makeConfig(overrides: Partial<HitlConfig> = {}): HitlConfig {
  return {
    mode: 'manual',
    autoPersonaId: null,
    jevInstructions: '',
    jevApprovalThreshold: 0.9,
    rules: [],
    unattendedFallback: 'pause',
    representativePersonaId: null,
    notificationChannel: 'none',
    externalPolicyEnabled: false,
    externalPolicyPersonaId: null,
    raAppApprovalTimeoutMs: 600_000,
    ...overrides,
  };
}

describe('HitlPolicyService', () => {
  let service: HitlPolicyService;
  let configService: { getConfig: ReturnType<typeof vi.fn> };
  let decisionService: { evaluateApproval: ReturnType<typeof vi.fn> };
  let jevService: { evaluateApproval: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    configService = {
      getConfig: vi.fn().mockResolvedValue(makeConfig()),
    };
    decisionService = {
      evaluateApproval: vi.fn(),
    };
    jevService = {
      evaluateApproval: vi.fn(),
    };

    service = new HitlPolicyService(
      configService as unknown as HitlConfigService,
      decisionService as unknown as HitlDecisionService,
      jevService as unknown as HitlJevService,
    );
  });

  it('returns manual when the config mode is manual', async () => {
    await expect(service.resolveApproval({ kind: 'tool', sessionId: 'sess-1', name: 'dangerous_tool', args: {} })).resolves.toEqual({
      status: 'manual',
      source: 'manual',
    });

    expect(decisionService.evaluateApproval).not.toHaveBeenCalled();
  });

  it.each([true, false])('propagates cancelled Jev evaluation without persona or manual fallback (persona=%s)', async (withPersona) => {
    configService.getConfig.mockResolvedValue(makeConfig({ mode: 'jev', autoPersonaId: withPersona ? 'reviewer' : null }));
    const controller = new AbortController();
    const reason = new DOMException('Stopped by user', 'AbortError');
    jevService.evaluateApproval.mockImplementation(async () => {
      controller.abort(reason);
      throw reason;
    });

    await expect(service.resolveApproval({ kind: 'tool', sessionId: 'sess-1', name: 'terminal_exec', args: {}, abortSignal: controller.signal })).rejects.toBe(reason);
    expect(decisionService.evaluateApproval).not.toHaveBeenCalled();
  });

  it('auto-approves when the config mode is bypass', async () => {
    configService.getConfig.mockResolvedValue(makeConfig({ mode: 'bypass' }));

    await expect(service.resolveApproval({ kind: 'tool', sessionId: 'sess-1', name: 'dangerous_tool', args: {} })).resolves.toEqual({
      status: 'approved',
      source: 'bypass',
    });
  });

  it('falls back to manual when auto mode has no configured persona', async () => {
    configService.getConfig.mockResolvedValue(makeConfig({ mode: 'auto' }));

    await expect(service.resolveApproval({ kind: 'tool', sessionId: 'sess-1', name: 'dangerous_tool', args: {} })).resolves.toEqual({
      status: 'manual',
      source: 'manual',
    });

    expect(decisionService.evaluateApproval).not.toHaveBeenCalled();
  });

  it('returns approved when auto mode evaluator agrees', async () => {
    configService.getConfig.mockResolvedValue(makeConfig({ mode: 'auto', autoPersonaId: 'reviewer' }));
    decisionService.evaluateApproval.mockResolvedValue({ agree: true, reason: 'Looks safe.' });

    await expect(service.resolveApproval({ kind: 'tool', sessionId: 'sess-1', name: 'dangerous_tool', args: { path: 'demo.txt' } })).resolves.toEqual({
      status: 'approved',
      source: 'auto',
      reason: 'Looks safe.',
    });

    expect(decisionService.evaluateApproval).toHaveBeenCalledWith(expect.objectContaining({
      personaId: 'reviewer',
      request: expect.objectContaining({ name: 'dangerous_tool' }),
    }));
  });

  it('returns rejected when auto mode evaluator rejects', async () => {
    configService.getConfig.mockResolvedValue(makeConfig({ mode: 'auto', autoPersonaId: 'reviewer' }));
    decisionService.evaluateApproval.mockResolvedValue({ agree: false, reason: 'This would overwrite data.' });

    await expect(service.resolveApproval({ kind: 'tool', sessionId: 'sess-1', name: 'dangerous_tool', args: { path: 'demo.txt' } })).resolves.toEqual({
      status: 'rejected',
      source: 'auto',
      reason: 'This would overwrite data.',
    });
  });

  it('falls back to manual when the auto evaluator throws', async () => {
    configService.getConfig.mockResolvedValue(makeConfig({ mode: 'auto', autoPersonaId: 'reviewer' }));
    decisionService.evaluateApproval.mockRejectedValue(new Error('provider offline'));

    await expect(service.resolveApproval({ kind: 'tool', sessionId: 'sess-1', name: 'dangerous_tool', args: {} })).resolves.toEqual({
      status: 'manual',
      source: 'manual',
    });
  });

  it('applies hard deny rules before every mode including Bypass', async () => {
    const request = { kind: 'tool' as const, sessionId: 'sess-1', name: 'terminal_spawn', args: {} };
    const rules = [{ id: 'hard-deny', kind: 'tool' as const, name: 'terminal_spawn', decision: 'deny' as const }];
    for (const mode of ['manual', 'auto', 'jev'] as const) {
      configService.getConfig.mockResolvedValue(makeConfig({ mode, autoPersonaId: 'reviewer', rules }));
      await expect(service.resolveApproval(request)).resolves.toMatchObject({ status: 'rejected', source: 'rule' });
    }
    configService.getConfig.mockResolvedValue(makeConfig({ mode: 'bypass', rules }));
    await expect(service.resolveApproval(request)).resolves.toMatchObject({ status: 'rejected', source: 'rule' });
    expect(decisionService.evaluateApproval).not.toHaveBeenCalled();
    expect(jevService.evaluateApproval).not.toHaveBeenCalled();
  });

  it('allows and denies Jev decisions at the configured threshold boundaries', async () => {
    configService.getConfig.mockResolvedValue(makeConfig({ mode: 'jev' }));
    const request = { kind: 'tool' as const, sessionId: 'sess-1', name: 'fs_read', args: { path: 'demo.txt' } };
    jevService.evaluateApproval.mockResolvedValue({ probability: 0.9 });
    await expect(service.resolveApproval(request)).resolves.toMatchObject({ status: 'approved', source: 'jev' });
    jevService.evaluateApproval.mockResolvedValue({ probability: 0.1 });
    await expect(service.resolveApproval(request)).resolves.toMatchObject({ status: 'rejected', source: 'jev' });
  });

  it('uses the optional persona for uncertain or failed Jev decisions and asks the human if it cannot decide', async () => {
    configService.getConfig.mockResolvedValue(makeConfig({ mode: 'jev', autoPersonaId: 'reviewer', jevFallbackToPersona: true }));
    const request = { kind: 'tool' as const, sessionId: 'sess-1', name: 'dangerous_tool', args: {} };
    jevService.evaluateApproval.mockResolvedValue({ probability: 0.5 });
    decisionService.evaluateApproval.mockResolvedValue({ agree: true, decision: 'ask_user', reason: 'Needs a person.' });
    await expect(service.resolveApproval(request)).resolves.toMatchObject({ status: 'manual', source: 'manual' });
    expect(decisionService.evaluateApproval).toHaveBeenCalledWith(expect.objectContaining({ personaId: 'reviewer' }));

    decisionService.evaluateApproval.mockRejectedValue(new Error('persona unavailable'));
    jevService.evaluateApproval.mockRejectedValue(new Error('Jev offline'));
    await expect(service.resolveApproval(request)).resolves.toMatchObject({ status: 'manual', source: 'manual' });
  });

  it('keeps unattended fallback paused by default', async () => {
    await expect(service.resolveUnattendedApproval({ kind: 'tool', sessionId: 'sess-1', name: 'dangerous_tool', args: {} })).resolves.toEqual({
      status: 'manual',
      source: 'manual',
      reason: 'Unattended HITL fallback is paused.',
    });

    expect(decisionService.evaluateApproval).not.toHaveBeenCalled();
  });

  it.each(['manual', 'auto', 'bypass', 'jev'] as const)('keeps ask_user authoritative in %s and unattended evaluation', async (mode) => {
    const rules = [{ id: 'ask', kind: '*' as const, name: '*', decision: 'ask_user' as const }];
    configService.getConfig.mockResolvedValue(makeConfig({ mode, rules, representativePersonaId: 'delegate', unattendedFallback: 'representative' }));
    const request = { kind: 'tool' as const, sessionId: 's', name: 'fs_read', args: {} };
    await expect(service.resolveApproval(request)).resolves.toMatchObject({ status: 'manual' });
    await expect(service.resolveUnattendedApproval(request)).resolves.toMatchObject({ status: 'manual' });
    expect(jevService.evaluateApproval).not.toHaveBeenCalled();
    expect(decisionService.evaluateApproval).not.toHaveBeenCalled();
  });

  it.each([0.5, NaN, Infinity, -0.1, 1.1])('does not silently use a saved persona for uncertain/invalid p=%s', async (probability) => {
    configService.getConfig.mockResolvedValue(makeConfig({ mode: 'jev', autoPersonaId: 'old-persona' }));
    jevService.evaluateApproval.mockResolvedValue({ probability });
    await expect(service.resolveApproval({ kind: 'tool', sessionId: 's', name: 'fs_read', args: {} })).resolves.toMatchObject({ status: 'manual' });
    expect(decisionService.evaluateApproval).not.toHaveBeenCalled();
  });

  it('keeps provider errors manual without explicit persona fallback', async () => {
    configService.getConfig.mockResolvedValue(makeConfig({ mode: 'jev', autoPersonaId: 'old-persona' }));
    jevService.evaluateApproval.mockRejectedValue(new Error('provider offline'));
    await expect(service.resolveApproval({ kind: 'tool', sessionId: 's', name: 'fs_read', args: {} })).resolves.toMatchObject({ status: 'manual' });
    expect(decisionService.evaluateApproval).not.toHaveBeenCalled();
  });

  it.each(['terminal_spawn', 'terminal_exec', 'fs_write', 'vfs_delete', 'unknown_tool'])('cannot approve protected tool %s through allow rules or Jev', async (name) => {
    const request = { kind: 'tool' as const, sessionId: 's', name, args: {} };
    configService.getConfig.mockResolvedValue(makeConfig({ mode: 'jev', rules: [{ id: 'allow', kind: '*' as const, name: '*', decision: 'allow' as const }] }));
    await expect(service.resolveApproval(request)).resolves.toMatchObject({ status: 'manual' });
    await expect(service.resolveUnattendedApproval(request)).resolves.toMatchObject({ status: 'manual' });
    configService.getConfig.mockResolvedValue(makeConfig({ mode: 'jev', jevFallbackToPersona: true, autoPersonaId: 'reviewer' }));
    jevService.evaluateApproval.mockResolvedValue({ probability: 1 });
    await expect(service.resolveApproval(request)).resolves.toMatchObject({ status: 'manual' });
    jevService.evaluateApproval.mockResolvedValue({ probability: 0.5 });
    decisionService.evaluateApproval.mockResolvedValue({ agree: true, decision: 'allow', reason: 'ok' });
    await expect(service.resolveApproval(request)).resolves.toMatchObject({ status: 'manual' });
  });

  it.each(['auto', 'bypass', 'jev'] as const)('propagates pre-abort in %s and unattended modes', async (mode) => {
    configService.getConfig.mockResolvedValue(makeConfig({ mode }));
    const reason = new Error('stopped');
    const request = { kind: 'tool' as const, sessionId: 's', name: 'fs_read', args: {}, abortSignal: AbortSignal.abort(reason) };
    await expect(service.resolveApproval(request)).rejects.toBe(reason);
    await expect(service.resolveUnattendedApproval(request)).rejects.toBe(reason);
    expect(configService.getConfig).not.toHaveBeenCalled();
  });

  it.each([0.50001, 1])('honors supported threshold %s', async (jevApprovalThreshold) => {
    configService.getConfig.mockResolvedValue(makeConfig({ mode: 'jev', jevApprovalThreshold }));
    jevService.evaluateApproval.mockResolvedValue({ probability: jevApprovalThreshold });
    await expect(service.resolveApproval({ kind: 'tool', sessionId: 's', name: 'fs_read', args: {} })).resolves.toMatchObject({ status: 'approved' });
  });

  it('defaults missing legacy Jev fields to .95 and manual fallback', async () => {
    configService.getConfig.mockResolvedValue(makeConfig({
      mode: 'jev', jevApprovalThreshold: undefined, jevInstructions: undefined,
      jevFallbackToPersona: undefined, rules: undefined, autoPersonaId: 'old-persona',
    }));
    const request = { kind: 'tool' as const, sessionId: 's', name: 'fs_read', args: {} };
    jevService.evaluateApproval.mockResolvedValue({ probability: 0.94 });
    await expect(service.resolveApproval(request)).resolves.toMatchObject({ status: 'manual' });
    expect(decisionService.evaluateApproval).not.toHaveBeenCalled();
    jevService.evaluateApproval.mockResolvedValue({ probability: 0.95 });
    await expect(service.resolveApproval(request)).resolves.toMatchObject({ status: 'approved', reason: expect.stringContaining('threshold=0.95') });
  });

  it.each(['rule', 'jev'] as const)('keeps destructive execution pending for an actual confirmation consumer (%s)', async (source) => {
    configService.getConfig.mockResolvedValue(makeConfig({
      mode: 'jev',
      rules: source === 'rule' ? [{ id: 'allow', kind: '*' as const, name: '*', decision: 'allow' as const }] : [],
    }));
    jevService.evaluateApproval.mockResolvedValue({ probability: 1 });
    const confirmations = new ToolConfirmationService(service, null);
    const controller = new AbortController();
    const emit = vi.fn();
    const context = { sessionId: 's', abortSignal: controller.signal, emit } as unknown as StreamContext;
    const outcome = confirmations.approveOrRequestConfirmation('call', 'fs_write', { path: 'demo.txt' }, context);
    await vi.waitFor(() => expect(confirmations.getPendingConfirmations('s')).toHaveLength(1));
    expect(emit).toHaveBeenCalledWith('tool:confirmation_required', expect.objectContaining({ toolName: 'fs_write' }));
    const pending = confirmations.getPendingConfirmations('s')[0]!;
    await expect(confirmations.resolveConfirmation(pending.requestId, 'wrong-session')).resolves.toBe('session_mismatch');
    await confirmations.cancelConfirmation(pending.requestId, 's', 'Denied by user');
    await expect(outcome).resolves.toMatchObject({ approved: false });
    expect(confirmations.getPendingConfirmations('s')).toEqual([]);
  });

  it('uses the representative persona for unattended fallback approvals', async () => {
    configService.getConfig.mockResolvedValue(makeConfig({
      unattendedFallback: 'representative',
      representativePersonaId: 'delegate',
    }));
    decisionService.evaluateApproval.mockResolvedValue({ agree: true, reason: 'Matches the allowed schema.' });

    await expect(service.resolveUnattendedApproval({ kind: 'tool', sessionId: 'sess-1', name: 'dangerous_tool', args: {} })).resolves.toEqual({
      status: 'approved',
      source: 'representative',
      reason: 'Matches the allowed schema.',
    });

    expect(decisionService.evaluateApproval).toHaveBeenCalledWith(expect.objectContaining({
      personaId: 'delegate',
      request: expect.objectContaining({ name: 'dangerous_tool' }),
    }));
  });
});
