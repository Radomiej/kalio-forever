import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CredentialsService } from '../credentials/credentials.service';
import { JevDecisionsClient } from '../../common/jev-decisions.client';
import type { HitlConfig, HitlApprovalRequest } from './hitl.types';
import { HitlJevService } from './hitl-jev.service';

describe('HitlJevService', () => {
  let service: HitlJevService;
  let credentials: { getProviderConfigForCredential: ReturnType<typeof vi.fn> };
  let client: { decideNoul: ReturnType<typeof vi.fn> };
  const config: HitlConfig = {
    mode: 'jev',
    autoPersonaId: null,
    jevCredentialId: 'credential-1',
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
    credentials = {
      getProviderConfigForCredential: vi.fn().mockResolvedValue({ provider: 'openrouter', apiKey: 'management-key' }),
    };
    client = {
      decideNoul: vi.fn().mockResolvedValue({ probability: 0.92, model: 'typesafe/jev-1.13' }),
    };
    service = new HitlJevService(credentials as unknown as CredentialsService, client as unknown as JevDecisionsClient);
  });

  it('sends bounded redacted operation state to the configured Jev credential', async () => {
    await expect(service.evaluateApproval(config, request)).resolves.toMatchObject({ probability: 0.92 });
    expect(client.decideNoul).toHaveBeenCalledWith(expect.objectContaining({
      apiKey: 'management-key',
      signal: request.abortSignal,
      state: expect.objectContaining({ operation: expect.objectContaining({
        args: { command: 'docker compose up', apiKey: '[REDACTED]' },
      }) }),
    }));
  });

  it('redacts credentials embedded in command text before sending state', async () => {
    await service.evaluateApproval(config, {
      ...request,
      args: { command: 'curl -H "Authorization: Bearer secret-token-123" https://user:password@example.test' },
    });

    const sentState = JSON.stringify(client.decideNoul.mock.calls[0]?.[0]?.state);
    expect(sentState).not.toContain('secret-token-123');
    expect(sentState).not.toContain('user:password');
    expect(sentState).toContain('[REDACTED]');
  });

  it('rejects missing or non-OpenRouter credentials without exposing keys', async () => {
    credentials.getProviderConfigForCredential.mockResolvedValue({ provider: 'openai', apiKey: 'secret' });
    await expect(service.evaluateApproval(config, request)).rejects.toThrow('usable OpenRouter credential');
    expect(client.decideNoul).not.toHaveBeenCalled();
  });
});
