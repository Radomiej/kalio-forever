import { BaseOpenAICompatibleProvider } from './base-openai-compatible.provider';
import type { StreamChatOptions } from '../llm.types';

export class OpenRouterProvider extends BaseOpenAICompatibleProvider {
  constructor(apiKey: string, model = 'openai/gpt-4o-mini', baseUrl?: string) {
    super('OpenRouter', apiKey, model, baseUrl);
  }

  protected override buildProviderPreferences(options: StreamChatOptions): Record<string, unknown> | undefined {
    return options.structuredOutput ? { require_parameters: true } : undefined;
  }
}
