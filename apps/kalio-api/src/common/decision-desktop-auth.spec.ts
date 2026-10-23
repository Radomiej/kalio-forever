import { describe, expect, it } from 'vitest';
import { DecisionAuthService, type DecisionAuthRequest } from './decision-auth.service';

const request: DecisionAuthRequest = { ip: '127.0.0.1', method: 'POST', headers: {
  host: '127.0.0.1:4516', origin: 'http://tauri.localhost', 'content-type': 'application/json',
} };
const header = 'x-kalio-decision-session';

describe('explicit desktop decision capability', () => {
  it.each(['http://tauri.localhost', 'tauri://localhost'])('bootstraps, reads, writes and expires for %s', origin => {
    let now = 1000;
    const auth = new DecisionAuthService({ PORT: '4516', KALIO_DECISION_DESKTOP_AUTH: 'true' }, () => now);
    const bootstrap = { ...request, headers: { ...request.headers, origin } };
    const token = auth.createDesktopSession(bootstrap);
    const put = { ...bootstrap, method: 'PUT', headers: { ...bootstrap.headers, [header]: token } };
    expect(token).toMatch(/^[a-f0-9]{64}$/);
    expect(auth.isAuthorized({ ...put, method: 'GET' })).toBe(true);
    expect(auth.isBrowserDecisionAuthorized(put)).toBe(true);
    expect(() => auth.requireBrowserOrigin(put)).not.toThrow();
    now += 3_600_000;
    expect(auth.isAuthorized(put)).toBe(false);
    expect(auth.createDesktopSession(bootstrap)).not.toBe(token);
  });

  it('fails closed unless explicitly enabled on the desktop listener', () => {
    for (const env of [{ PORT: '4516' }, { PORT: '4016', KALIO_DECISION_DESKTOP_AUTH: 'true' }]) {
      expect(() => new DecisionAuthService(env).createDesktopSession(request)).toThrow();
    }
  });

  it('never accepts desktop capability as a browser cookie or control-plane bearer', () => {
    const auth = new DecisionAuthService({ PORT: '4516', KALIO_DECISION_DESKTOP_AUTH: 'true' });
    const token = auth.createDesktopSession(request);
    const put = { ...request, method: 'PUT', headers: { ...request.headers, [header]: token } };
    const variants = [
      { ...put, ip: '10.0.0.1' },
      { ...put, method: 'POST' },
      ...['http://localhost:4516', 'http://tauri.localhost.evil', 'null', 'https://evil.test', 'tauri://evil'].map(origin => ({ ...put, headers: { ...put.headers, origin } })),
      ...['localhost:4516', '127.0.0.1:4016', 'evil.test:4516'].map(host => ({ ...put, headers: { ...put.headers, host } })),
      ...[{ cookie: 'arbitrary=value' }, { authorization: `Bearer ${token}` }, { 'content-type': 'text/plain' }, { [header]: ['duplicate', token] }].map(headers => ({ ...put, headers: { ...put.headers, ...headers } })),
    ];
    for (const invalid of variants) expect(auth.isBrowserDecisionAuthorized(invalid)).toBe(false);
    expect(auth.isAuthorized({ ...put, headers: { ...put.headers, origin: 'tauri://localhost' } })).toBe(false);
    expect(() => auth.createSession(request)).toThrow();
    const browser = new DecisionAuthService({ PORT: '4016', KALIO_SERVE_UI: 'true' });
    expect(browser.isAuthorized({ ...put, headers: { ...put.headers, host: '127.0.0.1:4016', origin: 'http://127.0.0.1:4016' } })).toBe(false);
    expect(() => browser.createSession({ ...request, headers: { ...put.headers, host: '127.0.0.1:4016', origin: 'http://127.0.0.1:4016' } })).toThrow();
  });
});
