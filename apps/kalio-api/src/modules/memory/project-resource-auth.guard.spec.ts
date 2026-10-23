import { describe, expect, it } from 'vitest';
import type { ExecutionContext } from '@nestjs/common';
import { DecisionAuthService } from '../../common/decision-auth.service';
import { ProjectResourceAuthGuard } from './project-resource-auth.guard';

const token = 'ab'.repeat(32);
function context(method: string, path: string, headers: Record<string, string>, peer = '127.0.0.1'): ExecutionContext {
  return { getType: () => 'http', switchToHttp: () => ({ getRequest: () => ({ method, path, headers, socket: { remoteAddress: peer } }) }) } as unknown as ExecutionContext;
}
describe('project resource capability boundary', () => {
  const auth = new DecisionAuthService({ PORT: '3316', KALIO_CONTROL_PLANE_TOKEN: token });
  const guard = new ProjectResourceAuthGuard(auth);
  const headers = { host: 'localhost:3316', authorization: `Bearer ${token}`, 'content-type': 'application/json' };
  it('authorizes exact local JSON search/index and status routes', () => {
    expect(guard.canActivate(context('PUT', '/api/memory/project-resources/p/search', headers))).toBe(true);
    expect(guard.canActivate(context('PUT', '/api/memory/project-resources/p/index', headers))).toBe(true);
    expect(guard.canActivate(context('GET', '/api/memory/project-resources/p/status', headers))).toBe(true);
  });
  it('rejects missing capability, remote peer, foreign origin and other endpoints', () => {
    expect(() => guard.canActivate(context('PUT', '/api/memory/project-resources/p/search', { host: 'localhost:3316' }))).toThrow();
    expect(() => guard.canActivate(context('PUT', '/api/memory/project-resources/p/search', headers, '10.0.0.2'))).toThrow();
    expect(() => guard.canActivate(context('PUT', '/api/memory/project-resources/p/search', { ...headers, origin: 'https://evil.example' }))).toThrow();
    expect(() => guard.canActivate(context('PUT', '/api/memory/embedding', headers))).toThrow();
  });
  it('requires JSON and does not accept unapproved methods', () => {
    expect(() => guard.canActivate(context('PUT', '/api/memory/project-resources/p/index', { ...headers, 'content-type': 'text/plain' }))).toThrow();
    expect(() => guard.canActivate(context('POST', '/api/memory/project-resources/p/index', headers))).toThrow();
  });
  it('accepts issued browser cookie only with matching origin and host', () => {
    const browser = { host: 'localhost:5288', origin: 'http://localhost:5288', 'content-type': 'application/json' };
    const cookie = auth.createSession({ ip: '127.0.0.1', method: 'POST', headers: browser });
    const issued = { ...browser, cookie: `${auth.cookieName}=${cookie}` };
    expect(guard.canActivate(context('PUT', '/api/memory/project-resources/p/search', issued))).toBe(true);
    expect(() => guard.canActivate(context('PUT', '/api/memory/project-resources/p/search', { ...issued, host: '127.0.0.1:5288' }))).toThrow();
  });
});
