import { BaseOpenAICompatibleProvider } from './base-openai-compatible.provider';

export class OpenRouterProvider extends BaseOpenAICompatibleProvider {
  constructor(apiKey: string, model = 'openai/gpt-4o-mini', baseUrl?: string) {
    super('OpenRouter', apiKey, model, baseUrl);
  }
}
