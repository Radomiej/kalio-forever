export interface KalioRuntimeConfig {
  apiUrl?: string;
  wsUrl?: string;
}

declare global {
  interface Window {
    __KALIO_RUNTIME_CONFIG__?: KalioRuntimeConfig;
  }
}

function trimUrl(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function readRuntimeConfig(): KalioRuntimeConfig | null {
  if (typeof window === 'undefined') {
    return null;
  }

  const runtimeConfig = window.__KALIO_RUNTIME_CONFIG__;
  if (!runtimeConfig || typeof runtimeConfig !== 'object') {
    return null;
  }

  const apiUrl = trimUrl(runtimeConfig.apiUrl);
  const wsUrl = trimUrl(runtimeConfig.wsUrl);
  if (!apiUrl && !wsUrl) {
    return null;
  }

  return {
    ...(apiUrl ? { apiUrl } : {}),
    ...(wsUrl ? { wsUrl } : {}),
  };
}
