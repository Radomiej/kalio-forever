import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { DECISION_SETTINGS, type DecisionSettingsPort, type HitlHardRule } from '@kalio/types';
import { AppSettingsService } from '../../database/app-settings.service';
import { PersonaService } from '../persona/persona.service';
import {
  isHitlMode,
  isHitlNotificationChannel,
  isHitlUnattendedFallback,
  type ResolvedHitlConfig,
  type HitlMode,
  type HitlNotificationChannel,
  type HitlUnattendedFallback,
  type UpdateHitlConfigDto,
} from './hitl.types';

const DEFAULT_HITL_CONFIG: ResolvedHitlConfig = {
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

const HITL_SETTING_KEYS = {
  mode: 'hitl.mode',
  autoPersonaId: 'hitl.autoPersonaId',
  unattendedFallback: 'hitl.unattendedFallback',
  representativePersonaId: 'hitl.representativePersonaId',
  notificationChannel: 'hitl.notificationChannel',
  externalPolicyEnabled: 'hitl.externalPolicyEnabled',
  externalPolicyPersonaId: 'hitl.externalPolicyPersonaId',
  raAppApprovalTimeoutMs: 'hitl.raAppApprovalTimeoutMs',
  jevInstructions: 'hitl.jevInstructions',
  jevApprovalThreshold: 'hitl.jevApprovalThreshold',
  jevFallbackToPersona: 'hitl.jevFallbackToPersona',
  rules: 'hitl.rules',
} as const;

function normalizePersonaId(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? '';
  return trimmed.length > 0 ? trimmed : null;
}

@Injectable()
export class HitlConfigService {
  constructor(
    private readonly appSettings: AppSettingsService,
    private readonly personaService: PersonaService,
    @Inject(DECISION_SETTINGS) private readonly decisions: DecisionSettingsPort,
  ) {}

  async getConfig(): Promise<ResolvedHitlConfig> {
    const [
      storedMode,
      storedPersonaId,
      storedUnattendedFallback,
      storedRepresentativePersonaId,
      storedNotificationChannel,
      storedExternalEnabled,
      storedExternalPersonaId,
      storedRaAppApprovalTimeoutMs,
      storedJevInstructions,
      storedJevApprovalThreshold,
      storedJevFallbackToPersona,
      storedRules,
    ] = await Promise.all([
      this.appSettings.get(HITL_SETTING_KEYS.mode),
      this.appSettings.get(HITL_SETTING_KEYS.autoPersonaId),
      this.appSettings.get(HITL_SETTING_KEYS.unattendedFallback),
      this.appSettings.get(HITL_SETTING_KEYS.representativePersonaId),
      this.appSettings.get(HITL_SETTING_KEYS.notificationChannel),
      this.appSettings.get(HITL_SETTING_KEYS.externalPolicyEnabled),
      this.appSettings.get(HITL_SETTING_KEYS.externalPolicyPersonaId),
      this.appSettings.get(HITL_SETTING_KEYS.raAppApprovalTimeoutMs),
      this.appSettings.get(HITL_SETTING_KEYS.jevInstructions),
      this.appSettings.get(HITL_SETTING_KEYS.jevApprovalThreshold),
      this.appSettings.get(HITL_SETTING_KEYS.jevFallbackToPersona),
      this.appSettings.get(HITL_SETTING_KEYS.rules),
    ]);

    return {
      mode: isHitlMode(storedMode) ? storedMode : DEFAULT_HITL_CONFIG.mode,
      autoPersonaId: normalizePersonaId(storedPersonaId),
      unattendedFallback: isHitlUnattendedFallback(storedUnattendedFallback)
        ? storedUnattendedFallback
        : DEFAULT_HITL_CONFIG.unattendedFallback,
      representativePersonaId: normalizePersonaId(storedRepresentativePersonaId),
      notificationChannel: isHitlNotificationChannel(storedNotificationChannel)
        ? storedNotificationChannel
        : DEFAULT_HITL_CONFIG.notificationChannel,
      externalPolicyEnabled: storedExternalEnabled === 'true',
      externalPolicyPersonaId: normalizePersonaId(storedExternalPersonaId),
      raAppApprovalTimeoutMs: this.parseStoredRaAppApprovalTimeout(storedRaAppApprovalTimeoutMs),
      jevInstructions: this.normalizeJevInstructions(storedJevInstructions ?? ''),
      jevApprovalThreshold: this.parseStoredJevApprovalThreshold(storedJevApprovalThreshold),
      jevFallbackToPersona: this.parseStoredJevFallback(storedJevFallbackToPersona),
      rules: this.parseStoredRules(storedRules),
    };
  }

  async updateConfig(dto: UpdateHitlConfigDto): Promise<ResolvedHitlConfig> {
    const current = await this.getConfig();
    const nextMode = this.normalizeMode(dto.mode);
    const nextAutoPersonaId = dto.autoPersonaId !== undefined
      ? normalizePersonaId(dto.autoPersonaId)
      : current.autoPersonaId;
    const nextUnattendedFallback = dto.unattendedFallback !== undefined
      ? this.normalizeUnattendedFallback(dto.unattendedFallback)
      : current.unattendedFallback;
    const nextRepresentativePersonaId = dto.representativePersonaId !== undefined
      ? normalizePersonaId(dto.representativePersonaId)
      : current.representativePersonaId;
    const nextNotificationChannel = dto.notificationChannel !== undefined
      ? this.normalizeNotificationChannel(dto.notificationChannel)
      : current.notificationChannel;
    const nextExternalPolicyEnabled = dto.externalPolicyEnabled ?? current.externalPolicyEnabled;
    const nextExternalPolicyPersonaId = dto.externalPolicyPersonaId !== undefined
      ? normalizePersonaId(dto.externalPolicyPersonaId)
      : current.externalPolicyPersonaId;
    const nextRaAppApprovalTimeoutMs = dto.raAppApprovalTimeoutMs !== undefined
      ? this.normalizeRaAppApprovalTimeoutMs(dto.raAppApprovalTimeoutMs)
      : current.raAppApprovalTimeoutMs;
    const nextJevInstructions = dto.jevInstructions !== undefined
      ? this.normalizeJevInstructions(dto.jevInstructions)
      : current.jevInstructions;
    const nextJevApprovalThreshold = dto.jevApprovalThreshold !== undefined
      ? this.normalizeJevApprovalThreshold(dto.jevApprovalThreshold)
      : current.jevApprovalThreshold;
    const nextRules = dto.rules !== undefined
      ? this.normalizeRules(dto.rules)
      : current.rules;
    const nextJevFallbackToPersona = dto.jevFallbackToPersona ?? current.jevFallbackToPersona ?? false;
    if (typeof nextJevFallbackToPersona !== 'boolean') {
      throw new BadRequestException('Jev persona fallback must be a boolean.');
    }
    if (nextMode === 'jev' && nextJevFallbackToPersona) {
      if (!nextAutoPersonaId) throw new BadRequestException('Jev persona fallback requires a configured persona.');
      await this.ensurePersonaExists(nextAutoPersonaId);
    }

    if (nextMode === 'auto' && nextAutoPersonaId === null) {
      throw new BadRequestException('Auto HITL mode requires a configured persona.');
    }

    if (nextMode === 'auto' && nextAutoPersonaId !== null) {
      await this.ensurePersonaExists(nextAutoPersonaId);
    }

    if (nextMode === 'jev') await this.decisions.resolve();

    if (nextUnattendedFallback === 'representative' && nextRepresentativePersonaId === null) {
      throw new BadRequestException('Representative HITL fallback requires a configured persona.');
    }

    if (nextUnattendedFallback === 'representative' && nextRepresentativePersonaId !== null) {
      await this.ensurePersonaExists(nextRepresentativePersonaId);
    }

    if (nextExternalPolicyEnabled && nextExternalPolicyPersonaId === null) {
      throw new BadRequestException('External HITL policy requires a configured persona.');
    }

    if (nextExternalPolicyEnabled && nextExternalPolicyPersonaId !== null) {
      await this.ensurePersonaExists(nextExternalPolicyPersonaId);
    }

    await this.appSettings.set(HITL_SETTING_KEYS.mode, nextMode);

    if (nextAutoPersonaId === null) {
      await this.appSettings.delete(HITL_SETTING_KEYS.autoPersonaId);
    } else {
      await this.appSettings.set(HITL_SETTING_KEYS.autoPersonaId, nextAutoPersonaId);
    }

    await this.appSettings.set(HITL_SETTING_KEYS.unattendedFallback, nextUnattendedFallback);

    if (nextRepresentativePersonaId === null) {
      await this.appSettings.delete(HITL_SETTING_KEYS.representativePersonaId);
    } else {
      await this.appSettings.set(HITL_SETTING_KEYS.representativePersonaId, nextRepresentativePersonaId);
    }

    await this.appSettings.set(HITL_SETTING_KEYS.notificationChannel, nextNotificationChannel);

    await this.appSettings.set(HITL_SETTING_KEYS.externalPolicyEnabled, String(nextExternalPolicyEnabled));

    if (nextExternalPolicyPersonaId === null) {
      await this.appSettings.delete(HITL_SETTING_KEYS.externalPolicyPersonaId);
    } else {
      await this.appSettings.set(HITL_SETTING_KEYS.externalPolicyPersonaId, nextExternalPolicyPersonaId);
    }
    await this.appSettings.set(HITL_SETTING_KEYS.raAppApprovalTimeoutMs, String(nextRaAppApprovalTimeoutMs));
    await this.appSettings.set(HITL_SETTING_KEYS.jevInstructions, nextJevInstructions);
    await this.appSettings.set(HITL_SETTING_KEYS.jevApprovalThreshold, String(nextJevApprovalThreshold));
    await this.appSettings.set(HITL_SETTING_KEYS.jevFallbackToPersona, String(nextJevFallbackToPersona));
    await this.appSettings.set(HITL_SETTING_KEYS.rules, JSON.stringify(nextRules));

    return {
      mode: nextMode,
      autoPersonaId: nextAutoPersonaId,
      unattendedFallback: nextUnattendedFallback,
      representativePersonaId: nextRepresentativePersonaId,
      notificationChannel: nextNotificationChannel,
      externalPolicyEnabled: nextExternalPolicyEnabled,
      externalPolicyPersonaId: nextExternalPolicyPersonaId,
      raAppApprovalTimeoutMs: nextRaAppApprovalTimeoutMs,
      jevInstructions: nextJevInstructions,
      jevApprovalThreshold: nextJevApprovalThreshold,
      jevFallbackToPersona: nextJevFallbackToPersona,
      rules: nextRules,
    };
  }

  private normalizeMode(mode: string): HitlMode {
    if (isHitlMode(mode)) {
      return mode;
    }

    throw new BadRequestException(`Unsupported HITL mode: ${mode}`);
  }

  private normalizeUnattendedFallback(value: string): HitlUnattendedFallback {
    if (isHitlUnattendedFallback(value)) {
      return value;
    }

    throw new BadRequestException(`Unsupported HITL unattended fallback: ${value}`);
  }

  private normalizeNotificationChannel(value: string): HitlNotificationChannel {
    if (isHitlNotificationChannel(value)) {
      return value;
    }

    throw new BadRequestException(`Unsupported HITL notification channel: ${value}`);
  }

  private parseStoredRaAppApprovalTimeout(value: string | null): number {
    if (value === null) {
      return DEFAULT_HITL_CONFIG.raAppApprovalTimeoutMs;
    }

    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
      return DEFAULT_HITL_CONFIG.raAppApprovalTimeoutMs;
    }

    try {
      return this.normalizeRaAppApprovalTimeoutMs(parsed);
    } catch {
      return DEFAULT_HITL_CONFIG.raAppApprovalTimeoutMs;
    }
  }

  private normalizeRaAppApprovalTimeoutMs(value: number): number {
    if (!Number.isFinite(value) || !Number.isInteger(value)) {
      throw new BadRequestException('RA-App approval timeout must be an integer number of milliseconds.');
    }

    if (value < 0 || value > 24 * 60 * 60 * 1000) {
      throw new BadRequestException('RA-App approval timeout must be between 0 and 86400000 milliseconds.');
    }

    return value;
  }

  private parseStoredJevApprovalThreshold(value: string | null): number {
    if (value === null) return DEFAULT_HITL_CONFIG.jevApprovalThreshold;
    return this.normalizeJevApprovalThreshold(Number(value));
  }

  private parseStoredJevFallback(value: string | null): boolean {
    if (value === null) return false;
    if (value !== 'true' && value !== 'false') {
      throw new BadRequestException('Stored Jev persona fallback must be a boolean.');
    }
    return value === 'true';
  }

  private normalizeJevApprovalThreshold(value: number): number {
    if (!Number.isFinite(value) || value <= 0.5 || value > 1) {
      throw new BadRequestException('Jev approval threshold must be greater than 0.5 and at most 1.');
    }
    return value;
  }

  private normalizeJevInstructions(value: string): string {
    if (typeof value !== 'string' || value.length > 2_000) {
      throw new BadRequestException('Jev instructions must be text with at most 2000 characters.');
    }
    return value.trim();
  }

  private parseStoredRules(value: string | null): HitlHardRule[] {
    if (value === null) return [];
    try {
      return this.normalizeRules(JSON.parse(value) as unknown);
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      throw new BadRequestException('Stored HITL hard rules must be valid JSON.');
    }
  }

  private normalizeRules(value: unknown): HitlHardRule[] {
    if (!Array.isArray(value) || value.length > 100) {
      throw new BadRequestException('HITL hard rules must be an array with at most 100 entries.');
    }
    return value.map((entry, index) => {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
        throw new BadRequestException(`HITL hard rule ${index + 1} is invalid.`);
      }
      const rule = entry as Record<string, unknown>;
      const kind = rule['kind'];
      const name = typeof rule['name'] === 'string' ? rule['name'].trim() : '';
      const decision = rule['decision'];
      const executable = typeof rule['executable'] === 'string' ? rule['executable'].trim() : undefined;
      const argumentsContains = typeof rule['argumentsContains'] === 'string'
        ? rule['argumentsContains'].trim()
        : undefined;
      if ((kind !== '*' && kind !== 'tool' && kind !== 'raapp_native' && kind !== 'external_security')
        || name.length === 0
        || (decision !== 'allow' && decision !== 'deny' && decision !== 'ask_user')
        || (rule['id'] !== undefined && (typeof rule['id'] !== 'string' || rule['id'].trim().length === 0))
        || (rule['executable'] !== undefined && typeof rule['executable'] !== 'string')
        || (rule['argumentsContains'] !== undefined && typeof rule['argumentsContains'] !== 'string')
        || (executable !== undefined && executable.length === 0)
        || (argumentsContains !== undefined && argumentsContains.length === 0)) {
        throw new BadRequestException(`HITL hard rule ${index + 1} is invalid.`);
      }
      return {
        id: typeof rule['id'] === 'string' ? rule['id'].trim() : `rule-${index + 1}`,
        kind,
        name,
        decision,
        ...(executable ? { executable } : {}),
        ...(argumentsContains ? { argumentsContains } : {}),
      };
    });
  }

  private async ensurePersonaExists(personaId: string): Promise<void> {
    try {
      await this.personaService.findOne(personaId);
    } catch {
      throw new BadRequestException(`Auto HITL persona "${personaId}" was not found.`);
    }
  }
}
