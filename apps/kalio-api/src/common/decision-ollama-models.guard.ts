import { CanActivate, ExecutionContext, ForbiddenException, HttpException, Injectable, UnauthorizedException, UnsupportedMediaTypeException } from '@nestjs/common';
import type { Request } from 'express';
import { decisionAuthRequest } from './decision-auth.guard';
import { DecisionAuthService } from './decision-auth.service';
import { DESKTOP_DECISION_HEADER } from './decision-desktop-auth';

@Injectable()
export class DecisionOllamaModelsGuard implements CanActivate {
  constructor(private readonly auth: DecisionAuthService) {}
  canActivate(context: ExecutionContext): boolean {
    if (context.getType() !== 'http') throw new UnauthorizedException({ code: 'DECISION_AUTH_REQUIRED', message: 'Browser authorization required.' });
    const raw = context.switchToHttp().getRequest<Request>();
    const route = raw.method === 'GET' ? /^\/api\/decision\/ollama\/(?:models|install\/[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12})$/
      : raw.method === 'PUT' ? /^\/api\/decision\/ollama\/install(?:\/[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}\/cancel)?$/ : null;
    if (!route?.test(raw.path) || Object.keys(raw.query ?? {}).length)
      throw new ForbiddenException({ code: 'DECISION_ORIGIN_DENIED', message: 'Unsupported local model route.' });
    const request = decisionAuthRequest(raw);
    if (request.headers[DESKTOP_DECISION_HEADER] !== undefined)
      throw new ForbiddenException({ code: 'OLLAMA_DESKTOP_UNAVAILABLE', message: 'Local model manager is browser-only.' });
    // This surface intentionally accepts the browser cookie only, never control-plane bearer auth.
    try { this.auth.requireBrowserOrigin(request); }
    catch (error) {
      const status = error instanceof HttpException ? error.getStatus() : 403;
      throw new HttpException({ code: status === 503 ? 'DECISION_AUTH_UNAVAILABLE' : 'DECISION_ORIGIN_DENIED',
        message: 'The local browser origin could not be authorized.' }, status);
    }
    if (request.headers['authorization'] !== undefined || !this.auth.isAuthorized(request))
      throw new UnauthorizedException({ code: 'DECISION_AUTH_REQUIRED', message: 'Browser authorization required.' });
    if (request.method === 'PUT') {
      try { this.auth.requireJson(request); }
      catch { throw new UnsupportedMediaTypeException({ code: 'DECISION_JSON_REQUIRED', message: 'JSON request required.' }); }
    }
    return true;
  }
}
