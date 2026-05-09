import { Controller, Get, Delete, Query, BadRequestException } from '@nestjs/common';
import { desc, and, gte, lte, inArray } from 'drizzle-orm';
import { DrizzleService } from '../../database/drizzle.service';
import { auditLog } from '../../database/schema';
import type { AuditType } from '@kalio/types';

@Controller('audit-log')
export class AuditLogController {
  constructor(private readonly drizzle: DrizzleService) {}

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
    @Query('since') sinceStr?: string,
    @Query('until') untilStr?: string,
  ) {
    const limit = Math.min(parseInt(limitStr ?? '200', 10) || 200, 500);
    const types = typeStr ? (typeStr.split(',').filter(Boolean) as AuditType[]) : null;
    const since = sinceStr ? parseInt(sinceStr, 10) : null;
    const until = untilStr ? parseInt(untilStr, 10) : null;

    const conditions = [];
    if (types && types.length > 0) {
      conditions.push(inArray(auditLog.type, types));
    }
    if (since) {
      conditions.push(gte(auditLog.createdAt, new Date(since)));
    }
    if (until) {
      conditions.push(lte(auditLog.createdAt, new Date(until)));
    }

    const rows = await this.drizzle.db
      .select()
      .from(auditLog)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(auditLog.createdAt))
      .limit(limit);

    // Return in chronological order (oldest first)
    return rows.reverse().map((r) => ({
      id: r.id,
      sessionId: r.sessionId,
      type: r.type,
      label: r.label,
      data: r.data ?? null,
      durationMs: r.durationMs ?? null,
      chunkCount: r.chunkCount ?? null,
      createdAt: r.createdAt instanceof Date ? r.createdAt.getTime() : r.createdAt,
    }));
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
    return { deleted: true };
  }
}
