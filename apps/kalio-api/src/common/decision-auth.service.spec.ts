import { describe, expect, it } from 'vitest';
import { ServiceUnavailableException } from '@nestjs/common';
import { DecisionAuthService, type DecisionAuthRequest } from './decision-auth.service';

const request: DecisionAuthRequest = {
  ip: '127.0.0.1', method: 'POST',
  headers: { host: 'localhost:5288', origin: 'http://localhost:5288', 'content-type': 'application/json' },
};

describe('browser-only decision authorization prerequisite', () => {
  function fixture() {
    let now = 1000;
    const secret = 'a'.repeat(64);
    const auth = new DecisionAuthService({ PORT: '3316', KALIO_CONTROL_PLANE_TOKEN: secret }, () => now);
    const cookie = `${auth.cookieName}=${auth.createSession(request)}`;
    const put: DecisionAuthRequest = { ...request, method: 'PUT', headers: { ...request.headers, cookie } };
    return { auth, put, cookie, secret, expire: () => { now += 3_600_000; } };
  }
  it('accepts only a real unexpired browser cookie PUT with exact origin, host, peer and JSON', () => {
    const f = fixture();
    expect(f.auth.isBrowserDecisionAuthorized(f.put)).toBe(true);
    expect(f.auth.isBrowserDecisionAuthorized({ ...f.put, ip: '::ffff:127.0.0.1', headers: { ...f.put.headers, 'content-type': 'application/json; charset=UTF-8' } })).toBe(true);
    f.expire(); expect(f.auth.isBrowserDecisionAuthorized(f.put)).toBe(false);
  });
  it.each(['GET', 'POST', 'PATCH', 'put'])('rejects method %s', method => {
    const f = fixture(); expect(f.auth.isBrowserDecisionAuthorized({ ...f.put, method })).toBe(false);
  });
  it.each([undefined, 'text/plain', 'application/json; charset=latin1', 'application/json; boundary=x', ['application/json']])('rejects content-type %s', contentType => {
    const f = fixture(); expect(f.auth.isBrowserDecisionAuthorized({ ...f.put, headers: { ...f.put.headers, 'content-type': contentType } })).toBe(false);
  });
  it.each([undefined, '', 'other=value', 'foreign'])('rejects missing or foreign cookie %s', value => {
    const f = fixture(); const cookie = value === 'foreign' ? `${f.auth.cookieName}=${'b'.repeat(64)}` : value;
    expect(f.auth.isBrowserDecisionAuthorized({ ...f.put, headers: { ...f.put.headers, cookie } })).toBe(false);
  });
  it('rejects duplicate cookies and cookies issued by another instance or origin', () => {
    const f = fixture();
    expect(f.auth.isBrowserDecisionAuthorized({ ...f.put, headers: { ...f.put.headers, cookie: `${f.cookie}; ${f.cookie}` } })).toBe(false);
    expect(new DecisionAuthService({ PORT: '3316' }).isBrowserDecisionAuthorized(f.put)).toBe(false);
    expect(f.auth.isBrowserDecisionAuthorized({ ...f.put, headers: { ...f.put.headers, host: '127.0.0.1:5288', origin: 'http://127.0.0.1:5288' } })).toBe(false);
  });
  it.each([true, false])('rejects valid env bearer even with browser cookie=%s, preserving generic authorization', withCookie => {
    const f = fixture(); const headers = { ...f.put.headers, cookie: withCookie ? f.cookie : undefined, authorization: `Bearer ${f.secret}` };
    expect(f.auth.isAuthorized({ ...f.put, headers })).toBe(true);
    expect(f.auth.isBrowserDecisionAuthorized({ ...f.put, headers })).toBe(false);
  });
  it.each(['', 'Bearer invalid', ['Bearer value']])('rejects any present authorization header %s', authorization => {
    const f = fixture(); expect(f.auth.isBrowserDecisionAuthorized({ ...f.put, headers: { ...f.put.headers, authorization } })).toBe(false);
  });
  it.each([undefined, 'null', 'https://evil.example', 'http://localhost:5188', ['http://localhost:5288']])('rejects missing/foreign Origin %s', origin => {
    const f = fixture(); expect(f.auth.isBrowserDecisionAuthorized({ ...f.put, headers: { ...f.put.headers, origin, 'sec-fetch-site': 'same-origin' } })).toBe(false);
  });
  it.each([undefined, 'evil.example:5288', 'localhost:3316', ['localhost:5288']])('rejects Host %s', host => {
    const f = fixture(); expect(f.auth.isBrowserDecisionAuthorized({ ...f.put, headers: { ...f.put.headers, host } })).toBe(false);
  });
  it.each([undefined, '10.0.0.2', '127.0.0.2'])('rejects non-loopback raw peer %s despite forwarded headers', ip => {
    const f = fixture(); expect(f.auth.isBrowserDecisionAuthorized({ ...f.put, ip, headers: {
      ...f.put.headers, 'x-forwarded-for': '127.0.0.1', 'x-forwarded-host': 'localhost:5288',
    } })).toBe(false);
  });
  it('fails closed for invalid origin policy', () => {
    const f = fixture();
    expect(new DecisionAuthService({ PORT: '3316', KALIO_DECISION_FRONTEND_ORIGINS: '*' }).isBrowserDecisionAuthorized(f.put)).toBe(false);
  });
});

