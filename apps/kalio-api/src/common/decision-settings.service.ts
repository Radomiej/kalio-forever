import { BadRequestException, Injectable } from '@nestjs/common';
import type { DecisionConnection, DecisionPurpose, DecisionSettings, DecisionSettingsPort } from '@kalio/types';
import { AppSettingsService } from '../database/app-settings.service';
import { CredentialsService } from '../modules/credentials/credentials.service';

const SETTING_KEY = 'decision.config';
const DEFAULT_CONFIG: DecisionSettings = { provider: 'openrouter', model: 'typesafe/jev-1.13', credentialId: null, endpoint: '' };
const ENDPOINTS = { openrouter: 'https://openrouter.ai/api/alpha/decisions', typesafe: 'https://api.typesafe.ai/v1/systemone' };

@Injectable()
export class DecisionSettingsService implements DecisionSettingsPort {
  private revision = 0;
  private toolsRevision = 0;
  private goalsRevision = 0;
  private readonly writes = { tools: 0, goals: 0 };
  constructor(private readonly settings: AppSettingsService, private readonly credentials: CredentialsService) {}

  async getConfig(purpose: DecisionPurpose = 'goals'): Promise<DecisionSettings> {
    this.validatePurpose(purpose);
    let stored = await this.settings.get(purpose === 'tools' ? 'decision.tools.config' : SETTING_KEY);
    // TODO: legacy fallback — tools inherit the old shared configuration until explicitly overridden.
    if (stored == null && purpose === 'tools') stored = await this.settings.get(SETTING_KEY);
    const config = stored != null ? this.validate(JSON.parse(stored) as unknown) : { ...DEFAULT_CONFIG };
    if (!config.credentialId && config.provider !== 'custom' && config.provider !== 'ollama') {
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

  async updateConfig(input: DecisionSettings, purpose: DecisionPurpose = 'goals'): Promise<DecisionSettings> {
    this.validatePurpose(purpose);
    const config = this.validate(input);
    if (config.provider === 'ollama' && purpose !== 'tools') throw new BadRequestException('Native Ollama goal decisions are not supported.');
    if (config.credentialId || config.provider === 'custom' || config.provider === 'ollama') await this.connection(config);
    this.changed(purpose);
    ++this.writes[purpose];
    try { await this.settings.set(purpose === 'tools' ? 'decision.tools.config' : SETTING_KEY, JSON.stringify(config)); }
    finally { --this.writes[purpose]; this.changed(purpose); }
    return this.getConfig(purpose);
  }

  async resolve(purpose: DecisionPurpose = 'goals'): Promise<DecisionConnection> {
    const before = this.revision;
    if (this.writes[purpose] > 0) throw new BadRequestException('Decision settings are changing.');
    const config = await this.getConfig(purpose);
    if (config.provider === 'ollama' && purpose !== 'tools') throw new BadRequestException('Native Ollama goal decisions are not supported.');
    const explicitTools = purpose === 'tools' && await this.settings.get('decision.tools.config') != null;
    if (before !== this.revision || this.writes[purpose] > 0 || !explicitTools && this.writes.goals > 0) throw new BadRequestException('Decision settings changed during resolution.');
    return this.connection(config, explicitTools ? this.toolsRevision : this.goalsRevision);
  }

  private async connection(config: DecisionSettings, revision = this.revision): Promise<DecisionConnection> {
    if (config.provider === 'ollama') {
      if (process.env['KALIO_DEV_LOCAL_DECISIONS'] !== 'true') throw new BadRequestException('Local decisions are disabled by the host.');
      return { protocol: 'ollama-chat', endpoint: config.endpoint, model: config.model, revision };
    }
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
    return { protocol: 'jev-decisions', endpoint, model: config.model, apiKey };
  }

  private validate(input: unknown): DecisionSettings {
    if (typeof input !== 'object' || input === null || Array.isArray(input)) throw new BadRequestException('Invalid Decision Settings.');
    const value = input as Record<string, unknown>;
    const provider = value['provider'];
    if (provider !== 'openrouter' && provider !== 'typesafe' && provider !== 'custom' && provider !== 'ollama') throw new BadRequestException('Invalid Decision provider.');
    if (Object.keys(value).some(key => !['provider', 'model', 'credentialId', 'endpoint'].includes(key))) throw new BadRequestException('Invalid Decision Settings.');
    const model = value['model'];
    if (typeof model !== 'string' || !model.trim() || model.length > 200) throw new BadRequestException('A Decision model is required.');
    const credentialId = value['credentialId'];
    if (credentialId !== null && (typeof credentialId !== 'string' || !credentialId.trim() || credentialId.length > 200)) throw new BadRequestException('Invalid Decision credential.');
    const endpoint = value['endpoint'];
    if (typeof endpoint !== 'string') throw new BadRequestException('Invalid Decision endpoint.');
    if (provider === 'ollama') {
      let url: URL;
      try { url = new URL(endpoint); } catch { throw new BadRequestException('Invalid Ollama endpoint.'); }
      if (credentialId !== null || !['http:', 'https:'].includes(url.protocol)
        || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || url.pathname !== '/api/chat'
        || url.username || url.password || url.search || url.hash || endpoint.length > 2000) throw new BadRequestException('Use a keyless loopback Ollama /api/chat endpoint.');
    }
    if (provider === 'custom') {
      let url: URL;
      try { url = new URL(endpoint); } catch { throw new BadRequestException('Enter an absolute Decision endpoint URL.'); }
      const local = url.hostname === 'localhost' || url.hostname === '[::1]' || /^127(?:\.\d{1,3}){3}$/.test(url.hostname);
      if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) || url.username || url.password || url.hash || url.search || endpoint.length > 2_000) {
        throw new BadRequestException('Use HTTPS, or HTTP on loopback, without credentials, query or fragment in the endpoint.');
      }
    }
    return { provider, model: model.trim(), credentialId: credentialId === null ? null : credentialId.trim(), endpoint: provider === 'custom' || provider === 'ollama' ? endpoint.trim() : '' };
  }

  private validatePurpose(purpose: DecisionPurpose): void {
    if (purpose !== 'tools' && purpose !== 'goals') throw new BadRequestException('Invalid Decision purpose.');
  }

  private changed(purpose: DecisionPurpose): void {
    if (purpose === 'tools') this.toolsRevision = ++this.revision;
    else this.goalsRevision = ++this.revision;
  }
}
