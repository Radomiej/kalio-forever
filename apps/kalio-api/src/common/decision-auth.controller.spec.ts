import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import { Test } from '@nestjs/testing';
import { ForbiddenException, UnauthorizedException, UnsupportedMediaTypeException, type ExecutionContext } from '@nestjs/common';
import type { Request, Response } from 'express';
import { DECISION_SETTINGS, type DecisionSettingsPort } from '@kalio/types';
import { DecisionAuthService } from './decision-auth.service';
import { DecisionAuthGuard, decisionAuthRequest } from './decision-auth.guard';
import { DecisionAuthController } from './decision-auth.controller';
import { DecisionSettingsController } from './decision-settings.controller';
import { HitlConfigController } from '../modules/hitl/hitl-config.controller';
import { DefaultExecutionProfileController } from '../modules/agent-runtime/default-execution-profile.controller';

const config = { provider: 'openrouter' as const, model: 'typesafe/jev-1.13', credentialId: null, endpoint: '' };
const rawRequest = (method = 'POST'): Request => ({
  method, path: '/api/decision/config', socket: { remoteAddress: '127.0.0.1' },
  headers: { host: 'localhost:5288', origin: 'http://localhost:5288', 'content-type': 'application/json' },
}) as unknown as Request;
const context = (request: Request): ExecutionContext => ({ getType: () => 'http', switchToHttp: () => ({ getRequest: () => request }) }) as unknown as ExecutionContext;

describe('Decision auth controller and scoped guard wiring', () => {
  it('protects both exact HITL config methods with the exported guard', () => {
    expect(Reflect.getMetadata('__guards__', HitlConfigController.prototype.getConfig)).toContain(DecisionAuthGuard);
    expect(Reflect.getMetadata('__guards__', HitlConfigController.prototype.updateConfig)).toContain(DecisionAuthGuard);
  });
  it('protects both exact default-profile methods without granting other runtime paths', () => {
    expect(Reflect.getMetadata('__guards__', DefaultExecutionProfileController.prototype.get)).toContain(DecisionAuthGuard);
    expect(Reflect.getMetadata('__guards__', DefaultExecutionProfileController.prototype.select)).toContain(DecisionAuthGuard);
  });
  it('resolves controllers and guard via Nest DI without listening; bootstrap has no settings/provider side effects', async () => {
    const auth = new DecisionAuthService({ PORT: '3316' });
    const settings = { getConfig: vi.fn().mockResolvedValue(config), updateConfig: vi.fn().mockResolvedValue(config), resolve: vi.fn() } satisfies DecisionSettingsPort;
    const module = await Test.createTestingModule({
      controllers: [DecisionAuthController, DecisionSettingsController],
      providers: [{ provide: DecisionAuthService, useValue: auth }, DecisionAuthGuard, { provide: DECISION_SETTINGS, useValue: settings }],
    }).compile();
    try {
      const setHeader = vi.fn();
      const response = { setHeader } as unknown as Response;
      const bootstrap = module.get(DecisionAuthController);
      bootstrap.bootstrap(rawRequest(), response, {});
      expect(setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store');
      const cookie = setHeader.mock.calls.find(([header]) => header === 'Set-Cookie')?.[1] as string;
      expect(cookie).toContain('HttpOnly; SameSite=Strict; Path=/api');
      expect(cookie).not.toContain('Domain=');
      expect(settings.getConfig).not.toHaveBeenCalled();
      expect(settings.updateConfig).not.toHaveBeenCalled();
      expect(settings.resolve).not.toHaveBeenCalled();
      const req = rawRequest('GET');
      req.headers.cookie = cookie.split(';')[0];
      expect(module.get(DecisionAuthGuard).canActivate(context(req))).toBe(true);
      expect(Reflect.getMetadata('__guards__', DecisionSettingsController)).toContain(DecisionAuthGuard);
      expect(await module.get(DecisionSettingsController).getConfig()).toEqual(config);
      expect(await module.get(DecisionSettingsController).updateConfig(config)).toEqual(config);
      expect(settings.updateConfig).toHaveBeenCalledTimes(1);
      expect(() => module.get(DecisionSettingsController).updateConfig({ ...config, apiKey: 'secret' })).toThrow();
      expect(settings.updateConfig).toHaveBeenCalledTimes(1);
      expect(() => bootstrap.bootstrap(rawRequest(), response, { token: 'injected' })).toThrow();
    } finally { await module.close(); }
  });

  it('rejects anonymous, CSRF, form writes, remote socket and unrelated routes before dispatch', () => {
    const auth = new DecisionAuthService({ PORT: '3316' });
    const guard = new DecisionAuthGuard(auth);
    const req = rawRequest('PUT');
    expect(() => guard.canActivate(context(req))).toThrow(UnauthorizedException);
    req.headers.cookie = `${auth.cookieName}=${auth.createSession(decisionAuthRequest(rawRequest()))}`;
    expect(guard.canActivate(context(req))).toBe(true);
    req.headers.origin = 'http://localhost:5188';
    expect(() => guard.canActivate(context(req))).toThrow(ForbiddenException);
    req.headers.origin = 'http://localhost:5288';
    req.headers['content-type'] = 'text/plain';
    expect(() => guard.canActivate(context(req))).toThrow(UnsupportedMediaTypeException);
    req.headers['content-type'] = 'application/json';
    Object.assign(req.socket, { remoteAddress: '10.0.0.2' });
    req.headers['x-forwarded-for'] = '127.0.0.1';
    expect(() => guard.canActivate(context(req))).toThrow(ForbiddenException);
    Object.assign(req.socket, { remoteAddress: '127.0.0.1' });
    Object.assign(req, { path: '/api/credentials' });
    expect(() => guard.canActivate(context(req))).toThrow(UnauthorizedException);
    Object.assign(req, { path: '/api/hitl/config' });
    expect(guard.canActivate(context(req))).toBe(true);
    Object.assign(req, { path: '/api/runtime/default-profile' });
    expect(guard.canActivate(context(req))).toBe(true);
    Object.assign(req, { path: '/api/runtime/profiles' });
    expect(() => guard.canActivate(context(req))).toThrow(UnauthorizedException);
  });
});