describe('Decision settings local authorization', () => {
  it('bootstraps an HttpOnly capability only for the approved loopback origin', () => {
    const auth = new DecisionAuthService({ PORT: '3316' });
    const token = auth.createSession(request);
    expect(token).toMatch(/^[a-f0-9]{64}$/);
    expect(auth.isAuthorized({ ...request, method: 'PUT', headers: {
      ...request.headers, cookie: `${auth.cookieName}=${token}`,
    } })).toBe(true);
  });

  it.each([
    { ...request, ip: '10.0.0.2' },
    { ...request, headers: { ...request.headers, origin: 'https://attacker.example' } },
    { ...request, headers: { ...request.headers, origin: 'http://localhost:9999' } },
    { ...request, headers: { ...request.headers, host: 'attacker.example:5288' } },
    { ...request, headers: { ...request.headers, host: 'localhost:3316' } },
    { ...request, headers: { ...request.headers, origin: 'http://localhost:5188' } },
    { ...request, headers: { ...request.headers, origin: 'http://localhost:6188' } },
    { ...request, headers: { ...request.headers, origin: 'null' } },
    { ...request, headers: { ...request.headers, origin: ['http://localhost:5288', 'https://evil.example'] } },
    { ...request, headers: { host: request.headers.host, 'content-type': 'application/json' } },
    { ...request, headers: { ...request.headers, 'content-type': 'text/plain' } },
  ])('refuses unauthorized bootstrap without changing configuration', (invalid) => {
    expect(() => new DecisionAuthService({ PORT: '3316' }).createSession(invalid)).toThrow();
  });

  it('does not trust forwarded IP headers or accept a cookie from another instance', () => {
    const auth = new DecisionAuthService({ PORT: '3316' });
    const token = auth.createSession(request);
    const authenticated = { ...request, method: 'PUT', headers: { ...request.headers, cookie: `${auth.cookieName}=${token}` } };
    expect(auth.isAuthorized({ ...authenticated, ip: '10.0.0.2', headers: {
      ...authenticated.headers, 'x-forwarded-for': '127.0.0.1',
    } })).toBe(false);
    expect(new DecisionAuthService({ PORT: '3316' }).isAuthorized(authenticated)).toBe(false);
  });

  it('expires sessions server-side; GET without Origin requires same-origin metadata and exact Host', () => {
    let now = 1000;
    const auth = new DecisionAuthService({ PORT: '3316' }, () => now);
    const token = auth.createSession(request);
    const headers = { host: request.headers.host, cookie: `${auth.cookieName}=${token}`, 'sec-fetch-site': 'same-origin' };
    expect(auth.isAuthorized({ ip: request.ip, method: 'GET', headers })).toBe(true);
    expect(auth.isAuthorized({ ip: request.ip, method: 'GET', headers: { ...headers, 'sec-fetch-site': 'same-site' } })).toBe(false);
    expect(auth.isAuthorized({ ip: request.ip, method: 'GET', headers: { ...headers, 'sec-fetch-site': undefined, referer: 'http://localhost:5288/' } })).toBe(false);
    now += 3_600_001;
    expect(auth.isAuthorized({ ip: request.ip, method: 'GET', headers })).toBe(false);
  });

  it('permits an explicitly configured random-port origin but never wildcard origins', () => {
    const configured = new DecisionAuthService({ PORT: '42001', KALIO_DECISION_FRONTEND_ORIGINS: 'http://localhost:42002' });
    expect(() => configured.createSession({ ...request, headers: {
      ...request.headers, host: 'localhost:42002', origin: 'http://localhost:42002',
    } })).not.toThrow();
    const wildcard = new DecisionAuthService({ PORT: '3316', KALIO_DECISION_FRONTEND_ORIGINS: '*' });
    expect(() => wildcard.createSession({ ...request, headers: { ...request.headers, origin: 'https://attacker.example' } })).toThrow();
  });

  it('does not infer random ports or accept a union of stack origins', () => {
    expect(() => new DecisionAuthService({ PORT: '42001' }).createSession(request)).toThrow(ServiceUnavailableException);
    expect(() => new DecisionAuthService({ PORT: '3316', KALIO_DECISION_FRONTEND_ORIGINS: 'http://localhost:5188,http://localhost:5288' }).createSession(request)).toThrow();
  });

  it('keeps bootstrap idempotent and uses host-only stack-specific HttpOnly cookies', () => {
    const auth = new DecisionAuthService({ PORT: '3316' }, () => 1000);
    const token = auth.createSession(request);
    expect(auth.createSession(request)).toBe(token);
    expect(auth.cookie(request, token)).toBe(`${auth.cookieName}=${token}; HttpOnly; SameSite=Strict; Path=/api; Max-Age=3600`);
    expect(new DecisionAuthService({ PORT: '3016' }).cookieName).not.toBe(auth.cookieName);
    expect(auth.isAuthorized({ ...request, ip: '::ffff:127.0.0.1', method: 'PUT', headers: { ...request.headers, cookie: `${auth.cookieName}=${token}` } })).toBe(true);
  });

  it.each(['', 'xyz', 'a'.repeat(63), 'a'.repeat(65)])('rejects malformed and duplicate cookie values %s', (value) => {
    const auth = new DecisionAuthService({ PORT: '3316' });
    const token = auth.createSession(request);
    const authorized = { ...request, method: 'PUT', headers: { ...request.headers, cookie: `${auth.cookieName}=${value}` } };
    expect(auth.isAuthorized(authorized)).toBe(false);
    expect(auth.isAuthorized({ ...authorized, headers: { ...authorized.headers, cookie: `${auth.cookieName}=${token}; ${auth.cookieName}=${token}` } })).toBe(false);
  });

  it('rejects CSRF on PUT even with a valid cookie; binds capability to origin', () => {
    const auth = new DecisionAuthService({ PORT: '3316' });
    const cookie = `${auth.cookieName}=${auth.createSession(request)}`;
    for (const origin of [undefined, 'null', 'http://localhost:5188', 'https://evil.example']) {
      expect(auth.isAuthorized({ ...request, method: 'PUT', headers: { ...request.headers, origin, cookie } })).toBe(false);
    }
    expect(auth.isAuthorized({ ...request, method: 'PUT', headers: { ...request.headers, host: '127.0.0.1:5288', origin: 'http://127.0.0.1:5288', cookie } })).toBe(false);
  });

  it('supports explicit env bearer without cookie fallback or remote access', () => {
    const secret = 'a'.repeat(64);
    const auth = new DecisionAuthService({ PORT: '3316', KALIO_CONTROL_PLANE_TOKEN: secret });
    const bearer = { ip: '127.0.0.1', method: 'GET', headers: { host: '127.0.0.1:3316', authorization: `Bearer ${secret}` } };
    expect(auth.isAuthorized(bearer)).toBe(true);
    expect(auth.isAuthorized({ ...bearer, ip: '10.0.0.2' })).toBe(false);
    expect(new DecisionAuthService({ PORT: '3316' }).isAuthorized(bearer)).toBe(false);
    const cookie = `${auth.cookieName}=${auth.createSession(request)}`;
    expect(auth.isAuthorized({ ...request, method: 'PUT', headers: { ...request.headers, cookie, authorization: 'Bearer invalid' } })).toBe(false);
    expect(() => new DecisionAuthService({ KALIO_CONTROL_PLANE_TOKEN: 'invalid' })).toThrow();
  });
});
