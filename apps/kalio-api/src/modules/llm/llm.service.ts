import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { LLMMessage, LLMStreamChunk, LLMToolCall, LLMConfig, LLMProviderType } from '@kalio/types';
import type { ILLMProvider, ProviderConfig } from './llm.types';
import { createLLMProvider } from './providers/provider-factory';
import { CredentialsService } from '../credentials/credentials.service';

export type { ILLMProvider } from './llm.types';

@Injectable()
export class LLMService {
  private readonly logger = new Logger(LLMService.name);
  /** Cached fallback provider built from the current effective .env config. */
  private envProvider: ILLMProvider;
  private envProviderKey: string;
  private readonly envConfig: ProviderConfig;

  constructor(
    private readonly config: ConfigService,
    private readonly credentialsService: CredentialsService,
  ) {
    const provider = this.config.get<string>('LLM_PROVIDER', 'openai') as LLMProviderType;
    const apiKey = this.config.get<string>('LLM_API_KEY', 'mock');
    const configuredBaseUrl = this.config.get<string>('LLM_BASE_URL', 'mock');
    const model = this.config.get<string>('LLM_MODEL', 'mock');

    const baseUrl = configuredBaseUrl === 'mock' ? undefined : configuredBaseUrl;

    this.envConfig = { provider, apiKey, model, baseUrl };
    this.envProviderKey = this.getProviderConfigKey(this.envConfig);
    this.envProvider = createLLMProvider(this.envConfig);

    if (provider === 'mock' || apiKey === 'mock') {
      this.logger.warn('Env LLM config incomplete — will use active DB credential if set');
    } else {
      this.logger.log(`LLM provider (env fallback): ${provider} / ${model}`);
    }
  }

  private getProviderConfigKey(config: ProviderConfig): string {
    return [config.provider, config.apiKey, config.model, config.baseUrl ?? ''].join('::');
  }

  private normalizeEnvDisplayValue(value?: string): string {
    return value === 'mock' ? '' : (value ?? '');
  }

  private async getEffectiveEnvConfig(): Promise<ProviderConfig> {
    const modelOverride = await this.credentialsService.getEnvModelOverride();

    return {
      ...this.envConfig,
      model: modelOverride ?? this.envConfig.model,
      baseUrl: this.envConfig.baseUrl === 'mock' ? undefined : this.envConfig.baseUrl,
    };
  }

  private getOrCreateEnvProvider(config: ProviderConfig): ILLMProvider {
    const nextKey = this.getProviderConfigKey(config);
    if (nextKey !== this.envProviderKey) {
      this.envProvider = createLLMProvider(config);
      this.envProviderKey = nextKey;
    }
    return this.envProvider;
  }

  /**
   * Returns the active provider: DB-selected credential > .env fallback.
   * Called per-request so credential changes are reflected immediately.
   */
  private async getActiveProvider(): Promise<{ provider: ILLMProvider; config: ProviderConfig }> {
    const dbConfig = await this.credentialsService.getActiveProviderConfig();
    if (dbConfig) {
      this.logger.log(`LLM provider: ${dbConfig.provider} / ${dbConfig.model} (from DB)`);
      return { provider: createLLMProvider(dbConfig), config: dbConfig };
    }

    const envConfig = await this.getEffectiveEnvConfig();
    return { provider: this.getOrCreateEnvProvider(envConfig), config: envConfig };
  }

  async streamChat(
    messages: LLMMessage[],
    tools: Array<{ name: string; description: string; parameters: Record<string, unknown> }>,
    onChunk: (chunk: LLMStreamChunk) => void,
    sessionId: string,
    messageId: string,
    abortSignal?: AbortSignal,
  ): Promise<LLMToolCall[]> {
    const { provider } = await this.getActiveProvider();
    return provider.streamChat(messages, tools, onChunk, sessionId, messageId, abortSignal);
  }

  async getConfig(): Promise<LLMConfig & { source: 'db' | 'env' }> {
    const dbConfig = await this.credentialsService.getActiveProviderConfig();
    if (dbConfig) {
      return {
        provider: dbConfig.provider as LLMProviderType,
        apiKey: '',  // never expose in API
        baseUrl: dbConfig.baseUrl ?? '',
        model: dbConfig.model,
        source: 'db',
      };
    }

    const envConfig = await this.getEffectiveEnvConfig();

    return {
      provider: envConfig.provider as LLMProviderType,
      apiKey: '',
      baseUrl: this.normalizeEnvDisplayValue(envConfig.baseUrl),
      model: this.normalizeEnvDisplayValue(envConfig.model),
      source: 'env',
    };
  }

  async getActiveModels(): Promise<string[]> {
    const { config } = await this.getActiveProvider();
    return this.credentialsService.getModelsForProviderConfig(config);
  }

  async updateActiveModel(model: string): Promise<LLMConfig & { source: 'db' | 'env' }> {
    const normalizedModel = model.trim();
    if (normalizedModel.length === 0) {
      throw new BadRequestException('Model must be a non-empty string');
    }

    const activeCredentialId = await this.credentialsService.getActiveCredentialId();
    if (activeCredentialId) {
      await this.credentialsService.updateModel(activeCredentialId, normalizedModel);
    } else {
      await this.credentialsService.setEnvModelOverride(normalizedModel);
    }

    return this.getConfig();
  }

  createProvider(config: ProviderConfig): ILLMProvider {
    return createLLMProvider(config);
  }
}
