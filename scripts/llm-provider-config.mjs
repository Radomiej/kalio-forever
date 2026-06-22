export const OPENROUTER_FREE_ARCHITECTURE_MODEL = 'nvidia/nemotron-3-ultra-550b-a55b:free';

const PROVIDER_DEFAULTS = {
  mock: {
    model: 'mock',
    baseUrl: 'mock',
    apiKeyEnv: [],
  },
  openai: {
    model: 'gpt-4o-mini',
    baseUrl: 'https://api.openai.com/v1',
    apiKeyEnv: ['OPENAI_API_KEY'],
  },
  openrouter: {
    model: OPENROUTER_FREE_ARCHITECTURE_MODEL,
    baseUrl: 'https://openrouter.ai/api/v1',
    apiKeyEnv: ['OPENROUTER_API_KEY'],
  },
  xiaomimimo: {
    model: 'mimo-v2.5',
    baseUrl: 'https://token-plan-ams.xiaomimimo.com/v1',
    apiKeyEnv: ['XIAOMI_API_KEY', 'XIAOMIMIMO_API_KEY'],
  },
  deepseek: {
    model: 'deepseek-chat',
    baseUrl: 'https://api.deepseek.com/v1',
    apiKeyEnv: ['DEEPSEEK_API_KEY'],
  },
  cometapi: {
    model: 'gpt-4o-mini',
    baseUrl: 'https://api.cometapi.com/v1',
    apiKeyEnv: ['COMETAPI_API_KEY'],
  },
};

export function normalizeProvider(provider) {
  return typeof provider === 'string' ? provider.trim().toLowerCase() : '';
}

export function resolveProviderSelection({ explicitProvider, configuredProvider, envSources = [], fallbackProvider }) {
  const explicit = normalizeProvider(explicitProvider);
  if (explicit) {
    return explicit;
  }

  const configured = normalizeProvider(configuredProvider);
  if (configured) {
    return configured;
  }

  const inferred = inferProviderFromApiKey(envSources);
  if (inferred) {
    return inferred;
  }

  return normalizeProvider(fallbackProvider);
}

export function defaultLlmModelForProvider(provider) {
  return PROVIDER_DEFAULTS[normalizeProvider(provider)]?.model ?? 'gpt-4o-mini';
}

export function defaultLlmBaseUrlForProvider(provider) {
  return PROVIDER_DEFAULTS[normalizeProvider(provider)]?.baseUrl ?? 'https://api.openai.com/v1';
}

export function resolveProviderApiKey(provider, envSources = [], options = {}) {
  const names = providerApiKeyEnvNames(provider, options);
  for (const name of names) {
    const value = firstEnvValue(envSources, name);
    if (value) {
      return value;
    }
  }
  return '';
}

export function providerApiKeyEnvNames(provider, options = {}) {
  const allowGenericApiKey = options.allowGenericApiKey ?? true;
  const providerNames = PROVIDER_DEFAULTS[normalizeProvider(provider)]?.apiKeyEnv ?? [];
  return allowGenericApiKey ? [...providerNames, 'LLM_API_KEY'] : providerNames;
}

function inferProviderFromApiKey(envSources) {
  const candidates = ['openrouter', 'openai', 'xiaomimimo', 'deepseek', 'cometapi'];
  return candidates.find((provider) => {
    const providerOnlyNames = PROVIDER_DEFAULTS[provider].apiKeyEnv;
    return providerOnlyNames.some((name) => Boolean(firstEnvValue(envSources, name)));
  }) ?? '';
}

function firstEnvValue(envSources, name) {
  for (const source of envSources) {
    const value = source?.[name];
    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim();
    }
  }
  return '';
}
