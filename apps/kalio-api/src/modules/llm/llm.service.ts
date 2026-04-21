import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { LLMMessage, LLMStreamChunk, LLMToolCall, LLMConfig, LLMProviderType } from '@kalio/types';
import { createLLMProvider, type ProviderConfig } from './providers/provider-factory';

export interface ILLMProvider {
  streamChat(
    messages: LLMMessage[],
    tools: Array<{ name: string; description: string; parameters: Record<string, unknown> }>,
    onChunk: (chunk: LLMStreamChunk) => void,
    sessionId: string,
    messageId: string,
  ): Promise<LLMToolCall[]>;
}

@Injectable()
export class LLMService {
  private readonly logger = new Logger(LLMService.name);
  private readonly provider: ILLMProvider;

  constructor(private readonly config: ConfigService) {
    const provider = this.config.get<string>('LLM_PROVIDER', 'openai') as LLMProviderType;
    const apiKey = this.config.get<string>('LLM_API_KEY', 'mock');
    const baseUrl = this.config.get<string>('LLM_BASE_URL', 'mock');
    const model = this.config.get<string>('LLM_MODEL', 'mock');

    const providerConfig: ProviderConfig = {
      provider,
      apiKey,
      model,
      baseUrl,
    };

    this.provider = createLLMProvider(providerConfig);

    if (provider === 'mock' || apiKey === 'mock' || baseUrl === 'mock') {
      this.logger.warn('Using MockLLMProvider — no real LLM calls (add credentials in Settings or configure env vars)');
    } else {
      this.logger.log(`LLM provider: ${provider} / ${model}`);
    }
  }

  async streamChat(
    messages: LLMMessage[],
    tools: Array<{ name: string; description: string; parameters: Record<string, unknown> }>,
    onChunk: (chunk: LLMStreamChunk) => void,
    sessionId: string,
    messageId: string,
  ): Promise<LLMToolCall[]> {
    return this.provider.streamChat(messages, tools, onChunk, sessionId, messageId);
  }

  getConfig(): LLMConfig {
    return {
      provider: this.config.get<string>('LLM_PROVIDER', 'openai') as LLMProviderType,
      apiKey: this.config.get<string>('LLM_API_KEY', ''),
      baseUrl: this.config.get<string>('LLM_BASE_URL', ''),
      model: this.config.get<string>('LLM_MODEL', ''),
    };
  }

  /**
   * Create a provider instance from config (useful for testing or dynamic provider switching)
   */
  createProvider(config: ProviderConfig): ILLMProvider {
    return createLLMProvider(config);
  }
}
