import type { DecisionSettings, DecisionSettingsPort } from '@kalio/types';
import { createDecisionProtectedFetcher } from './decision-protected-fetch';

type SettingsPath = '/api/decision/config' | '/api/hitl/config' | '/api/runtime/default-profile';
type Fetcher = typeof fetch;

export class DecisionSettingsTransportError extends Error {
  constructor(readonly status: number, readonly code: string) {
    super(`Decision settings unavailable (${code}). Check local access and browser cookies.`);
  }
}

async function check(response: Response): Promise<Response> {
  if (response.ok) return response;
  let code = 'DECISION_REQUEST_FAILED';
  try {
    const body: unknown = await response.json();
    if (body && typeof body === 'object' && 'code' in body && typeof body.code === 'string') code = body.code;
  } catch { code = 'DECISION_REQUEST_FAILED'; }
  throw new DecisionSettingsTransportError(response.status, code);
}

export function createDecisionSettingsRequest(rawFetcher: Fetcher = (...args) => fetch(...args)) {
  const fetcher = createDecisionProtectedFetcher(rawFetcher);
  let bootstrap: Promise<void> | undefined;
  function authenticate(): Promise<void> {
    if (!bootstrap) {
      bootstrap = fetcher('/api/decision/auth', {
        method: 'POST', credentials: 'same-origin', redirect: 'error', cache: 'no-store',
        headers: { 'Content-Type': 'application/json' }, body: '{}',
      }).then(check).then(() => undefined).finally(() => { bootstrap = undefined; });
    }
    return bootstrap;
  }
  return async function request(path: SettingsPath, init: RequestInit = {}): Promise<Response> {
    if (!['/api/decision/config', '/api/hitl/config', '/api/runtime/default-profile'].includes(path)) throw new Error('Unsupported settings route.');
    const method = init.method ?? 'GET';
    if (method !== 'GET' && method !== 'PUT') throw new Error('Unsupported settings method.');
    const headers = new Headers(init.headers);
    headers.delete('Authorization');
    if (method === 'PUT') headers.set('Content-Type', 'application/json');
    const options: RequestInit = { ...init, method, headers, credentials: 'same-origin', redirect: 'error', cache: 'no-store' };
    const response = await fetcher(path, options);
    // Only an explicit auth rejection is safe to replay; network/5xx failures may follow a completed PUT.
    if (response.status !== 401) return check(response);
    await authenticate();
    return check(await fetcher(path, options));
  };
}

export function createDecisionSettingsTransport(fetcher?: Fetcher): Pick<DecisionSettingsPort, 'getConfig' | 'updateConfig'> {
  const request = createDecisionSettingsRequest(fetcher);
  return {
    async getConfig(): Promise<DecisionSettings> { return (await request('/api/decision/config')).json() as Promise<DecisionSettings>; },
    async updateConfig(config: DecisionSettings): Promise<DecisionSettings> {
      return (await request('/api/decision/config', { method: 'PUT', body: JSON.stringify(config) })).json() as Promise<DecisionSettings>;
    },
  };
}

export const decisionSettingsRequest = createDecisionSettingsRequest();
export const decisionSettingsTransport = createDecisionSettingsTransport();
