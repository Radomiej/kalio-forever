import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { LLMToolCall, LLMConfig, LLMProviderType } from '@kalio/types';
import type { ILLMProvider, ProviderConfig, LLMToolDef, StreamChatOptions } from './llm.types';
import { createRuntimeLLMProvider } from './providers/provider-factory';
import { CredentialsService } from '../credentials/credentials.service';
import { TimeoutSettingsService } from '../credentials/timeout-settings.service';
import type { ContextManagedLLMMessage } from '../../common/utils/context-managed-llm-message.util';
import { ProviderStreamLimiterService } from './provider-stream-limiter.service';

export type { ILLMProvider, StreamChatOptions, LLMToolDef } from './llm.types';

@Injectable()
export class LLMService {
  private readonly logger = new Logger(LLMService.name);
  /** Cached fallback provider built from the current effective .env config. */
  private envProvider: ILLMProvider;
  private envProviderKey: string;
  private readonly envConfig: ProviderConfig;
  private readonly forceEnvLlm: boolean;

  constructor(
    private readonly config: ConfigService,
    private readonly credentialsService: CredentialsService,
    private readonly timeoutSettings: TimeoutSettingsService,
    private readonly streamLimiter: ProviderStreamLimiterService,
  ) {
    const provider = this.config.get<string>('LLM_PROVIDER', 'openai') as LLMProviderType;
    const apiKey = this.config.get<string>('LLM_API_KEY', 'mock');
    const configuredBaseUrl = this.config.get<string>('LLM_BASE_URL', 'mock');
    const model = this.config.get<string>('LLM_MODEL', 'mock');
    this.forceEnvLlm = this.config.get<string>('KALIO_FORCE_ENV_LLM', '') === '1';

    const baseUrl = configuredBaseUrl === 'mock' ? undefined : configuredBaseUrl;

    this.envConfig = { provider, apiKey, model, baseUrl };
    this.envProviderKey = this.getProviderConfigKey(this.envConfig);
    this.envProvider = createRuntimeLLMProvider(this.envConfig);

    if (this.forceEnvLlm) {
      this.logger.warn('LLM provider forced to env config; active DB credential is ignored');
    } else if (provider === 'mock' || apiKey === 'mock') {
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
      this.envProvider = createRuntimeLLMProvider(config);
      this.envProviderKey = nextKey;
    }
    return this.envProvider;
  }

  /**
   * Returns the active provider: DB-selected credential > .env fallback.
   * Called per-request so credential changes are reflected immediately.
   */
  private async getActiveProvider(): Promise<{ provider: ILLMProvider; config: ProviderConfig }> {
    if (!this.forceEnvLlm) {
      const dbConfig = await this.credentialsService.getActiveProviderConfig();
      if (dbConfig) {
        this.logger.log(`LLM provider: ${dbConfig.provider} / ${dbConfig.model} (from DB)`);
        return { provider: createRuntimeLLMProvider(dbConfig), config: dbConfig };
      }
    }

    const envConfig = await this.getEffectiveEnvConfig();
    return { provider: this.getOrCreateEnvProvider(envConfig), config: envConfig };
  }

  async streamChatWithConfig(
    config: ProviderConfig,
    messages: ContextManagedLLMMessage[],
    tools: LLMToolDef[],
    options: StreamChatOptions,
  ): Promise<LLMToolCall[]> {
    return this.runStreamChatWithConfig(config, messages, tools, await this.withGenerationDefaults(options));
  }

  async streamChat(
    messages: ContextManagedLLMMessage[],
    tools: LLMToolDef[],
    options: StreamChatOptions,
  ): Promise<LLMToolCall[]> {
    const active = await this.getActiveProvider();
    return this.runStreamChatWithConfig(
      active.config,
      messages,
      tools,
      await this.withGenerationDefaults(options),
      active.provider,
    );
  }

  private async withGenerationDefaults(options: StreamChatOptions): Promise<StreamChatOptions> {
    if (options.maxOutputTokens !== undefined) {
      return options;
    }
    const { maxTokens } = await this.credentialsService.getGenerationSettings();
    return { ...options, maxOutputTokens: maxTokens };
  }

  async getConfig(): Promise<LLMConfig & { source: 'db' | 'env' }> {
    if (!this.forceEnvLlm) {
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
    }

    const envConfig = await this.getEffectiveEnvConfig();

    return {
      provider: envConfig.provider as LLMProviderType,
      apiKey: '',
      baseUrl: this.normalizeEnvDisplayValue(envConfig.baseUrl),
      model: envConfig.model,
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

    const activeCredentialId = this.forceEnvLlm ? null : await this.credentialsService.getActiveCredentialId();
    if (activeCredentialId) {
      await this.credentialsService.updateModel(activeCredentialId, normalizedModel);
    } else {
      await this.credentialsService.setEnvModelOverride(normalizedModel);
    }

    return this.getConfig();
  }

  createProvider(config: ProviderConfig): ILLMProvider {
    return createRuntimeLLMProvider(config);
  }

  private async runStreamChatWithConfig(
    config: ProviderConfig,
    messages: ContextManagedLLMMessage[],
    tools: LLMToolDef[],
    options: StreamChatOptions,
    provider?: ILLMProvider,
  ): Promise<LLMToolCall[]> {
    const override = options.modelOverride?.trim();
    const effectiveConfig = override && override !== config.model
      ? { ...config, model: override }
      : config;
    const providerToUse = override && override !== config.model
      ? this.createProvider(effectiveConfig)
      : (provider ?? this.createProvider(effectiveConfig));
    const limiterKey = this.providerLimiterKey(effectiveConfig);
    const maxConcurrent = await this.maxConcurrentStreamsFor(effectiveConfig.provider);
    return this.streamLimiter.run(
      limiterKey,
      maxConcurrent,
      () => providerToUse.streamChat(messages, tools, options),
    );
  }

  private providerLimiterKey(config: ProviderConfig): string {
    const base = config.baseUrl?.trim() || 'default';
    return `${config.provider}:${base}`;
  }

  private async maxConcurrentStreamsFor(provider: string): Promise<number> {
    const normalizedProvider = provider.trim().toLowerCase();
    const rawOverrides = this.config.get<string>('LLM_PROVIDER_MAX_CONCURRENT_STREAMS_BY_PROVIDER', '');
    const override = this.maxConcurrentOverride(rawOverrides, normalizedProvider);
    if (override !== undefined) {
      return override;
    }
    const configuredDefault = await this.timeoutSettings.getProviderMaxConcurrentStreams();
    const rawDefault = this.config.get<string>('LLM_PROVIDER_MAX_CONCURRENT_STREAMS', String(configuredDefault));
    const parsed = Number.parseInt(rawDefault, 10);
    return Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, 20) : 2;
  }

  private maxConcurrentOverride(raw: string, provider: string): number | undefined {
    if (!raw.trim()) {
      return undefined;
    }
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return undefined;
      }
      const value = (parsed as Record<string, unknown>)[provider];
      return typeof value === 'number' && Number.isFinite(value) && value > 0
        ? Math.min(Math.floor(value), 20)
        : undefined;
    } catch {
      return undefined;
    }
  }
}
