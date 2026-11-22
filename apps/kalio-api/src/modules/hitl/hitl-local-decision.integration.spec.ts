import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppSettingsService } from '../../database/app-settings.service';
import type { CredentialsService } from '../credentials/credentials.service';
import { DecisionSettingsService } from '../../common/decision-settings.service';
import { HitlLocalDecisionService } from './hitl-local-decision.service';
import { HitlPolicyService } from './hitl-policy.service';
import type { HitlConfigService } from './hitl-config.service';
import type { HitlDecisionService } from './hitl-decision.service';
import { ToolConfirmationService } from '../chat/tool-confirmation.service';
import type { StreamContext } from '../chat/interfaces/stream-context.interface';
import type { HitlConfig } from './hitl.types';

/** Actual settings -> evaluator -> policy -> tool caller; only model transport is a fixture. */
describe('native tools integration preserving goal decisions', () => {
  beforeEach(() => vi.stubEnv('KALIO_DEV_LOCAL_DECISIONS', 'true'));
  afterEach(() => vi.unstubAllEnvs());
  async function setup(verdict = 'allow') {
    const goals = JSON.stringify({ provider: 'custom', model: 'goal-judge', credentialId: null, endpoint: 'http://127.0.0.1:9090/decide' });
    const values = new Map([['decision.config', goals]]);
    const settings = { get: async (key: string) => values.get(key) ?? null, set: async (key: string, value: string) => { values.set(key, value); } };
    const decisions = new DecisionSettingsService(settings as unknown as AppSettingsService, {} as CredentialsService);
    await decisions.updateConfig({ provider: 'ollama', model: 'fixture:1', credentialId: null, endpoint: 'http://127.0.0.1:11434/api/chat' }, 'tools');
    const transport = { post: vi.fn().mockResolvedValue({ model: 'fixture:1', done: true, done_reason: 'stop', message: { role: 'assistant', content: JSON.stringify({ verdict, reason: 'fixture' }) } }) };
    const local = new HitlLocalDecisionService(decisions, transport);
    const config: HitlConfig = { mode: 'ollama', autoPersonaId: null, unattendedFallback: 'pause', representativePersonaId: null, notificationChannel: 'none', externalPolicyEnabled: false, externalPolicyPersonaId: null, raAppApprovalTimeoutMs: 0, rules: [] };
    const configService = { getConfig: async () => config, revision: 0 };
    const persona = { evaluateApproval: vi.fn() };
    const policy = new HitlPolicyService(configService as unknown as HitlConfigService, persona as unknown as HitlDecisionService, undefined, local);
    const confirmations = new ToolConfirmationService(policy, null);
    const ctx = { sessionId: 's', abortSignal: new AbortController().signal, emit: vi.fn() } as unknown as StreamContext;
    return { confirmations, transport, decisions, values, goals, ctx, config, persona, configService };
  }
  it.each([['allow', true], ['deny', false]] as const)('uses native %s through the real confirmation caller', async (verdict, approved) => {
    const { confirmations, transport, decisions, values, goals, ctx, persona } = await setup(verdict);
    expect(await confirmations.approveOrRequestConfirmation('call', 'fs_read', { path: '/project/readme.md' }, ctx)).toEqual(approved
      ? { approved: true }
      : { approved: false, rejectionMessage: 'HITL policy rejected tool confirmation (ollama): Local decision (fixture:1): deny. fixture Do not retry or bypass this decision. Change approach or ask for clarification.' });
    expect(transport.post).toHaveBeenCalledTimes(1);
    expect(confirmations.getPendingConfirmations('s')).toEqual([]);
    expect(values.get('decision.config')).toBe(goals);
    expect(await decisions.resolve()).toMatchObject({ protocol: 'jev-decisions', model: 'goal-judge' });
    expect(persona.evaluateApproval).not.toHaveBeenCalled();
  });
  it.each([['fs_write', false], ['fs_read', true]] as const)('retains manual confirmation for %s humanOnly=%s', async (name, humanOnly) => {
    const { confirmations, transport, ctx } = await setup();
    const outcome = confirmations.approveOrRequestConfirmation('call', name, { path: '/project/readme.md' }, ctx, humanOnly);
    await vi.waitFor(() => expect(confirmations.getPendingConfirmations('s')).toHaveLength(1));
    expect(transport.post).not.toHaveBeenCalled();
    const pending = confirmations.getPendingConfirmations('s')[0]!;
    await confirmations.cancelConfirmation(pending.requestId, 's', 'User denied');
    expect(await outcome).toMatchObject({ approved: false });
  });
  it('keeps a provider failure pending for the actual user rather than persona approval', async () => {
    const { confirmations, transport, ctx, persona } = await setup();
    transport.post.mockRejectedValue(new Error('offline fixture'));
    const outcome = confirmations.approveOrRequestConfirmation('call', 'fs_read', { path: '/project/readme.md' }, ctx);
    await vi.waitFor(() => expect(confirmations.getPendingConfirmations('s')).toHaveLength(1));
    expect(persona.evaluateApproval).not.toHaveBeenCalled();
    const pending = confirmations.getPendingConfirmations('s')[0]!;
    await confirmations.cancelConfirmation(pending.requestId, 's', 'User denied');
    expect(await outcome).toMatchObject({ approved: false });
  });
  it('rejects overlapping same-call policy attempts during its final awaited config refresh', async () => {
    const { confirmations, configService, config, ctx, transport } = await setup();
    let release!: () => void;
    let reads = 0;
    const held = new Promise<void>(resolve => { release = resolve; });
    configService.getConfig = async () => { if (++reads === 2) await held; return config; };
    const first = confirmations.approveOrRequestConfirmation('call', 'fs_read', { path: '/project/readme.md' }, ctx);
    await vi.waitFor(() => expect(reads).toBe(2));
    const second = confirmations.approveOrRequestConfirmation('call', 'fs_read', { path: '/project/readme.md' }, ctx);
    await vi.waitFor(() => expect(confirmations.getPendingConfirmations('s')).toHaveLength(1));
    release();
    await vi.waitFor(() => expect(confirmations.getPendingConfirmations('s')).toHaveLength(2));
    expect(transport.post).toHaveBeenCalledTimes(1);
    for (const pending of confirmations.getPendingConfirmations('s')) await confirmations.cancelConfirmation(pending.requestId, 's', 'Denied');
    expect(await first).toMatchObject({ approved: false });
    expect(await second).toMatchObject({ approved: false });
  });
});
