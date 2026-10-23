import { Module } from '@nestjs/common';
import { AuditService } from './audit.service';
import { CmdInvocationAuditService } from './cmd-invocation-audit.service';

@Module({
  providers: [AuditService, CmdInvocationAuditService],
  exports: [AuditService, CmdInvocationAuditService],
})
export class AuditModule {}
