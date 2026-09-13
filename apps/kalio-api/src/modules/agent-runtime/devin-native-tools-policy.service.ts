import { Injectable, Logger } from '@nestjs/common';
import { AppSettingsService } from '../../database/app-settings.service';
import { DEFAULT_DEVIN_NATIVE_TOOLS_POLICY, type DevinNativeToolsPolicy } from './devin-native-tools';

export const DEVIN_NATIVE_TOOLS_SETTING_KEY = 'devin.cli.native-tools';

type StoredPolicy = Pick<DevinNativeToolsPolicy, 'filesystem' | 'web' | 'terminal'>;

@Injectable()
export class DevinNativeToolsPolicyService {
  private readonly logger = new Logger(DevinNativeToolsPolicyService.name);

  constructor(private readonly appSettings: AppSettingsService) {}

  async get(): Promise<DevinNativeToolsPolicy> {
    const stored = await this.appSettings.get(DEVIN_NATIVE_TOOLS_SETTING_KEY);
    if (!stored) return { ...DEFAULT_DEVIN_NATIVE_TOOLS_POLICY };
    try {
      const parsed: unknown = JSON.parse(stored);
      if (isStoredPolicy(parsed)) return { ...parsed, source: 'settings' };
    } catch (error) {
      this.logger.warn(`Invalid Devin native tool settings ignored: ${error instanceof Error ? error.message : String(error)}`);
    }
    return { ...DEFAULT_DEVIN_NATIVE_TOOLS_POLICY };
  }

  async update(policy: StoredPolicy): Promise<DevinNativeToolsPolicy> {
    await this.appSettings.set(DEVIN_NATIVE_TOOLS_SETTING_KEY, JSON.stringify(policy));
    return { ...policy, source: 'settings' };
  }
}

function isStoredPolicy(value: unknown): value is StoredPolicy {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return typeof record['filesystem'] === 'boolean'
    && typeof record['web'] === 'boolean'
    && typeof record['terminal'] === 'boolean';
}
