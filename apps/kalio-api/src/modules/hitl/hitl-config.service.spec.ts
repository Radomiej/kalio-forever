import { BadRequestException, NotFoundException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from '../../database/schema';
import { DrizzleService } from '../../database/drizzle.service';
import { AppSettingsService } from '../../database/app-settings.service';
import { DecisionSettingsService } from '../../common/decision-settings.service';
import { HitlConfigService } from './hitl-config.service';
import type { HitlConfig } from './hitl.types';

const DEFAULT_CONFIG: HitlConfig = {
  mode: 'manual',
  autoPersonaId: null,
  unattendedFallback: 'pause',
  representativePersonaId: null,
  notificationChannel: 'none',
  externalPolicyEnabled: false,
  externalPolicyPersonaId: null,
  raAppApprovalTimeoutMs: 600_000,
  jevInstructions: '',
  jevApprovalThreshold: 0.95,
  jevFallbackToPersona: false,
  rules: [],
};

function makeTestDrizzle(): DrizzleService {
  const sqlite = new Database(':memory:');
  sqlite.pragma('foreign_keys = ON');
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `);
  const db = drizzle(sqlite, { schema });

  const drizzleSvc = new DrizzleService(null as never);
  (drizzleSvc as unknown as { db: typeof db }).db = db;
  return drizzleSvc;
}

describe('HitlConfigService', () => {
  let service: HitlConfigService;
  let appSettings: AppSettingsService;
  let personaService: { findOne: ReturnType<typeof vi.fn> };
  let credentialsService: { getProviderConfigForCredential: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    const drizzleService = makeTestDrizzle();
    appSettings = new AppSettingsService(drizzleService);
    personaService = {
      findOne: vi.fn().mockResolvedValue({ id: 'reviewer-persona' }),
    };
    credentialsService = {
      getProviderConfigForCredential: vi.fn().mockResolvedValue({
        provider: 'openrouter',
        apiKey: 'management-key',
        model: '',
      }),
    };
    const decisionCredentials = { ...credentialsService, findAll: vi.fn().mockResolvedValue([{id:'openrouter-management', provider:'openrouter', createdAt:1}]) };
    const decisions = new DecisionSettingsService(appSettings, decisionCredentials as never);
    service = new HitlConfigService(appSettings, personaService as never, decisions);
  });

  it('returns manual defaults when no HITL config is stored', async () => {
    await expect(service.getConfig()).resolves.toEqual(DEFAULT_CONFIG);
  });

  it.each([
    ['hitl.jevApprovalThreshold', '0.5'],
    ['hitl.jevApprovalThreshold', 'not-a-number'],
    ['hitl.jevInstructions', 'x'.repeat(2001)],
    ['hitl.jevFallbackToPersona', 'yes'],
    ['hitl.rules', '{broken'],
  ])('rejects invalid persisted config %s rather than silently applying defaults', async (key, value) => {
    await appSettings.set(key, value);
    await expect(service.getConfig()).rejects.toThrow(BadRequestException);
  });

  it('persists auto mode with the configured persona id', async () => {
    await expect(service.updateConfig({ mode: 'auto', autoPersonaId: 'reviewer-persona' })).resolves.toEqual({
      ...DEFAULT_CONFIG,
      mode: 'auto',
      autoPersonaId: 'reviewer-persona',
    });

    expect(personaService.findOne).toHaveBeenCalledWith('reviewer-persona');
    await expect(service.getConfig()).resolves.toEqual({
      ...DEFAULT_CONFIG,
      mode: 'auto',
      autoPersonaId: 'reviewer-persona',
    });
  });

  it('persists Jev configuration and hard rules without returning credential secrets', async () => {
    const rules = [{ id: 'deny-ansible', kind: 'tool' as const, name: 'terminal_spawn', executable: 'ansible-playbook', decision: 'deny' as const }];
    const result = await service.updateConfig({
      mode: 'jev',
      jevInstructions: 'Allow Docker Desktop operations.',
      jevApprovalThreshold: 0.92,
      rules,
    });

    expect(result).toMatchObject({
      mode: 'jev',
      jevInstructions: 'Allow Docker Desktop operations.',
      jevApprovalThreshold: 0.92,
      rules,
    });
    expect(JSON.stringify(result)).not.toContain('management-key');
    await expect(service.getConfig()).resolves.toMatchObject(result);
  });

  it('assigns ids to hard-rule inputs when a caller omits them', async () => {
    const result = await service.updateConfig({
      mode: 'manual',
      rules: [{ kind: 'tool', name: 'terminal_spawn', decision: 'deny' }],
    });

    expect(result.rules).toEqual([{
      id: 'rule-1',
      kind: 'tool',
      name: 'terminal_spawn',
      decision: 'deny',
    }]);
  });

  it('requires an OpenRouter credential for Jev mode and rejects other providers', async () => {
    credentialsService.getProviderConfigForCredential.mockResolvedValueOnce(null);
    await expect(service.updateConfig({ mode: 'jev' })).rejects.toThrow(BadRequestException);
    credentialsService.getProviderConfigForCredential.mockResolvedValue({ provider: 'openai', apiKey: 'key' });
    await expect(service.updateConfig({ mode: 'jev' })).rejects.toThrow(BadRequestException);
  });

  it('rejects unsafe Jev thresholds and malformed hard rules', async () => {
    await expect(service.updateConfig({ mode: 'manual', jevApprovalThreshold: 0.5 })).rejects.toThrow(BadRequestException);
    await expect(service.updateConfig({ mode: 'manual', rules: [{ id: 'bad', kind: 'tool', name: '', decision: 'allow' }] })).rejects.toThrow(BadRequestException);
  });

  it('rejects auto mode when no persona is configured', async () => {
    await expect(service.updateConfig({ mode: 'auto', autoPersonaId: null })).rejects.toThrow(BadRequestException);
  });

  it.each([0.50001, 1])('persists valid boundary threshold %s', async (jevApprovalThreshold) => {
    await expect(service.updateConfig({ mode: 'manual', jevApprovalThreshold })).resolves.toMatchObject({ jevApprovalThreshold });
    await expect(service.getConfig()).resolves.toMatchObject({ jevApprovalThreshold });
  });

  it.each([NaN, Infinity, -1, 0.5, 1.01])('rejects invalid threshold %s', async (jevApprovalThreshold) => {
    await expect(service.updateConfig({ mode: 'manual', jevApprovalThreshold })).rejects.toThrow(BadRequestException);
  });

  it('requires a persona for explicitly enabled Jev fallback', async () => {
    await expect(service.updateConfig({ mode: 'jev', jevFallbackToPersona: true })).rejects.toThrow(BadRequestException);
    await expect(service.updateConfig({ mode: 'jev', jevFallbackToPersona: true, autoPersonaId: 'reviewer-persona' })).resolves.toMatchObject({ jevFallbackToPersona: true });
    expect(personaService.findOne).toHaveBeenCalledWith('reviewer-persona');
  });

  it('rejects auto mode when the configured persona does not exist', async () => {
    personaService.findOne.mockRejectedValue(new NotFoundException('missing persona'));

    await expect(service.updateConfig({ mode: 'auto', autoPersonaId: 'missing' })).rejects.toThrow(BadRequestException);
  });

  it('allows switching to manual when the previously saved auto persona no longer exists', async () => {
    await expect(service.updateConfig({ mode: 'auto', autoPersonaId: 'reviewer-persona' })).resolves.toEqual({
      ...DEFAULT_CONFIG,
      mode: 'auto',
      autoPersonaId: 'reviewer-persona',
    });

    personaService.findOne.mockRejectedValue(new NotFoundException('missing persona'));

    await expect(service.updateConfig({ mode: 'manual' })).resolves.toEqual({
      ...DEFAULT_CONFIG,
      mode: 'manual',
      autoPersonaId: 'reviewer-persona',
    });
  });

  it('persists external HITL policy settings independently from tool HITL mode', async () => {
    await expect(service.updateConfig({
      mode: 'manual',
      externalPolicyEnabled: true,
      externalPolicyPersonaId: 'reviewer-persona',
    })).resolves.toEqual({
      ...DEFAULT_CONFIG,
      mode: 'manual',
      externalPolicyEnabled: true,
      externalPolicyPersonaId: 'reviewer-persona',
    });

    expect(personaService.findOne).toHaveBeenCalledWith('reviewer-persona');
  });

  it('rejects enabled external HITL policy without a persona', async () => {
    await expect(service.updateConfig({
      mode: 'manual',
      externalPolicyEnabled: true,
      externalPolicyPersonaId: null,
    })).rejects.toThrow(BadRequestException);
  });

  it('persists representative unattended fallback and notification channel', async () => {
    await expect(service.updateConfig({
      mode: 'manual',
      unattendedFallback: 'representative',
      representativePersonaId: 'reviewer-persona',
      notificationChannel: 'telegram',
    })).resolves.toEqual({
      ...DEFAULT_CONFIG,
      unattendedFallback: 'representative',
      representativePersonaId: 'reviewer-persona',
      notificationChannel: 'telegram',
    });

    expect(personaService.findOne).toHaveBeenCalledWith('reviewer-persona');
    await expect(service.getConfig()).resolves.toEqual({
      ...DEFAULT_CONFIG,
      unattendedFallback: 'representative',
      representativePersonaId: 'reviewer-persona',
      notificationChannel: 'telegram',
    });
  });

  it('rejects representative unattended fallback without a persona', async () => {
    await expect(service.updateConfig({
      mode: 'manual',
      unattendedFallback: 'representative',
      representativePersonaId: null,
    })).rejects.toThrow(BadRequestException);
  });

  it('persists RA-App approval timeout independently from approval mode', async () => {
    await expect(service.updateConfig({
      mode: 'manual',
      raAppApprovalTimeoutMs: 120_000,
    })).resolves.toEqual({
      ...DEFAULT_CONFIG,
      raAppApprovalTimeoutMs: 120_000,
    });

    await expect(service.getConfig()).resolves.toEqual({
      ...DEFAULT_CONFIG,
      raAppApprovalTimeoutMs: 120_000,
    });
  });

  it('rejects invalid RA-App approval timeout values', async () => {
    await expect(service.updateConfig({
      mode: 'manual',
      raAppApprovalTimeoutMs: -1,
    })).rejects.toThrow(BadRequestException);

    await expect(service.updateConfig({
      mode: 'manual',
      raAppApprovalTimeoutMs: 86_400_001,
    })).rejects.toThrow(BadRequestException);

    await expect(service.updateConfig({
      mode: 'manual',
      raAppApprovalTimeoutMs: 1.5,
    })).rejects.toThrow(BadRequestException);
  });
});
