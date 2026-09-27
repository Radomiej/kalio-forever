import { getApiBaseUrl } from './apiClient';
import { isTauri } from '@tauri-apps/api/core';
import { getControlPlaneToken, isControlPlaneRequest, resolveApiRequestUrl } from './controlPlaneAuth';

export async function controlPlaneFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const apiBaseUrl = getApiBaseUrl();
  const requestUrl = resolveApiRequestUrl(input, apiBaseUrl);
  const headers = new Headers(input instanceof Request ? input.headers : undefined);
  const credentials = isTauri() ? 'include' : undefined;
  new Headers(init?.headers).forEach((value, key) => headers.set(key, value));

  if (isControlPlaneRequest(requestUrl, apiBaseUrl)) {
    const token = await getControlPlaneToken();
    if (token) headers.set('Authorization', `Bearer ${token}`);
  }

  if (input instanceof Request) {
    return fetch(new Request(input, {
      ...init,
      headers,
      ...(credentials ? { credentials } : {}),
    }));
  }
  const apiBase = new URL(apiBaseUrl);
  const requestTarget = typeof input === 'string'
    && input.startsWith('/')
    && apiBase.origin === globalThis.location?.origin
    && apiBase.pathname === '/'
    ? input
    : requestUrl.toString();
  return fetch(requestTarget, {
    ...init,
    headers,
    ...(credentials ? { credentials } : {}),
  });
}
