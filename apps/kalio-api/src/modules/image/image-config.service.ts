import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';
import { AppSettingsService } from '../../database/app-settings.service';
import type { ImageProviderConfig, ImageConfigResponse, UpdateImageConfigDto } from '@kalio/types';

const SETTINGS_KEY = 'image_config';
const CREDENTIALS_CIPHER_PREFIX = 'kalio-enc-v1';
const CREDENTIALS_MASTER_KEY_ENV = 'CREDENTIALS_MASTER_KEY';
const DEV_FALLBACK_CREDENTIALS_MASTER_KEY = 'kalio-dev-credentials-master-key-not-for-production';

const DEFAULT_CONFIG: ImageConfigResponse = {
  provider: 'auto',
  model: 'flux-schnell',
  source: 'default',
};

@Injectable()
export class ImageConfigService {
  private readonly logger = new Logger(ImageConfigService.name);
  private hasWarnedAboutFallbackMasterKey = false;

  constructor(
    private readonly settings: AppSettingsService,
    private readonly config: ConfigService,
  ) {}

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
      } catch (err) {
        this.logger.error('Failed to parse existing image config during update', err instanceof Error ? err : new Error(String(err)));
        current = {};
      }
    }

    const updated: Record<string, unknown> = { ...current };
    if (dto.provider !== undefined) updated['provider'] = dto.provider;
    if (dto.apiKey !== undefined) {
      updated['apiKey'] = this.encryptApiKey(dto.apiKey);
    } else if (typeof current['apiKey'] === 'string') {
      updated['apiKey'] = current['apiKey'];
    }
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
      if (typeof key !== 'string' || key.length === 0) {
        return null;
      }
      return this.tryDecryptApiKey(key);
    } catch (err) {
      this.logger.error('Failed to read image apiKey from DB', err instanceof Error ? err : new Error(String(err)));
      return null;
    }
  }

  private encryptApiKey(apiKey: string): string {
    if (!apiKey) return '';

    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.getEncryptionKey(), iv);
    const encrypted = Buffer.concat([cipher.update(apiKey, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();

    return [
      CREDENTIALS_CIPHER_PREFIX,
      iv.toString('base64'),
      authTag.toString('base64'),
      encrypted.toString('base64'),
    ].join(':');
  }

  private decryptApiKey(storedValue: string): string {
    if (!storedValue || !storedValue.startsWith(`${CREDENTIALS_CIPHER_PREFIX}:`)) {
      return storedValue;
    }

    const [prefix, ivBase64, authTagBase64, payloadBase64] = storedValue.split(':');
    if (!prefix || !ivBase64 || !authTagBase64 || !payloadBase64) {
      throw new Error('Stored image credential is malformed and cannot be decrypted');
    }

    const decipher = createDecipheriv('aes-256-gcm', this.getEncryptionKey(), Buffer.from(ivBase64, 'base64'));
    decipher.setAuthTag(Buffer.from(authTagBase64, 'base64'));

    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(payloadBase64, 'base64')),
      decipher.final(),
    ]);

    return decrypted.toString('utf8');
  }

  private tryDecryptApiKey(storedValue: string): string | null {
    try {
      return this.decryptApiKey(storedValue);
    } catch (err) {
      this.logger.error('Failed to decrypt stored image apiKey', err instanceof Error ? err : new Error(String(err)));
      return null;
    }
  }

  private getEncryptionKey(): Buffer {
    return scryptSync(this.getMasterKey(), CREDENTIALS_CIPHER_PREFIX, 32);
  }

  private getMasterKey(): string {
    const configured = this.config.get<string>(CREDENTIALS_MASTER_KEY_ENV, '');
    if (configured) {
      return configured;
    }

    const nodeEnv = this.config.get<string>('NODE_ENV', 'development');
    if (nodeEnv === 'production') {
      throw new Error(`${CREDENTIALS_MASTER_KEY_ENV} must be configured in production`);
    }

    if (nodeEnv !== 'test' && !this.hasWarnedAboutFallbackMasterKey) {
      this.hasWarnedAboutFallbackMasterKey = true;
      this.logger.warn(
        `${CREDENTIALS_MASTER_KEY_ENV} is not set; using the development fallback key. Set it explicitly outside local dev.`,
      );
    }

    return DEV_FALLBACK_CREDENTIALS_MASTER_KEY;
  }
}
