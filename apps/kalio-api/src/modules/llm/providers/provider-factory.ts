import type { ILLMProvider, ProviderConfig } from '../llm.types';
import { MockLLMProvider } from './mock.provider';
import { OpenRouterProvider } from './openrouter.provider';
import { CometAPIProvider } from './cometapi.provider';
import { OpenAIProvider } from './openai.provider';
import { OllamaProvider } from './ollama.provider';
import { XiaomiMiMoProvider } from './xiaomimimo.provider';
import { BaseOpenAICompatibleProvider } from './base-openai-compatible.provider';

export type { ProviderConfig } from '../llm.types';

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
    case 'custom':
      // Custom provider: must provide a baseUrl (openai-compatible endpoint)
      if (!baseUrl) throw new Error(`Unknown LLM provider: "${provider}" — custom requires a baseUrl`);
      return new BaseOpenAICompatibleProvider('custom', apiKey, model, baseUrl);
    case 'deepseek':
      return new BaseOpenAICompatibleProvider('deepseek', apiKey, model, baseUrl ?? 'https://api.deepseek.com/v1');
    case 'bitnet':
      return new BaseOpenAICompatibleProvider('bitnet', apiKey, model, baseUrl ?? 'http://localhost:8080/v1');
    default:
      throw new Error(`Unknown LLM provider: "${provider}". Supported: openai, openrouter, cometapi, xiaomimimo, ollama, deepseek, bitnet, custom`);
  }
}
