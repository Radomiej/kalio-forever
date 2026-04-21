import type { ILLMProvider } from '../llm.service';
import { MockLLMProvider } from './mock.provider';
import { OpenRouterProvider } from './openrouter.provider';
import { CometAPIProvider } from './cometapi.provider';
import { OpenAIProvider } from './openai.provider';
import { OllamaProvider } from './ollama.provider';
import { XiaomiMiMoProvider } from './xiaomimimo.provider';

export interface ProviderConfig {
  provider: string;
  apiKey: string;
  model: string;
  baseUrl?: string;
}

export function createLLMProvider(config: ProviderConfig): ILLMProvider {
  const { provider, apiKey, model, baseUrl } = config;

  // Handle mock provider
  if (provider === 'mock' || apiKey === 'mock' || baseUrl === 'mock') {
    return new MockLLMProvider();
  }

  // Resolve provider name case-insensitively
  const providerLower = provider.toLowerCase();

  switch (providerLower) {
    case 'openrouter':
      return new OpenRouterProvider(apiKey, model, baseUrl);
    case 'cometapi':
      return new CometAPIProvider(apiKey, model, baseUrl);
    case 'xiaomimimo':
      return new XiaomiMiMoProvider(apiKey, model, baseUrl);
    case 'openai':
      return new OpenAIProvider(apiKey, model, baseUrl);
    case 'ollama':
      return new OllamaProvider(apiKey, model, baseUrl);
    default:
      // Custom provider = OpenAI-compatible endpoint
      return new OpenAIProvider(apiKey, model, baseUrl);
  }
}
