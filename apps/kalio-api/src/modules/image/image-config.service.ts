import { Injectable, Logger } from '@nestjs/common';
import { AppSettingsService } from '../../database/app-settings.service';
import type { ImageProviderConfig, ImageConfigResponse, UpdateImageConfigDto } from '@kalio/types';

const SETTINGS_KEY = 'image_config';

const DEFAULT_CONFIG: ImageConfigResponse = {
  provider: 'auto',
  model: 'flux-schnell',
  source: 'default',
};

@Injectable()
export class ImageConfigService {
  private readonly logger = new Logger(ImageConfigService.name);

  constructor(private readonly settings: AppSettingsService) {}

  async getConfig(): Promise<ImageConfigResponse> {
    const raw = await this.settings.get(SETTINGS_KEY);
    if (!raw) return { ...DEFAULT_CONFIG };
    try {
      const parsed = JSON.parse(raw) as Omit<ImageProviderConfig, 'apiKey'>;
      return {
        provider: parsed.provider ?? DEFAULT_CONFIG.provider,
        baseUrl: parsed.baseUrl,
        model: parsed.model ?? DEFAULT_CONFIG.model,
        compression: parsed.compression,
        source: 'db',
      };
    } catch (err) {
      this.logger.error('Failed to parse image config from DB', err instanceof Error ? err : new Error(String(err)));
      return { ...DEFAULT_CONFIG };
    }
  }

  async updateConfig(dto: UpdateImageConfigDto): Promise<ImageConfigResponse> {
    const existing = await this.settings.get(SETTINGS_KEY);
    let current: Record<string, unknown> = {};
    if (existing) {
      try {
        current = JSON.parse(existing) as Record<string, unknown>;
      } catch {
        current = {};
      }
    }

    const updated: Record<string, unknown> = { ...current };
    if (dto.provider !== undefined) updated['provider'] = dto.provider;
    if (dto.apiKey !== undefined) updated['apiKey'] = dto.apiKey;
    if (dto.baseUrl !== undefined) updated['baseUrl'] = dto.baseUrl;
    if (dto.model !== undefined) updated['model'] = dto.model;
    if (dto.compression !== undefined) updated['compression'] = dto.compression;

    await this.settings.set(SETTINGS_KEY, JSON.stringify(updated));
    return this.getConfig();
  }

  /** Returns apiKey stored in DB (never exposed to FE). Used by tools only. */
  async getApiKey(): Promise<string | null> {
    const raw = await this.settings.get(SETTINGS_KEY);
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      const key = parsed['apiKey'];
      return typeof key === 'string' && key.length > 0 ? key : null;
    } catch {
      return null;
    }
  }
}
