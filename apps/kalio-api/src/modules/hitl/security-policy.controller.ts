import { Body, Controller, Post } from '@nestjs/common';
import type { SecurityPolicyResponse } from '@kalio/types';
import { SecurityPolicyService } from './security-policy.service';

@Controller('security/policy')
export class SecurityPolicyController {
  constructor(private readonly securityPolicy: SecurityPolicyService) {}

  @Post('evaluate')
  evaluate(@Body() request: unknown): Promise<SecurityPolicyResponse> {
    return this.securityPolicy.evaluate(request);
  }
}
