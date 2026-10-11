import { BadRequestException, Injectable } from '@nestjs/common';
import type { DecisionConnection, DecisionSettings, DecisionSettingsPort } from '@kalio/types';
import { AppSettingsService } from '../database/app-settings.service';
import { CredentialsService } from '../modules/credentials/credentials.service';

const SETTING_KEY = 'decision.config';
const DEFAULT_CONFIG: DecisionSettings = { provider: 'openrouter', model: 'typesafe/jev-1.13', credentialId: null, endpoint: '' };
const ENDPOINTS = { openrouter: 'https://openrouter.ai/api/alpha/decisions', typesafe: 'https://api.typesafe.ai/v1/systemone' };

@Injectable()
export class DecisionSettingsService implements DecisionSettingsPort {
  constructor(private readonly settings: AppSettingsService, private readonly credentials: CredentialsService) {}

  async getConfig(): Promise<DecisionSettings> {
    const stored = await this.settings.get(SETTING_KEY);
    const config = stored ? this.validate(JSON.parse(stored) as unknown) : { ...DEFAULT_CONFIG };
    if (!config.credentialId && config.provider !== 'custom') {
      const candidates = (await this.credentials.findAll())
        .filter((credential) => credential.provider.toLowerCase() === config.provider || (!stored && credential.provider.toLowerCase() === 'typesafe'))
        .sort((a, b) => Number(a.provider.toLowerCase() !== 'openrouter') - Number(b.provider.toLowerCase() !== 'openrouter') || a.createdAt - b.createdAt || a.id.localeCompare(b.id));
      for (const candidate of candidates) {
        const connection = await this.credentials.getProviderConfigForCredential(candidate.id);
        if (connection?.apiKey.trim() && connection.provider.toLowerCase() === candidate.provider.toLowerCase()) {
          if (!stored && candidate.provider.toLowerCase() === 'typesafe') { config.provider = 'typesafe'; config.model = 'jev-1.13.0'; }
          config.credentialId = candidate.id;
          break;
        }
      }
    }
    return config;
  }

  async updateConfig(input: DecisionSettings): Promise<DecisionSettings> {
    const config = this.validate(input);
    if (config.credentialId || config.provider === 'custom') await this.connection(config);
    await this.settings.set(SETTING_KEY, JSON.stringify(config));
    return this.getConfig();
  }

  async resolve(): Promise<DecisionConnection> {
    return this.connection(await this.getConfig());
  }

  private async connection(config: DecisionSettings): Promise<DecisionConnection> {
    const endpoint = config.provider === 'custom' ? config.endpoint : ENDPOINTS[config.provider];
    let apiKey = '';
    if (config.credentialId) {
      const credential = await this.credentials.getProviderConfigForCredential(config.credentialId);
      if (!credential || (config.provider !== 'custom' && credential.provider.toLowerCase() !== config.provider) || !credential.apiKey.trim()) {
        throw new BadRequestException('The selected Decision credential is unavailable or incompatible.');
      }
      apiKey = credential.apiKey;
    } else if (config.provider !== 'custom') {
      throw new BadRequestException('Add a compatible provider credential before enabling decisions.');
    }
    return { endpoint, model: config.model, apiKey };
  }

  private validate(input: unknown): DecisionSettings {
    if (typeof input !== 'object' || input === null || Array.isArray(input)) throw new BadRequestException('Invalid Decision Settings.');
    const value = input as Record<string, unknown>;
    const provider = value['provider'];
    if (provider !== 'openrouter' && provider !== 'typesafe' && provider !== 'custom') throw new BadRequestException('Invalid Decision provider.');
    const model = value['model'];
    if (typeof model !== 'string' || !model.trim() || model.length > 200) throw new BadRequestException('A Decision model is required.');
    const credentialId = value['credentialId'];
    if (credentialId !== null && (typeof credentialId !== 'string' || !credentialId.trim() || credentialId.length > 200)) throw new BadRequestException('Invalid Decision credential.');
    const endpoint = value['endpoint'];
    if (typeof endpoint !== 'string') throw new BadRequestException('Invalid Decision endpoint.');
    if (provider === 'custom') {
      let url: URL;
      try { url = new URL(endpoint); } catch { throw new BadRequestException('Enter an absolute Decision endpoint URL.'); }
      const local = url.hostname === 'localhost' || url.hostname === '[::1]' || /^127(?:\.\d{1,3}){3}$/.test(url.hostname);
      if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) || url.username || url.password || url.hash || url.search || endpoint.length > 2_000) {
        throw new BadRequestException('Use HTTPS, or HTTP on loopback, without credentials, query or fragment in the endpoint.');
      }
    }
    return { provider, model: model.trim(), credentialId: credentialId === null ? null : credentialId.trim(), endpoint: provider === 'custom' ? endpoint.trim() : '' };
  }
}
