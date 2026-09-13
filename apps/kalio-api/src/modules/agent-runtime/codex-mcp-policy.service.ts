import { Injectable } from '@nestjs/common';
import { AppSettingsService } from '../../database/app-settings.service';

export const CODEX_MCP_INHERIT_SETTING_PREFIX = 'codex.mcp.inherit.';

export type CodexMcpPolicySource = 'settings' | 'environment' | 'default';

export interface CodexMcpPolicySettings {
  inheritConfiguredMcp: boolean;
  source: CodexMcpPolicySource;
}

@Injectable()
export class CodexMcpPolicyService {
  constructor(private readonly appSettings: AppSettingsService) {}

  async get(authProfileId: string): Promise<CodexMcpPolicySettings> {
    const stored = await this.appSettings.get(this.settingKey(authProfileId));
    if (stored === 'true' || stored === 'false') {
      return { inheritConfiguredMcp: stored === 'true', source: 'settings' };
    }

    const environment = process.env['KALIO_CODEX_INHERIT_MCP']?.trim().toLowerCase();
    if (environment === 'true' || environment === 'false') {
      return { inheritConfiguredMcp: environment === 'true', source: 'environment' };
    }

    return { inheritConfiguredMcp: false, source: 'default' };
  }

  async update(authProfileId: string, inheritConfiguredMcp: boolean): Promise<CodexMcpPolicySettings> {
    await this.appSettings.set(this.settingKey(authProfileId), String(inheritConfiguredMcp));
    return { inheritConfiguredMcp, source: 'settings' };
  }

  private settingKey(authProfileId: string): string {
    return `${CODEX_MCP_INHERIT_SETTING_PREFIX}${authProfileId}`;
  }
}
