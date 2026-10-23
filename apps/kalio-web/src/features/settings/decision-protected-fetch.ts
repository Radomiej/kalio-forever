const DESKTOP_HEADER = 'x-kalio-decision-session';
const BACKEND = 'http://127.0.0.1:4516';

function desktopLocation(): boolean {
  const location = globalThis.location;
  return !!location && (location.origin === 'http://tauri.localhost'
    || location.protocol === 'tauri:' && location.hostname === 'localhost' && !location.port);
}

/** Scoped desktop capability stays in this closure, never cookies or persistent storage. */
export function createDecisionProtectedFetcher(fetcher: typeof fetch): typeof fetch {
  let token = '';
  return async (input, init = {}) => {
    if (!desktopLocation()) return fetcher(input, init);
    if (typeof input !== 'string' || !/^\/api\/(?:decision\/(?:auth|config)|hitl\/config|runtime\/default-profile|projects|memory\/project-context\/settings|memory\/project-resources\/[A-Za-z0-9_-]{1,128}\/(?:status|index|search))$/.test(input)) {
      throw new Error('Unsupported desktop protected route.');
    }
    const bootstrap = input === '/api/decision/auth';
    const method = init.method ?? 'GET';
    if (bootstrap ? method !== 'POST' : !['GET', 'PUT'].includes(method)) throw new Error('Unsupported desktop protected method.');
    const headers = new Headers(init.headers);
    headers.delete('Authorization');
    headers.delete('Cookie');
    headers.delete(DESKTOP_HEADER);
    if (!bootstrap) headers.set(DESKTOP_HEADER, token);
    const response = await fetcher(BACKEND + (bootstrap ? '/api/decision/desktop-auth' : input), {
      ...init, headers, credentials: 'omit', redirect: 'error', cache: 'no-store',
    });
    if (bootstrap && response.ok) {
      const body: unknown = await response.clone().json();
      if (!body || typeof body !== 'object' || !('token' in body) || typeof body.token !== 'string'
        || !/^[a-f0-9]{64}$/i.test(body.token)) throw new Error('Invalid desktop decision capability.');
      token = body.token;
    }
    return response;
  };
}
