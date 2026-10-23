import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import { DecisionAuthService, type DecisionAuthRequest } from './decision-auth.service';

export function decisionAuthRequest(request: Request): DecisionAuthRequest {
  return { ip: request.socket.remoteAddress, method: request.method, headers: request.headers };
}

@Injectable()
export class DecisionAuthGuard implements CanActivate {
  constructor(private readonly auth: DecisionAuthService) {}

  canActivate(context: ExecutionContext): boolean {
    if (context.getType() !== 'http') throw new UnauthorizedException({ code: 'DECISION_AUTH_REQUIRED' });
    const raw = context.switchToHttp().getRequest<Request>();
    if (!/^\/api\/(?:decision\/config|hitl\/config|runtime\/default-profile)\/?$/.test(raw.path)) throw new UnauthorizedException({ code: 'DECISION_AUTH_REQUIRED' });
    const request = decisionAuthRequest(raw);
    if (request.headers['authorization'] === undefined) this.auth.requireBrowserOrigin(request);
    if (!this.auth.isAuthorized(request)) throw new UnauthorizedException({ code: 'DECISION_AUTH_REQUIRED' });
    if (request.method === 'PUT') this.auth.requireJson(request);
    return true;
  }
}
