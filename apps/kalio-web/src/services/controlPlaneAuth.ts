import { invoke, isTauri } from '@tauri-apps/api/core';

const CONTROL_PLANE_PREFIXES = [
  '/api/agent-flows/runs',
  '/api/allowed-paths',
  '/api/architecture-registry',
  '/api/architecture-runs',
  '/api/credentials',
  '/api/decision',
  '/api/hitl',
  '/api/llm',
  '/api/mcp/servers',
  '/api/mcp/tools',
  '/api/security/policy',
  '/api/sessions',
  '/api/tools',
] as const;

let tokenRequest: Promise<string> | undefined;

export async function getControlPlaneToken(): Promise<string | undefined> {
  if (!isTauri()) return undefined;
  tokenRequest ??= invoke<string>('get_control_plane_token');
  try {
    const token = await tokenRequest;
    if (!/^[a-f0-9]{64}$/i.test(token)) {
      throw new Error('The desktop control-plane credential is invalid.');
    }
    return token;
  } catch (error) {
    tokenRequest = undefined;
    throw error;
  }
}

export function isControlPlaneRequest(requestUrl: URL, apiBaseUrl: string): boolean {
  const apiBase = new URL(apiBaseUrl);
  if (requestUrl.origin !== apiBase.origin) return false;

  const basePath = apiBase.pathname.replace(/\/+$/, '');
  const requestPath = basePath && requestUrl.pathname.startsWith(`${basePath}/`)
    ? requestUrl.pathname.slice(basePath.length)
    : requestUrl.pathname;

  return CONTROL_PLANE_PREFIXES.some(
    (prefix) => requestPath === prefix || requestPath.startsWith(`${prefix}/`),
  );
}

export function resolveApiRequestUrl(input: RequestInfo | URL, apiBaseUrl: string): URL {
  const inputUrl = input instanceof Request ? input.url : input.toString();
  const apiBase = new URL(apiBaseUrl);
  if (inputUrl.startsWith('/api/')) {
    const basePath = apiBase.pathname.replace(/\/+$/, '');
    return new URL(`${basePath}${inputUrl}`, apiBase.origin);
  }
  return new URL(inputUrl, apiBase);
}
