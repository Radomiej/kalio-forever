import { Injectable } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { AppSettingsService } from './app-settings.service';

export const KALIO_MCP_BRIDGE_TOKEN_SETTING_KEY = 'kalio.mcp.bridge.token';
export const KALIO_MCP_BRIDGE_TOKEN_MIN_LENGTH = 16;

export type KalioMcpBridgeTokenSource = 'settings' | 'environment' | 'none';

export interface KalioMcpBridgeTokenStatus {
  enabled: boolean;
  source: KalioMcpBridgeTokenSource;
}

@Injectable()
export class KalioMcpBridgeTokenService {
  constructor(private readonly appSettings: AppSettingsService) {}

  async getToken(): Promise<string | null> {
    const configured = await this.readConfiguredToken();
    return configured.token;
  }

  async getStatus(): Promise<KalioMcpBridgeTokenStatus> {
    const configured = await this.readConfiguredToken();
    return {
      enabled: Boolean(configured.token),
      source: configured.source,
    };
  }

  async setOverride(value: string): Promise<KalioMcpBridgeTokenStatus> {
    const token = normalizeToken(value);
    if (!token || token.length < KALIO_MCP_BRIDGE_TOKEN_MIN_LENGTH) {
      throw new Error(`Kalio MCP bridge token must be at least ${KALIO_MCP_BRIDGE_TOKEN_MIN_LENGTH} characters.`);
    }
    await this.appSettings.set(KALIO_MCP_BRIDGE_TOKEN_SETTING_KEY, token);
    return { enabled: true, source: 'settings' };
  }

  async generate(): Promise<KalioMcpBridgeTokenStatus> {
    await this.appSettings.set(
      KALIO_MCP_BRIDGE_TOKEN_SETTING_KEY,
      randomBytes(32).toString('hex'),
    );
    return { enabled: true, source: 'settings' };
  }

  async clearOverride(): Promise<KalioMcpBridgeTokenStatus> {
    await this.appSettings.delete(KALIO_MCP_BRIDGE_TOKEN_SETTING_KEY);
    return this.getStatus();
  }

  private async readConfiguredToken(): Promise<{ token: string | null; source: KalioMcpBridgeTokenSource }> {
    const settingsToken = normalizeToken(await this.appSettings.get(KALIO_MCP_BRIDGE_TOKEN_SETTING_KEY));
    if (settingsToken) return { token: settingsToken, source: 'settings' };

    const environmentToken = normalizeToken(process.env['KALIO_MCP_BRIDGE_TOKEN']);
    if (environmentToken) return { token: environmentToken, source: 'environment' };

    return { token: null, source: 'none' };
  }
}

function normalizeToken(value: string | null | undefined): string | null {
  const normalized = value?.trim();
  return normalized || null;
}
