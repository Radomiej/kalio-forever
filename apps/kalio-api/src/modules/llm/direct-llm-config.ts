import { BadRequestException } from '@nestjs/common';
import { resolveLlmProviderBaseUrl } from '../../common/utils/llm-provider-http.util';
import { LLMProviderError } from './providers/base-openai-compatible.provider';
import type { ProviderConfig } from './llm.types';

/** Validate only direct inference; CLI agents have their own authentication. */
export function assertDirectLLMConfig(config: ProviderConfig): void {
  if (config.provider === 'mock') return;
  const endpoint = resolveLlmProviderBaseUrl(config.provider, config.baseUrl);
  let local = ['ollama', 'bitnet'].includes(config.provider.toLowerCase());
  try {
    const url = new URL(endpoint);
    local ||= ['http:', 'https:'].includes(url.protocol)
      && (url.hostname === 'localhost' || url.hostname === '[::1]' || /^127(?:\.\d{1,3}){3}$/.test(url.hostname));
  } catch {
    throw new BadRequestException('Direct LLM endpoint is invalid. Set LLM_BASE_URL to an HTTP(S) provider endpoint.');
  }
  if (!local && (!config.apiKey.trim() || config.apiKey === 'mock')) {
    throw new LLMProviderError('LLM_AUTH',
      'Direct LLM credentials are missing. Select a saved credential in Settings or set LLM_API_KEY for this provider. CLI agents authenticate independently.');
  }
  if (!config.model.trim() || config.model === 'mock') {
    throw new BadRequestException('Direct LLM model is missing. Select a model in Settings or set LLM_MODEL. CLI agents remain available.');
  }
}
