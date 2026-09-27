import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import type { SecurityPolicyResponse } from '@kalio/types';
import { SecurityPolicyService } from './security-policy.service';
import { ControlPlaneAuthGuard } from '../../common/control-plane-auth';

@Controller('security/policy')
@UseGuards(ControlPlaneAuthGuard)
export class SecurityPolicyController {
  constructor(private readonly securityPolicy: SecurityPolicyService) {}

  @Post('evaluate')
  evaluate(@Body() request: unknown): Promise<SecurityPolicyResponse> {
    return this.securityPolicy.evaluate(request);
  }
}
