// CLI bearer alternative already supported by DecisionAuthService. Never bootstrap or persist a browser cookie.
export class HitlAuthorizationConfigurationError extends Error {
  constructor() {
    super('HITL authorization is not configured: set KALIO_CONTROL_PLANE_TOKEN in both the API and readiness process; no request was sent.');
  }
}

export async function fetchProtectedHitlConfig({ apiBase, fetchJson = fetch, env = process.env }) {
  let api;
  try { api = new URL(apiBase); } catch { throw new Error('Scoped HITL read requires a loopback API.'); }
  if (api.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(api.hostname)
    || api.username || api.password || api.search || api.hash || api.pathname !== '/api') {
    throw new Error('Scoped HITL read requires a loopback API.');
  }
  const token = env.KALIO_CONTROL_PLANE_TOKEN;
  if (typeof token !== 'string' || !/^[a-f0-9]{64}$/i.test(token)) {
    throw new HitlAuthorizationConfigurationError();
  }
  const url = `${api.origin}/api/hitl/config`;
  const response = await fetchJson(url, {
    method: 'GET', redirect: 'error', signal: AbortSignal.timeout(45000),
    headers: { Authorization: `Bearer ${token}` },
  });
  if (response.redirected || (response.status >= 300 && response.status < 400)
    || (response.url && response.url !== url)) {
    throw new Error('Scoped HITL read rejected a redirected or foreign response.');
  }
  return response;
}
