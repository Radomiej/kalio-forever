import { beforeEach, describe, expect, it, vi } from 'vitest';
import { HitlDecisionService } from './hitl-decision.service';
import { HitlPolicyService } from './hitl-policy.service';
import type { HitlConfigService } from './hitl-config.service';

describe('HitlPolicyService', () => {
  let service: HitlPolicyService;
  let configService: { getConfig: ReturnType<typeof vi.fn> };
  let decisionService: { evaluateApproval: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    configService = {
      getConfig: vi.fn().mockResolvedValue({ mode: 'manual', autoPersonaId: null }),
    };
    decisionService = {
      evaluateApproval: vi.fn(),
    };

    service = new HitlPolicyService(configService as unknown as HitlConfigService, decisionService as unknown as HitlDecisionService);
  });

  it('returns manual when the config mode is manual', async () => {
    await expect(service.resolveApproval({ kind: 'tool', sessionId: 'sess-1', name: 'dangerous_tool', args: {} })).resolves.toEqual({
      status: 'manual',
      source: 'manual',
    });

    expect(decisionService.evaluateApproval).not.toHaveBeenCalled();
  });

  it('auto-approves when the config mode is bypass', async () => {
    configService.getConfig.mockResolvedValue({ mode: 'bypass', autoPersonaId: null });

    await expect(service.resolveApproval({ kind: 'tool', sessionId: 'sess-1', name: 'dangerous_tool', args: {} })).resolves.toEqual({
      status: 'approved',
      source: 'bypass',
    });
  });

  it('falls back to manual when auto mode has no configured persona', async () => {
    configService.getConfig.mockResolvedValue({ mode: 'auto', autoPersonaId: null });

    await expect(service.resolveApproval({ kind: 'tool', sessionId: 'sess-1', name: 'dangerous_tool', args: {} })).resolves.toEqual({
      status: 'manual',
      source: 'manual',
    });

    expect(decisionService.evaluateApproval).not.toHaveBeenCalled();
  });

  it('returns approved when auto mode evaluator agrees', async () => {
    configService.getConfig.mockResolvedValue({ mode: 'auto', autoPersonaId: 'reviewer' });
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
    configService.getConfig.mockResolvedValue({ mode: 'auto', autoPersonaId: 'reviewer' });
    decisionService.evaluateApproval.mockResolvedValue({ agree: false, reason: 'This would overwrite data.' });

    await expect(service.resolveApproval({ kind: 'tool', sessionId: 'sess-1', name: 'dangerous_tool', args: { path: 'demo.txt' } })).resolves.toEqual({
      status: 'rejected',
      source: 'auto',
      reason: 'This would overwrite data.',
    });
  });

  it('falls back to manual when the auto evaluator throws', async () => {
    configService.getConfig.mockResolvedValue({ mode: 'auto', autoPersonaId: 'reviewer' });
    decisionService.evaluateApproval.mockRejectedValue(new Error('provider offline'));

    await expect(service.resolveApproval({ kind: 'tool', sessionId: 'sess-1', name: 'dangerous_tool', args: {} })).resolves.toEqual({
      status: 'manual',
      source: 'manual',
    });
  });
});