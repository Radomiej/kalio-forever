import { BadRequestException, Injectable } from '@nestjs/common';
import { AppSettingsService } from '../../database/app-settings.service';
import { PersonaService } from '../persona/persona.service';
import {
  isHitlMode,
  isHitlNotificationChannel,
  isHitlUnattendedFallback,
  type HitlConfig,
  type HitlMode,
  type HitlNotificationChannel,
  type HitlUnattendedFallback,
  type UpdateHitlConfigDto,
} from './hitl.types';

const DEFAULT_HITL_CONFIG: HitlConfig = {
  mode: 'manual',
  autoPersonaId: null,
  unattendedFallback: 'pause',
  representativePersonaId: null,
  notificationChannel: 'none',
  externalPolicyEnabled: false,
  externalPolicyPersonaId: null,
  raAppApprovalTimeoutMs: 600_000,
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
  ) {}

  async getConfig(): Promise<HitlConfig> {
    const [
      storedMode,
      storedPersonaId,
      storedUnattendedFallback,
      storedRepresentativePersonaId,
      storedNotificationChannel,
      storedExternalEnabled,
      storedExternalPersonaId,
      storedRaAppApprovalTimeoutMs,
    ] = await Promise.all([
      this.appSettings.get(HITL_SETTING_KEYS.mode),
      this.appSettings.get(HITL_SETTING_KEYS.autoPersonaId),
      this.appSettings.get(HITL_SETTING_KEYS.unattendedFallback),
      this.appSettings.get(HITL_SETTING_KEYS.representativePersonaId),
      this.appSettings.get(HITL_SETTING_KEYS.notificationChannel),
      this.appSettings.get(HITL_SETTING_KEYS.externalPolicyEnabled),
      this.appSettings.get(HITL_SETTING_KEYS.externalPolicyPersonaId),
      this.appSettings.get(HITL_SETTING_KEYS.raAppApprovalTimeoutMs),
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
    };
  }

  async updateConfig(dto: UpdateHitlConfigDto): Promise<HitlConfig> {
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

    if (nextMode === 'auto' && nextAutoPersonaId === null) {
      throw new BadRequestException('Auto HITL mode requires a configured persona.');
    }

    if (nextMode === 'auto' && nextAutoPersonaId !== null) {
      await this.ensurePersonaExists(nextAutoPersonaId);
    }

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

    return {
      mode: nextMode,
      autoPersonaId: nextAutoPersonaId,
      unattendedFallback: nextUnattendedFallback,
      representativePersonaId: nextRepresentativePersonaId,
      notificationChannel: nextNotificationChannel,
      externalPolicyEnabled: nextExternalPolicyEnabled,
      externalPolicyPersonaId: nextExternalPolicyPersonaId,
      raAppApprovalTimeoutMs: nextRaAppApprovalTimeoutMs,
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

  private async ensurePersonaExists(personaId: string): Promise<void> {
    try {
      await this.personaService.findOne(personaId);
    } catch {
      throw new BadRequestException(`Auto HITL persona "${personaId}" was not found.`);
    }
  }
}
