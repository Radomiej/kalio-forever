import { BaseOpenAICompatibleProvider } from './base-openai-compatible.provider';

export class OpenAIProvider extends BaseOpenAICompatibleProvider {
  constructor(apiKey: string, model = 'gpt-4o-mini', baseUrl?: string) {
    super('OpenAI', apiKey, model, baseUrl);
  }
}
