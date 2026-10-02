import { beforeEach, describe, expect, it, vi } from 'vitest';
import { HitlDecisionService } from './hitl-decision.service';
import { HitlPolicyService } from './hitl-policy.service';
import type { HitlJevService } from './hitl-jev.service';
import type { HitlConfigService } from './hitl-config.service';
import type { HitlConfig } from './hitl.types';

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

  it('applies hard rules before Manual, Auto, and Jev decisions, while Bypass skips them', async () => {
    const request = { kind: 'tool' as const, sessionId: 'sess-1', name: 'terminal_spawn', args: {} };
    const rules = [{ id: 'hard-deny', kind: 'tool' as const, name: 'terminal_spawn', decision: 'deny' as const }];
    for (const mode of ['manual', 'auto', 'jev'] as const) {
      configService.getConfig.mockResolvedValue(makeConfig({ mode, autoPersonaId: 'reviewer', rules }));
      await expect(service.resolveApproval(request)).resolves.toMatchObject({ status: 'rejected', source: 'rule' });
    }
    configService.getConfig.mockResolvedValue(makeConfig({ mode: 'bypass', rules }));
    await expect(service.resolveApproval(request)).resolves.toMatchObject({ status: 'approved', source: 'bypass' });
    expect(decisionService.evaluateApproval).not.toHaveBeenCalled();
    expect(jevService.evaluateApproval).not.toHaveBeenCalled();
  });

  it('allows and denies Jev decisions at the configured threshold boundaries', async () => {
    configService.getConfig.mockResolvedValue(makeConfig({ mode: 'jev' }));
    const request = { kind: 'tool' as const, sessionId: 'sess-1', name: 'destructive_tool', args: { action: 'delete' } };
    jevService.evaluateApproval.mockResolvedValue({ probability: 0.9 });
    await expect(service.resolveApproval(request)).resolves.toMatchObject({ status: 'approved', source: 'jev' });
    jevService.evaluateApproval.mockResolvedValue({ probability: 0.1 });
    await expect(service.resolveApproval(request)).resolves.toMatchObject({ status: 'rejected', source: 'jev' });
  });

  it('uses the optional persona for uncertain or failed Jev decisions and asks the human if it cannot decide', async () => {
    configService.getConfig.mockResolvedValue(makeConfig({ mode: 'jev', autoPersonaId: 'reviewer' }));
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
