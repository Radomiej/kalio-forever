import 'reflect-metadata';
import { ExecutionContext, HttpException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Response as ExpressResponse } from 'express';
import { describe, expect, it, vi } from 'vitest';
import { DecisionAuthService, type DecisionAuthRequest } from './decision-auth.service';
import { DESKTOP_DECISION_HEADER } from './decision-desktop-auth';
import { DecisionOllamaModelsGuard } from './decision-ollama-models.guard';
import { DecisionOllamaModelsController } from './decision-ollama-models.controller';
import { DecisionOllamaModelsService } from './decision-ollama-models.service';
import { DecisionOllamaInstallService } from './decision-ollama-install.service';
import { OLLAMA_MODEL_TAG as tag } from './decision-ollama-models.types';

const id = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
function fixture() {
  let now = 1000;
  const auth = new DecisionAuthService({ PORT: '3016', KALIO_CONTROL_PLANE_TOKEN: 'a'.repeat(64) }, () => now);
  const request: DecisionAuthRequest = { ip: '127.0.0.1', method: 'POST', headers: {
    host: '127.0.0.1:5188', origin: 'http://127.0.0.1:5188', 'content-type': 'application/json' } };
  const cookie = `${auth.cookieName}=${auth.createSession(request)}`;
  const guard = new DecisionOllamaModelsGuard(auth);
  const context = (method: string, path: string, headers: DecisionAuthRequest['headers'] = {}, ip = request.ip, query = {}) => ({
    getType: () => 'http', switchToHttp: () => ({ getRequest: () => ({ method, path, query,
      socket: { remoteAddress: ip }, headers: { ...request.headers, cookie, ...headers } }) }),
  }) as unknown as ExecutionContext;
  return { auth, guard, context, expire: () => { now += 3600001; } };
}
describe('exact browser-cookie Ollama manager authorization', () => {
  it.each([['GET', '/api/decision/ollama/models'], ['PUT', '/api/decision/ollama/install'],
    ['GET', `/api/decision/ollama/install/${id}`], ['PUT', `/api/decision/ollama/install/${id}/cancel`]])('allows matching browser cookie+origin on %s %s', (method, path) => {
    const f = fixture(); expect(f.guard.canActivate(f.context(method, path))).toBe(true);
  });
  it.each([
    { cookie: undefined }, { origin: 'https://evil.invalid' }, { host: 'evil.invalid' },
    { authorization: `Bearer ${'a'.repeat(64)}` }, { [DESKTOP_DECISION_HEADER]: 'a'.repeat(64) },
    { cookie: 'kalio-decision-auth-5188=wrong' }, { origin: undefined, 'sec-fetch-site': 'cross-site' },
  ])('rejects cookie/origin/desktop/bearer bypass %j', headers => {
    const f = fixture(); expect(() => f.guard.canActivate(f.context('PUT', '/api/decision/ollama/install', headers))).toThrow(HttpException);
  });
  it('permits same-origin GET without Origin, never originless PUT', () => {
    const f = fixture(); const headers = { origin: undefined, 'sec-fetch-site': 'same-origin' };
    expect(f.guard.canActivate(f.context('GET', '/api/decision/ollama/models', headers))).toBe(true);
    expect(() => f.guard.canActivate(f.context('PUT', '/api/decision/ollama/install', headers))).toThrow();
  });
  it.each([['POST', '/api/decision/ollama/install'], ['GET', '/api/decision/ollama/models/'],
    ['GET', '/api/decision/ollama/models/extra'], ['PUT', `/api/decision/ollama/install/${id}`],
    ['GET', '/api/decision/ollama/install/not-uuid'], ['PUT', '/api/decision/config']])('denies method/path expansion %s %s', (method, path) => {
    const f = fixture(); expect(() => f.guard.canActivate(f.context(method, path))).toThrow();
  });
  it('rejects arbitrary query, nonloopback and nonJSON requests', () => {
    const f = fixture();
    expect(() => f.guard.canActivate(f.context('GET', '/api/decision/ollama/models', {}, '127.0.0.1', { endpoint: 'evil' }))).toThrow();
    expect(() => f.guard.canActivate(f.context('GET', '/api/decision/ollama/models', {}, '192.168.1.10'))).toThrow();
    expect(() => f.guard.canActivate(f.context('PUT', '/api/decision/ollama/install', { 'content-type': 'text/plain' }))).toThrow();
  });
  it('revokes expired cookies and rejects nonHTTP contexts', () => {
    const f = fixture();
    expect(() => f.guard.canActivate({ getType: () => 'ws' } as unknown as ExecutionContext)).toThrow();
    f.expire(); expect(() => f.guard.canActivate(f.context('GET', '/api/decision/ollama/models'))).toThrow();
  });
});
describe('manager controller and native Nest dependency composition', () => {
  it('resolves controller/guard/services and forwards status without settings/model inference dependencies', async () => {
    const fetcher = vi.fn<typeof fetch>(async input => String(input).endsWith('/api/tags')
      ? Response.json({ models: [{ name: tag, size: 1945781358, digest: 'a'.repeat(64) }] })
      : Response.json({ capabilities: ['completion'], template: '{{ .Messages }}' }));
    const module = await Test.createTestingModule({ controllers: [DecisionOllamaModelsController], providers: [
      { provide: DecisionAuthService, useValue: fixture().auth }, DecisionOllamaModelsGuard,
      { provide: DecisionOllamaModelsService, useValue: new DecisionOllamaModelsService(fetcher) }, DecisionOllamaInstallService,
    ] }).compile();
    try {
      const controller = module.get(DecisionOllamaModelsController); const status = vi.fn();
      const response = { status } as unknown as ExpressResponse;
      const installed = await controller.install({ modelTag: tag, requestId: 'nest' }, response);
      expect(status).toHaveBeenCalledWith(200); expect(installed.outcome).toBe('already_installed');
      expect(await controller.job(installed.job.jobId)).toEqual({ job: installed.job });
      expect((await controller.catalog()).models[0].readiness).toBe('metadata_ready');
      expect((await controller.cancel(installed.job.jobId, {}, response)).job.state).toBe('installed');
      await expect(controller.install({ modelTag: 'https://evil.invalid', requestId: 'x' }, response))
        .rejects.toMatchObject({ status: 400, response: { code: 'OLLAMA_INVALID_REQUEST' } });
      await expect(controller.job(id)).rejects.toMatchObject({ status: 404, response: { code: 'OLLAMA_JOB_NOT_FOUND' } });
      expect(fetcher.mock.calls.some(([url]) => String(url).endsWith('/api/pull'))).toBe(false);
    } finally { await module.close(); }
  });
});
