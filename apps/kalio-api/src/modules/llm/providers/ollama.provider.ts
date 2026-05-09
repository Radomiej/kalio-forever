import { BaseOpenAICompatibleProvider } from './base-openai-compatible.provider';

export class OllamaProvider extends BaseOpenAICompatibleProvider {
  constructor(apiKey = 'ollama', model = 'qwen2.5:7b', baseUrl?: string) {
    super('Ollama', apiKey, model, baseUrl ?? 'http://localhost:11434/v1');
  }
}
