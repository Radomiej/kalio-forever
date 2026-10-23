import { describe, expect, it } from 'vitest';
import type { ExecutionContext } from '@nestjs/common';
import { DecisionAuthService } from '../../common/decision-auth.service';
import { ProjectContextSettingsGuard } from './project-context-settings.guard';

const token = 'ab'.repeat(32);
function context(method: string, headers: Record<string, string>, path = '/api/memory/project-context/settings', peer = '127.0.0.1'): ExecutionContext {
  return { getType: () => 'http', switchToHttp: () => ({ getRequest: () => ({ method, path, headers, socket: { remoteAddress: peer } }) }) } as unknown as ExecutionContext;
}
describe('strict project context settings authorization', () => {
  const auth = new DecisionAuthService({ PORT: '3316', KALIO_CONTROL_PLANE_TOKEN: token });
  const guard = new ProjectContextSettingsGuard(auth);
  const headers = { host: 'localhost:3316', authorization: `Bearer ${token}`, 'content-type': 'application/json' };
  it.each(['GET', 'PUT'])('accepts authorized %s only on the exact route', method => {
    expect(guard.canActivate(context(method, headers))).toBe(true);
    expect(() => guard.canActivate(context(method, { host: 'localhost:3316' }))).toThrow();
    expect(() => guard.canActivate(context(method, headers, '/api/memory/embedding'))).toThrow();
    expect(() => guard.canActivate(context(method, headers, undefined, '10.0.0.2'))).toThrow();
  });
  it('rejects unsupported methods and non-JSON writes', () => {
    expect(() => guard.canActivate(context('POST', headers))).toThrow();
    expect(() => guard.canActivate(context('PUT', { ...headers, 'content-type': 'text/plain' }))).toThrow();
  });
  it('requires matching origin for browser cookie GET and PUT', () => {
    const browser = { host: 'localhost:5288', origin: 'http://localhost:5288', 'content-type': 'application/json' };
    const cookie = auth.createSession({ ip: '127.0.0.1', method: 'POST', headers: browser });
    const issued = { ...browser, cookie: `${auth.cookieName}=${cookie}` };
    for (const method of ['GET', 'PUT']) {
      expect(guard.canActivate(context(method, issued))).toBe(true);
      expect(() => guard.canActivate(context(method, { ...issued, origin: 'https://evil.example' }))).toThrow();
      expect(() => guard.canActivate(context(method, { ...issued, origin: '' }))).toThrow();
    }
  });
});
