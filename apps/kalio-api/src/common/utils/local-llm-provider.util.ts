// Keep this logic in sync with apps/kalio-web/src/features/settings/llm-provider-settings.ts
// until it can be extracted into a shared runtime-safe package.
const LOCAL_HOSTNAMES = new Set(['localhost', '127.0.0.1', '0.0.0.0', '::1', 'host.docker.internal']);

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

export function isLocalLlmProvider(provider: string, baseUrl?: string): boolean {
  return provider === 'ollama' || provider === 'bitnet' || (provider === 'custom' && isLocalBaseUrl(baseUrl));
}