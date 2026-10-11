import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import { UnauthorizedException, type ExecutionContext } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Request } from 'express';
import { DecisionAuthService } from './decision-auth.service';
import { decisionAuthRequest } from './decision-auth.guard';
import { GoalLaunchDecisionAuthGuard } from './goal-launch-decision-auth.guard';

const path = '/api/hitl/goal-launch/decision';
function context(request: Request, type = 'http'): ExecutionContext {
  return { getType: () => type, switchToHttp: () => ({ getRequest: () => request }) } as unknown as ExecutionContext;
}
function fixture() {
  let now = 1000; const secret = 'a'.repeat(64);
  const auth = new DecisionAuthService({ PORT: '3316', KALIO_CONTROL_PLANE_TOKEN: secret }, () => now);
  const bootstrap = { method: 'POST', path: '/api/decision/auth', socket: { remoteAddress: '127.0.0.1' },
    headers: { host: 'localhost:5288', origin: 'http://localhost:5288', 'content-type': 'application/json' } } as unknown as Request;
  const token = auth.createSession(decisionAuthRequest(bootstrap));
  const request = { ...bootstrap, method: 'PUT', path, headers: { ...bootstrap.headers,
    cookie: auth.cookie(decisionAuthRequest(bootstrap), token).split(';')[0] } } as Request;
  return { auth, request, guard: new GoalLaunchDecisionAuthGuard(auth), secret, expire: () => { now += 3_600_000; } };
}
function denied(guard: GoalLaunchDecisionAuthGuard, ctx: ExecutionContext): void {
  let caught: unknown;
  try { guard.canActivate(ctx); } catch (error) { caught = error; }
  expect(caught).toBeInstanceOf(UnauthorizedException);
  expect((caught as UnauthorizedException).getResponse()).toEqual({ code: 'GOAL_LAUNCH_DECISION_AUTH_REQUIRED' });
}

describe('GoalLaunchDecisionAuthGuard (real server-issued browser capability)', () => {
  it('accepts exact HTTP PUT with bootstrapped cookie', () => {
    const f = fixture(); expect(f.guard.canActivate(context(f.request))).toBe(true);
  });
  it('resolves injectable guard without opening a server', async () => {
    const f = fixture(); const module = await Test.createTestingModule({ providers: [GoalLaunchDecisionAuthGuard,
      { provide: DecisionAuthService, useValue: f.auth }] }).compile();
    try { expect(module.get(GoalLaunchDecisionAuthGuard).canActivate(context(f.request))).toBe(true); }
    finally { await module.close(); }
  });
  it.each([`${path}/`, `${path}/extra`, '/api/hitl/config', '/api/hitl/goal-launch', '/api/hitl/goal-launch/Decision', '/api/hitl/goal-launch/%64ecision'])('rejects nonliteral path %s', invalid => {
    const f = fixture(); denied(f.guard, context({ ...f.request, path: invalid } as Request));
  });
  it.each(['GET', 'POST', 'PATCH'])('rejects method %s', method => {
    const f = fixture(); denied(f.guard, context({ ...f.request, method } as Request));
  });
  it.each([undefined, 'text/plain', 'application/json; charset=latin1'])('rejects content type %s', value => {
    const f = fixture(); f.request.headers['content-type'] = value; denied(f.guard, context(f.request));
  });
  it.each([undefined, 'null', 'https://evil.example', 'http://localhost:5188'])('rejects Origin %s', value => {
    const f = fixture(); f.request.headers.origin = value; denied(f.guard, context(f.request));
  });
  it.each([undefined, 'localhost:3316', 'evil.example:5288'])('rejects Host %s', value => {
    const f = fixture(); f.request.headers.host = value; denied(f.guard, context(f.request));
  });
  it('rejects remote raw peer despite a spoofed Express IP/forwarded header', () => {
    const f = fixture(); Object.assign(f.request.socket, { remoteAddress: '10.0.0.2' });
    Object.assign(f.request, { ip: '127.0.0.1' }); f.request.headers['x-forwarded-for'] = '127.0.0.1';
    denied(f.guard, context(f.request));
  });
  it('rejects expired and missing cookies', () => {
    const f = fixture(); f.expire(); denied(f.guard, context(f.request));
    delete f.request.headers.cookie; denied(f.guard, context(f.request));
  });
  it('rejects valid env bearer even with valid browser cookie', () => {
    const f = fixture(); f.request.headers.authorization = `Bearer ${f.secret}`;
    expect(f.auth.isAuthorized(decisionAuthRequest(f.request))).toBe(true);
    denied(f.guard, context(f.request));
  });
  it.each(['ws', 'rpc'])('rejects %s without reading HTTP data', type => {
    const f = fixture(); const ctx = { getType: () => type,
      switchToHttp: () => { throw new Error('HTTP must not be accessed'); } } as unknown as ExecutionContext;
    denied(f.guard, ctx);
  });
});
