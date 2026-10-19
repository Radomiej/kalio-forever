/** Exercise the browser-cookie lane against a real packaged backend, not a mocked service. */
export async function smokeDecisionSettings(origin) {
  const request = (path, init = {}) => fetch(origin + path, {
    ...init, signal: AbortSignal.timeout(5000),
  });
  const bootstrap = await request('/api/decision/auth', {
    method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: '{}',
  });
  if (bootstrap.status !== 204) throw new Error(`Packaged settings auth: HTTP ${bootstrap.status}`);
  const cookie = bootstrap.headers.get('set-cookie');
  if (!cookie || !/HttpOnly/i.test(cookie) || !/SameSite=Strict/i.test(cookie)) {
    throw new Error('Packaged settings auth did not issue a protected browser cookie');
  }
  const headers = { Origin: origin, Cookie: cookie.split(';')[0] };
  let config;
  for (const path of ['/api/decision/config', '/api/hitl/config', '/api/runtime/default-profile', '/api/memory/project-context/settings']) {
    const response = await request(path, { headers });
    if (!response.ok) throw new Error(`Packaged settings ${path}: HTTP ${response.status}`);
    if (path === '/api/decision/config') config = await response.json();
  }
  const saved = await request('/api/decision/config', {
    method: 'PUT', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(config),
  });
  if (!saved.ok) throw new Error(`Packaged settings save: HTTP ${saved.status}`);
  const denied = await request('/api/decision/config', { headers: { ...headers, Origin: 'http://attacker.invalid' } });
  if (denied.status !== 403) throw new Error('Packaged settings accepted a foreign browser origin');
}
