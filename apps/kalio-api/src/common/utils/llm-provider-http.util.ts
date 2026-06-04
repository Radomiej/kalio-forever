const DEFAULT_XIAOMI_BASE_URL = 'https://token-plan-ams.xiaomimimo.com/v1';

export const XIAOMI_COMPAT_HEADERS: Record<string, string> = {
  'HTTP-Referer': 'https://github.com/RooVetGit/Roo-Cline',
  Referer: 'https://github.com/RooVetGit/Roo-Cline',
  Origin: 'https://github.com/RooVetGit/Roo-Cline',
  'X-Title': 'Roo Code',
  'User-Agent': 'RooCode/3.17.0',
  'X-Client-Source': 'roo-code',
  'X-AI-Code-Tool': 'Roo Code',
  'X-Coding-Agent': 'Roo Code',
};

const DEFAULT_LLM_PROVIDER_BASE_URLS: Record<string, string> = {
  openai: 'https://api.openai.com/v1',
  xiaomimimo: DEFAULT_XIAOMI_BASE_URL,
  deepseek: 'https://api.deepseek.com/v1',
  cometapi: 'https://api.cometapi.com/v1',
  openrouter: 'https://openrouter.ai/api/v1',
  ollama: 'http://localhost:11434/v1',
  bitnet: 'http://localhost:8080/v1',
};

export const XIAOMI_BASE_URL = DEFAULT_XIAOMI_BASE_URL;

const OPENAI_FALLBACK_BASE_URL = 'https://api.openai.com/v1';

function xiaomiCompatHeaders(apiKey?: string): Record<string, string> {
  return apiKey ? { Authorization: `Bearer ${apiKey}`, ...XIAOMI_COMPAT_HEADERS } : { ...XIAOMI_COMPAT_HEADERS };
}

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
  if (normalizeProviderKey(provider) === 'xiaomimimo') {
    return xiaomiCompatHeaders(apiKey);
  }

  return apiKey ? { Authorization: `Bearer ${apiKey}` } : {};
}

export function readEnvBooleanFlag(value: string | undefined, defaultValue: boolean): boolean {
  if (value === undefined) {
    return defaultValue;
  }

  const normalized = value.trim().toLowerCase();
  if (normalized === 'true') {
    return true;
  }
  if (normalized === 'false') {
    return false;
  }

  return defaultValue;
}
