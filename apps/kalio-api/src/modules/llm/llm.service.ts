import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { LLMMessage, LLMStreamChunk, LLMToolCall, LLMConfig, LLMProviderType } from '@kalio/types';
import type { ILLMProvider, ProviderConfig } from './llm.types';
import { createLLMProvider } from './providers/provider-factory';
import { CredentialsService } from '../credentials/credentials.service';

export type { ILLMProvider } from './llm.types';

@Injectable()
export class LLMService {
  private readonly logger = new Logger(LLMService.name);
  /** Fallback provider built from .env — always available */
  private readonly envProvider: ILLMProvider;
  private readonly envConfig: ProviderConfig;

  constructor(
    private readonly config: ConfigService,
    private readonly credentialsService: CredentialsService,
  ) {
    const provider = this.config.get<string>('LLM_PROVIDER', 'openai') as LLMProviderType;
    const apiKey = this.config.get<string>('LLM_API_KEY', 'mock');
    const baseUrl = this.config.get<string>('LLM_BASE_URL', 'mock');
    const model = this.config.get<string>('LLM_MODEL', 'mock');

    this.envConfig = { provider, apiKey, model, baseUrl };
    this.envProvider = createLLMProvider(this.envConfig);

    if (provider === 'mock' || apiKey === 'mock') {
      this.logger.warn('Env LLM config incomplete — will use active DB credential if set');
    } else {
      this.logger.log(`LLM provider (env fallback): ${provider} / ${model}`);
    }
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
    return { provider: this.envProvider, config: this.envConfig };
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
    return {
      provider: this.config.get<string>('LLM_PROVIDER', 'openai') as LLMProviderType,
      apiKey: '',
      baseUrl: this.config.get<string>('LLM_BASE_URL', ''),
      model: this.config.get<string>('LLM_MODEL', ''),
      source: 'env',
    };
  }

  createProvider(config: ProviderConfig): ILLMProvider {
    return createLLMProvider(config);
  }
}
