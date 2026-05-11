const DEFAULT_LLM_PROVIDER_BASE_URLS: Record<string, string> = {
  openai: 'https://api.openai.com/v1',
  xiaomimimo: 'https://token-plan-ams.xiaomimimo.com/v1',
  deepseek: 'https://api.deepseek.com/v1',
  cometapi: 'https://api.cometapi.com/v1',
  openrouter: 'https://openrouter.ai/api/v1',
  ollama: 'http://localhost:11434/v1',
  bitnet: 'http://localhost:8080/v1',
};

const XIAOMI_COMPAT_HEADERS: Record<string, string> = {
  'HTTP-Referer': 'https://github.com/RooVetGit/Roo-Cline',
  'X-Title': 'Roo Code',
  'User-Agent': 'RooCode/3.17.0',
};

const OPENAI_FALLBACK_BASE_URL = 'https://api.openai.com/v1';

function normalizeProviderKey(provider: unknown): string {
  return typeof provider === 'string' ? provider.toLowerCase() : '';
}

export function resolveLlmProviderBaseUrl(provider: string, baseUrl?: string): string {
  const trimmedBaseUrl = baseUrl?.trim();
  if (trimmedBaseUrl) {
    return trimmedBaseUrl.replace(/\/$/, '');
  }

  return DEFAULT_LLM_PROVIDER_BASE_URLS[normalizeProviderKey(provider)] ?? OPENAI_FALLBACK_BASE_URL;
}

export function buildProviderCompatHeaders(provider: string, apiKey?: string): Record<string, string> {
  const headers: Record<string, string> = apiKey ? { Authorization: `Bearer ${apiKey}` } : {};

  if (normalizeProviderKey(provider) === 'xiaomimimo') {
    Object.assign(headers, XIAOMI_COMPAT_HEADERS);
  }

  return headers;
}