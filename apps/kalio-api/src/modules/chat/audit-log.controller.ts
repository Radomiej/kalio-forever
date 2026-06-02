import { Controller, Get, Delete, Query, BadRequestException, Post, Put, Body } from '@nestjs/common';
import { DrizzleService } from '../../database/drizzle.service';
import { auditLog, auditLogArchive } from '../../database/schema';
import type { AuditRetentionPolicy, AuditType } from '@kalio/types';
import { AuditService, type AuditLogSource } from './audit.service';

@Controller('audit-log')
export class AuditLogController {
  constructor(
    private readonly drizzle: DrizzleService,
    private readonly audit: AuditService,
  ) {}

  /**
   * GET /api/audit-log
   * Query params:
   *   limit  — max rows to return (default 200, max 500)
   *   type   — comma-separated AuditType values (optional filter)
   *   since  — Unix ms timestamp (optional, inclusive lower bound)
   *   until  — Unix ms timestamp (optional, inclusive upper bound)
   */
  @Get()
  async list(
    @Query('limit') limitStr?: string,
    @Query('type') typeStr?: string,
    @Query('sessionId') sessionId?: string,
    @Query('since') sinceStr?: string,
    @Query('until') untilStr?: string,
    @Query('source') sourceStr?: string,
  ) {
    const parsedLimit = parseInt(limitStr ?? '200', 10);
    const limit = Math.max(1, Math.min(Number.isFinite(parsedLimit) ? parsedLimit : 200, 2000));
    const types = typeStr ? (typeStr.split(',').filter(Boolean) as AuditType[]) : null;
    const since = parseTimestampQuery(sinceStr);
    const until = parseTimestampQuery(untilStr);
    const source = parseSource(sourceStr);
    return this.audit.listEntries({ limit, types, sessionId, since, until, source });
  }

  @Get('retention')
  retention() {
    return this.audit.retentionStatus();
  }

  @Put('retention')
  updateRetention(@Body() policy: Partial<AuditRetentionPolicy>) {
    return this.audit.setRetentionPolicy(policy);
  }

  @Post('retention/run')
  runRetention(@Query('confirm') confirm?: string) {
    if (confirm !== 'true') {
      throw new BadRequestException('Pass ?confirm=true to run audit retention now');
    }
    return this.audit.runRetentionNow();
  }

  /**
   * DELETE /api/audit-log?confirm=true
   * Clears all audit log entries. Requires ?confirm=true as a safety gate.
   */
  @Delete()
  async clear(@Query('confirm') confirm?: string) {
    if (confirm !== 'true') {
      throw new BadRequestException('Pass ?confirm=true to clear the audit log');
    }
    await this.drizzle.db.delete(auditLog);
    await this.drizzle.db.delete(auditLogArchive);
    return { deleted: true };
  }
}

function parseSource(source: string | undefined): AuditLogSource {
  if (!source) return 'hot';
  if (source === 'hot' || source === 'archive' || source === 'all') return source;
  throw new BadRequestException('Invalid audit log source. Use hot, archive, or all.');
}

function parseTimestampQuery(value: string | undefined): number | null {
  if (value == null) return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
}
