import { beforeEach, describe, expect, it, vi } from 'vitest';
import { HitlDecisionService } from './hitl-decision.service';
import { HitlPolicyService } from './hitl-policy.service';
import type { HitlConfigService } from './hitl-config.service';
import type { HitlConfig } from './hitl.types';

function makeConfig(overrides: Partial<HitlConfig> = {}): HitlConfig {
  return {
    mode: 'manual',
    autoPersonaId: null,
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

  beforeEach(() => {
    configService = {
      getConfig: vi.fn().mockResolvedValue(makeConfig()),
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

  it('auto-approves built-in VFS writes for a verified isolated subagent before manual mode', async () => {
    await expect(service.resolveApproval({
      kind: 'tool',
      sessionId: 'child-session',
      vfsSessionId: 'child-session',
      name: 'vfs_write',
      args: {},
      agentRun: {
        agentRunId: 'sub-run-1',
        agentType: 'subagent',
        parentSessionId: 'parent-session',
        vfsMode: 'isolated',
      },
    })).resolves.toEqual({
      status: 'approved',
      source: 'auto',
      reason: 'Built-in isolated subagent VFS write policy.',
    });

    expect(configService.getConfig).not.toHaveBeenCalled();
    expect(decisionService.evaluateApproval).not.toHaveBeenCalled();
  });

  it.each([
    ['shared VFS', 'shared' as const, 'child-session', 'parent-session'],
    ['mismatched VFS session', 'isolated' as const, 'parent-session', 'parent-session'],
    ['parent session equal to the child session', 'isolated' as const, 'child-session', 'child-session'],
  ])('keeps %s VFS writes behind manual HITL', async (_label, vfsMode, vfsSessionId, parentSessionId) => {
    await expect(service.resolveApproval({
      kind: 'tool',
      sessionId: 'child-session',
      vfsSessionId,
      name: 'vfs_write',
      args: {},
      agentRun: {
        agentRunId: 'sub-run-1',
        agentType: 'subagent',
        parentSessionId,
        vfsMode,
      },
    })).resolves.toEqual({ status: 'manual', source: 'manual' });
  });

  it('keeps parent-session VFS writes behind manual HITL', async () => {
    await expect(service.resolveApproval({
      kind: 'tool',
      sessionId: 'parent-session',
      vfsSessionId: 'parent-session',
      name: 'vfs_write',
      args: {},
    })).resolves.toEqual({ status: 'manual', source: 'manual' });
  });

  it('does not apply the isolated VFS exception to other tools', async () => {
    await expect(service.resolveApproval({
      kind: 'tool',
      sessionId: 'child-session',
      vfsSessionId: 'child-session',
      name: 'terminal_spawn',
      args: {},
      agentRun: {
        agentRunId: 'sub-run-1',
        agentType: 'subagent',
        parentSessionId: 'parent-session',
        vfsMode: 'isolated',
        autoApproveTools: ['terminal_spawn'],
      },
    })).resolves.toEqual({ status: 'manual', source: 'manual' });
  });

  it('does not auto-approve an already aborted isolated subagent run', async () => {
    const abortController = new AbortController();
    abortController.abort();

    await expect(service.resolveApproval({
      kind: 'tool',
      sessionId: 'child-session',
      vfsSessionId: 'child-session',
      name: 'vfs_write',
      args: {},
      abortSignal: abortController.signal,
      agentRun: {
        agentRunId: 'sub-run-1',
        agentType: 'subagent',
        parentSessionId: 'parent-session',
        vfsMode: 'isolated',
      },
    })).resolves.toEqual({ status: 'manual', source: 'manual' });
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
