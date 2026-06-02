import { describe, expect, it } from 'vitest';
import {
  ALL_PROVIDER_TYPES,
  PROVIDER_BASE_URLS,
  PROVIDER_DEFAULT_MODELS,
  PROVIDER_LABELS,
  isLocalBaseUrl,
  isLocalLlmProviderConfig,
} from './llm-provider-settings';

describe('llm-provider-settings', () => {
  it('recognizes local base URLs in the forms the UI accepts', () => {
    expect(isLocalBaseUrl('localhost:11434/v1')).toBe(true);
    expect(isLocalBaseUrl('http://127.0.0.1:11434/v1')).toBe(true);
    expect(isLocalBaseUrl('https://host.docker.internal/v1')).toBe(true);
    expect(isLocalBaseUrl('https://api.openai.com/v1')).toBe(false);
    expect(isLocalBaseUrl('not a url')).toBe(false);
    expect(isLocalBaseUrl('   ')).toBe(false);
  });

  it('treats local providers and custom local URLs as keyless', () => {
    expect(isLocalLlmProviderConfig('ollama')).toBe(true);
    expect(isLocalLlmProviderConfig('bitnet')).toBe(true);
    expect(isLocalLlmProviderConfig('custom', 'localhost:8080/v1')).toBe(true);
    expect(isLocalLlmProviderConfig('custom', 'https://api.openai.com/v1')).toBe(false);
    expect(isLocalLlmProviderConfig('openai', 'localhost:8080/v1')).toBe(false);
  });

  it('keeps provider labels, defaults, and type ordering aligned with the settings UI', () => {
    expect(ALL_PROVIDER_TYPES).toEqual([
      'openai',
      'xiaomimimo',
      'deepseek',
      'cometapi',
      'openrouter',
      'ollama',
      'bitnet',
      'custom',
    ]);
    expect(PROVIDER_LABELS).toMatchObject({
      openai: 'OpenAI',
      deepseek: 'DeepSeek',
      ollama: 'Ollama',
      bitnet: 'BitNet',
      custom: 'Custom',
    });
    expect(PROVIDER_BASE_URLS).toMatchObject({
      openai: 'https://api.openai.com/v1',
      ollama: 'http://localhost:11434/v1',
      bitnet: 'http://localhost:8080/v1',
    });
    expect(PROVIDER_DEFAULT_MODELS).toMatchObject({
      openai: 'gpt-4o-mini',
      deepseek: 'deepseek-reasoner',
      bitnet: 'bitnet-b1.58-2b-4t',
    });
  });
});
