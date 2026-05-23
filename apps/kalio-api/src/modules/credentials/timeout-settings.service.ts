import { Injectable, Optional } from '@nestjs/common';
import type { ToolTimeoutSettings } from '@kalio/types';
import { AppSettingsService } from '../../database/app-settings.service';
import { KalioConfigService } from '../../config/kalio-config.service';

const DEFAULT_TIMEOUT_SETTINGS: ToolTimeoutSettings = {
  webSearchTimeoutMs: 120_000,
  providerLocalTimeoutMs: 3_000,
  providerRemoteTimeoutMs: 15_000,
};

const TIMEOUT_BOUNDS: Record<keyof ToolTimeoutSettings, { min: number; max: number }> = {
  webSearchTimeoutMs: { min: 15_000, max: 600_000 },
  providerLocalTimeoutMs: { min: 1_000, max: 30_000 },
  providerRemoteTimeoutMs: { min: 5_000, max: 120_000 },
};

const TIMEOUT_SETTING_KEYS: Record<keyof ToolTimeoutSettings, string> = {
  webSearchTimeoutMs: 'tool_timeout_web_search_ms',
  providerLocalTimeoutMs: 'tool_timeout_provider_local_ms',
  providerRemoteTimeoutMs: 'tool_timeout_provider_remote_ms',
};

function normalizeTimeout(key: keyof ToolTimeoutSettings, rawValue: number | null | undefined): number {
  const fallback = DEFAULT_TIMEOUT_SETTINGS[key];
  if (!Number.isFinite(rawValue)) return fallback;
  const rounded = Math.round(rawValue as number);
  const bounds = TIMEOUT_BOUNDS[key];
  return Math.max(bounds.min, Math.min(bounds.max, rounded));
}

function parseStoredTimeout(key: keyof ToolTimeoutSettings, rawValue: string | null): number {
  if (rawValue === null) return DEFAULT_TIMEOUT_SETTINGS[key];
  const trimmed = rawValue.trim();
  if (!/^\d+$/.test(trimmed)) return DEFAULT_TIMEOUT_SETTINGS[key];
  return normalizeTimeout(key, Number(trimmed));
}

@Injectable()
export class TimeoutSettingsService {
  constructor(
    private readonly appSettings: AppSettingsService,
    @Optional() private readonly kalioConfig?: KalioConfigService,
  ) {}

  private async getStoredTimeoutSetting(key: keyof ToolTimeoutSettings): Promise<number> {
    const rawValue = await this.appSettings.get(TIMEOUT_SETTING_KEYS[key]);
    return parseStoredTimeout(key, rawValue);
  }

  private async getConfiguredTimeoutSettings(): Promise<Partial<ToolTimeoutSettings>> {
    return this.kalioConfig ? this.kalioConfig.getToolTimeoutSettings() : {};
  }

  private async getTimeoutSetting(
    key: keyof ToolTimeoutSettings,
    configuredSettings?: Partial<ToolTimeoutSettings>,
  ): Promise<number> {
    const configuredValue = configuredSettings?.[key];
    if (configuredValue !== undefined) {
      return normalizeTimeout(key, configuredValue);
    }

    return this.getStoredTimeoutSetting(key);
  }

  async getTimeoutSettings(): Promise<ToolTimeoutSettings> {
    const configuredSettings = await this.getConfiguredTimeoutSettings();
    const [webSearchTimeoutMs, providerLocalTimeoutMs, providerRemoteTimeoutMs] = await Promise.all([
      this.getTimeoutSetting('webSearchTimeoutMs', configuredSettings),
      this.getTimeoutSetting('providerLocalTimeoutMs', configuredSettings),
      this.getTimeoutSetting('providerRemoteTimeoutMs', configuredSettings),
    ]);

    return {
      webSearchTimeoutMs,
      providerLocalTimeoutMs,
      providerRemoteTimeoutMs,
    };
  }

  async setTimeoutSettings(settings: Partial<ToolTimeoutSettings>): Promise<void> {
    const updates: Promise<void>[] = [];

    if (settings.webSearchTimeoutMs !== undefined) {
      updates.push(
        this.appSettings.set(
          TIMEOUT_SETTING_KEYS.webSearchTimeoutMs,
          String(normalizeTimeout('webSearchTimeoutMs', settings.webSearchTimeoutMs)),
        ),
      );
    }

    if (settings.providerLocalTimeoutMs !== undefined) {
      updates.push(
        this.appSettings.set(
          TIMEOUT_SETTING_KEYS.providerLocalTimeoutMs,
          String(normalizeTimeout('providerLocalTimeoutMs', settings.providerLocalTimeoutMs)),
        ),
      );
    }

    if (settings.providerRemoteTimeoutMs !== undefined) {
      updates.push(
        this.appSettings.set(
          TIMEOUT_SETTING_KEYS.providerRemoteTimeoutMs,
          String(normalizeTimeout('providerRemoteTimeoutMs', settings.providerRemoteTimeoutMs)),
        ),
      );
    }

    await Promise.all(updates);
  }

  async getWebSearchTimeoutMs(): Promise<number> {
    return this.getTimeoutSetting('webSearchTimeoutMs', await this.getConfiguredTimeoutSettings());
  }

  async getProviderTimeoutMs(isLocal: boolean): Promise<number> {
    return this.getTimeoutSetting(
      isLocal ? 'providerLocalTimeoutMs' : 'providerRemoteTimeoutMs',
      await this.getConfiguredTimeoutSettings(),
    );
  }
}