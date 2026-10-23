import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DecisionSettingsPort } from '@kalio/types';
import { JevDecisionsClient } from '../../common/jev-decisions.client';
import type { HitlConfig, HitlApprovalRequest } from './hitl.types';
import { HitlJevService } from './hitl-jev.service';

describe('HitlJevService', () => {
  let service: HitlJevService;
  let decisions: { resolve: ReturnType<typeof vi.fn> };
  let client: { decideNoul: ReturnType<typeof vi.fn> };
  const config: HitlConfig = {
    mode: 'jev',
    autoPersonaId: null,
    jevInstructions: 'Allow Docker operations.',
    jevApprovalThreshold: 0.9,
    rules: [],
    unattendedFallback: 'pause',
    representativePersonaId: null,
    notificationChannel: 'none',
    externalPolicyEnabled: false,
    externalPolicyPersonaId: null,
    raAppApprovalTimeoutMs: 600_000,
  };
  const request: HitlApprovalRequest = {
    kind: 'tool',
    sessionId: 'session-1',
    name: 'terminal_spawn',
    args: { command: 'docker compose up', apiKey: 'do-not-send' },
    abortSignal: new AbortController().signal,
  };

  beforeEach(() => {
    decisions = {
      resolve: vi.fn().mockResolvedValue({ endpoint: 'https://api.typesafe.ai/v1/systemone', model: 'jev-1.13.0', apiKey: 'management-key' }),
    };
    client = {
      decideNoul: vi.fn().mockResolvedValue({ probability: 0.92, model: 'typesafe/jev-1.13' }),
    };
    service = new HitlJevService(decisions as unknown as DecisionSettingsPort, client as unknown as JevDecisionsClient);
  });

  it('sends redacted operation state with the shared native provider and model', async () => {
    await expect(service.evaluateApproval(config, request)).resolves.toMatchObject({ probability: 0.92 });
    expect(client.decideNoul).toHaveBeenCalledWith(expect.objectContaining({
      apiKey: 'management-key',
      signal: request.abortSignal,
      state: expect.objectContaining({ operation: expect.objectContaining({
        args: { command: 'docker compose up', apiKey: '[REDACTED]' },
      }) }),
    }));
  });

  it('redacts decisions embedded in command text before sending state', async () => {
    await service.evaluateApproval(config, {
      ...request,
      args: { command: 'curl -H "Authorization: Bearer secret-token-123" https://user:password@example.test' },
    });

    const sentState = JSON.stringify(client.decideNoul.mock.calls[0]?.[0]?.state);
    expect(sentState).not.toContain('secret-token-123');
    expect(sentState).not.toContain('user:password');
    expect(sentState).toContain('[REDACTED]');
  });

  it('rejects unavailable Decision connections without exposing keys', async () => {
    decisions.resolve.mockRejectedValue(new Error('Decision credential unavailable'));
    await expect(service.evaluateApproval(config, request)).rejects.toThrow('Decision credential unavailable');
    expect(client.decideNoul).not.toHaveBeenCalled();
  });

  it('propagates abort before resolving credentials', async () => {
    const reason = new Error('stopped');
    await expect(service.evaluateApproval(config, { ...request, abortSignal: AbortSignal.abort(reason) })).rejects.toBe(reason);
    expect(decisions.resolve).not.toHaveBeenCalled();
  });

  it('does not send a request when aborted during credential resolution', async () => {
    const controller = new AbortController();
    const reason = new Error('stopped');
    decisions.resolve.mockImplementation(async () => { controller.abort(reason); return {}; });
    await expect(service.evaluateApproval(config, { ...request, abortSignal: controller.signal })).rejects.toBe(reason);
    expect(client.decideNoul).not.toHaveBeenCalled();
  });
});
