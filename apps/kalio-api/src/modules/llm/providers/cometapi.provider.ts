import { BaseOpenAICompatibleProvider } from './base-openai-compatible.provider';

export class CometAPIProvider extends BaseOpenAICompatibleProvider {
  constructor(apiKey: string, model = 'gpt-4o-mini', baseUrl?: string) {
    super('CometAPI', apiKey, model, baseUrl);
  }
}
