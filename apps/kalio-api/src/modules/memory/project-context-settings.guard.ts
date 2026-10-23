import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import { DecisionAuthService } from '../../common/decision-auth.service';
import { decisionAuthRequest } from '../../common/decision-auth.guard';

@Injectable()
export class ProjectContextSettingsGuard implements CanActivate {
  constructor(private readonly auth: DecisionAuthService) {}
  canActivate(context: ExecutionContext): boolean {
    if (context.getType() !== 'http') throw new UnauthorizedException();
    const raw = context.switchToHttp().getRequest<Request>();
    if (!/^\/api\/memory\/project-context\/settings\/?$/.test(raw.path) || !['GET', 'PUT'].includes(raw.method)) throw new UnauthorizedException();
    const request = decisionAuthRequest(raw);
    if (request.headers['authorization'] === undefined) this.auth.requireBrowserOrigin(request);
    if (!this.auth.isAuthorized(request)) throw new UnauthorizedException();
    if (request.method === 'PUT') this.auth.requireJson(request);
    return true;
  }
}
