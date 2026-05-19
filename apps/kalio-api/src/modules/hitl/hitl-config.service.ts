import { BadRequestException, Injectable } from '@nestjs/common';
import { AppSettingsService } from '../../database/app-settings.service';
import { PersonaService } from '../persona/persona.service';
import { isHitlMode, type HitlConfig, type HitlMode, type UpdateHitlConfigDto } from './hitl.types';

const DEFAULT_HITL_CONFIG: HitlConfig = {
  mode: 'manual',
  autoPersonaId: null,
};

const HITL_SETTING_KEYS = {
  mode: 'hitl.mode',
  autoPersonaId: 'hitl.autoPersonaId',
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
    const [storedMode, storedPersonaId] = await Promise.all([
      this.appSettings.get(HITL_SETTING_KEYS.mode),
      this.appSettings.get(HITL_SETTING_KEYS.autoPersonaId),
    ]);

    return {
      mode: isHitlMode(storedMode) ? storedMode : DEFAULT_HITL_CONFIG.mode,
      autoPersonaId: normalizePersonaId(storedPersonaId),
    };
  }

  async updateConfig(dto: UpdateHitlConfigDto): Promise<HitlConfig> {
    const current = await this.getConfig();
    const nextMode = this.normalizeMode(dto.mode);
    const nextAutoPersonaId = dto.autoPersonaId !== undefined
      ? normalizePersonaId(dto.autoPersonaId)
      : current.autoPersonaId;

    if (nextMode === 'auto' && nextAutoPersonaId === null) {
      throw new BadRequestException('Auto HITL mode requires a configured persona.');
    }

    if (nextMode === 'auto' && nextAutoPersonaId !== null) {
      await this.ensurePersonaExists(nextAutoPersonaId);
    }

    await this.appSettings.set(HITL_SETTING_KEYS.mode, nextMode);

    if (nextAutoPersonaId === null) {
      await this.appSettings.delete(HITL_SETTING_KEYS.autoPersonaId);
    } else {
      await this.appSettings.set(HITL_SETTING_KEYS.autoPersonaId, nextAutoPersonaId);
    }

    return {
      mode: nextMode,
      autoPersonaId: nextAutoPersonaId,
    };
  }

  private normalizeMode(mode: string): HitlMode {
    if (isHitlMode(mode)) {
      return mode;
    }

    throw new BadRequestException(`Unsupported HITL mode: ${mode}`);
  }

  private async ensurePersonaExists(personaId: string): Promise<void> {
    try {
      await this.personaService.findOne(personaId);
    } catch {
      throw new BadRequestException(`Auto HITL persona "${personaId}" was not found.`);
    }
  }
}