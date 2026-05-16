import type { LLMConfig } from '@kalio/types';
import { BaseOpenAICompatibleProvider } from './base-openai-compatible.provider';

export class OpenAICompatibleProvider extends BaseOpenAICompatibleProvider {
  constructor(config: LLMConfig) {
    super(config.provider, config.apiKey, config.model, config.baseUrl);
  }
}
