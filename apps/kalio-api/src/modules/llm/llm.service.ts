import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { LLMMessage, LLMStreamChunk, LLMToolCall, LLMConfig } from '@kalio/types';
import { MockLLMProvider } from './providers/mock.provider';
import { OpenAICompatibleProvider } from './providers/openai-compatible.provider';

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
    const apiKey = this.config.get<string>('LLM_API_KEY', 'mock');
    const baseUrl = this.config.get<string>('LLM_BASE_URL', 'mock');
    const model = this.config.get<string>('LLM_MODEL', 'mock');

    if (apiKey === 'mock' || baseUrl === 'mock') {
      this.provider = new MockLLMProvider();
      this.logger.warn('Using MockLLMProvider — no real LLM calls');
    } else {
      this.provider = new OpenAICompatibleProvider({ apiKey, baseUrl, model });
      this.logger.log(`LLM provider: ${baseUrl} / ${model}`);
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
      apiKey: this.config.get<string>('LLM_API_KEY', ''),
      baseUrl: this.config.get<string>('LLM_BASE_URL', ''),
      model: this.config.get<string>('LLM_MODEL', ''),
    };
  }
}
