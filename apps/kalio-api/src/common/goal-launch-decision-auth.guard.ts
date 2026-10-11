import { Injectable, UnauthorizedException, type CanActivate, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import { DecisionAuthService } from './decision-auth.service';
import { decisionAuthRequest } from './decision-auth.guard';

/** Transport prerequisite only. No human/session identity or launch authority. */
@Injectable()
export class GoalLaunchDecisionAuthGuard implements CanActivate {
  constructor(private readonly auth: DecisionAuthService) {}

  canActivate(context: ExecutionContext): boolean {
    if (context.getType() !== 'http') throw new UnauthorizedException({ code: 'GOAL_LAUNCH_DECISION_AUTH_REQUIRED' });
    const request = context.switchToHttp().getRequest<Request>();
    if (request.path !== '/api/hitl/goal-launch/decision'
      || !this.auth.isBrowserDecisionAuthorized(decisionAuthRequest(request))) {
      throw new UnauthorizedException({ code: 'GOAL_LAUNCH_DECISION_AUTH_REQUIRED' });
    }
    return true;
  }
}
