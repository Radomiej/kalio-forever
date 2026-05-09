// Keep this logic in sync with apps/kalio-api/src/common/utils/local-llm-provider.util.ts
// until it can be extracted into a shared runtime-safe package.
const LOCAL_HOSTNAMES = new Set(['localhost', '127.0.0.1', '0.0.0.0', '::1', 'host.docker.internal']);

export const PROVIDER_LABELS: Record<string, string> = {
  openai: 'OpenAI',
  xiaomimimo: 'Xiaomi MiMo',
  deepseek: 'DeepSeek',
  cometapi: 'CometAPI',
  openrouter: 'OpenRouter',
  ollama: 'Ollama',
  bitnet: 'BitNet',
  custom: 'Custom',
};

export const PROVIDER_BASE_URLS: Record<string, string> = {
  openai: 'https://api.openai.com/v1',
  xiaomimimo: 'https://token-plan-ams.xiaomimimo.com/v1',
  deepseek: 'https://api.deepseek.com/v1',
  cometapi: 'https://api.cometapi.com/v1',
  openrouter: 'https://openrouter.ai/api/v1',
  ollama: 'http://localhost:11434/v1',
  bitnet: 'http://localhost:8080/v1',
  custom: '',
};

export const PROVIDER_DEFAULT_MODELS: Record<string, string> = {
  openai: 'gpt-4o-mini',
  xiaomimimo: 'mimo-v2-omni',
  deepseek: 'deepseek-reasoner',
  cometapi: 'gpt-4o-mini',
  openrouter: 'openai/gpt-4o-mini',
  ollama: 'llama3.2',
  bitnet: 'bitnet-b1.58-2b-4t',
  custom: '',
};

export const ALL_PROVIDER_TYPES = ['openai', 'xiaomimimo', 'deepseek', 'cometapi', 'openrouter', 'ollama', 'bitnet', 'custom'];

export function isLocalBaseUrl(baseUrl?: string): boolean {
  if (!baseUrl || baseUrl.trim().length === 0) return false;
  const raw = baseUrl.trim();
  const normalized = /^https?:\/\//i.test(raw) ? raw : `http://${raw}`;

  try {
    const { hostname } = new URL(normalized);
    return LOCAL_HOSTNAMES.has(hostname) || hostname.endsWith('.local');
  } catch {
    return false;
  }
}

export function isLocalLlmProviderConfig(provider: string, baseUrl?: string): boolean {
  return provider === 'ollama' || provider === 'bitnet' || (provider === 'custom' && isLocalBaseUrl(baseUrl));
}