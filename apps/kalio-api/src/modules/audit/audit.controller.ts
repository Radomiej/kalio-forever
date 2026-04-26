import { Controller, Get, Query } from '@nestjs/common';
import { AuditService } from './audit.service';

@Controller('api/audit-log')
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get()
  async getRecent(
    @Query('sessionId') sessionId?: string,
    @Query('limit') limit?: string,
  ) {
    const parsedLimit = limit ? Math.min(parseInt(limit, 10) || 100, 500) : 100;
    const entries = await this.audit.getRecent(parsedLimit, sessionId);
    // Return newest-last so timeline renders top-to-bottom chronologically
    return entries.reverse();
  }
}
