import { Injectable, Logger } from '@nestjs/common';
import { nanoid } from 'nanoid';
import { DrizzleService } from '../../database/drizzle.service';
import { auditLog } from '../../database/schema';
import { desc, eq } from 'drizzle-orm';

export type AuditEventType = 'llm_request' | 'llm_response' | 'tool_call' | 'tool_result' | 'error';

export interface AuditLogEntry {
  id: string;
  sessionId: string | null;
  type: AuditEventType;
  label: string;
  data: Record<string, unknown> | null;
  durationMs: number | null;
  createdAt: number;
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly drizzle: DrizzleService) {}

  async log(
    type: AuditEventType,
    label: string,
    opts?: {
      sessionId?: string;
      data?: Record<string, unknown>;
      durationMs?: number;
    },
  ): Promise<string> {
    const id = nanoid();
    try {
      await this.drizzle.db.insert(auditLog).values({
        id,
        sessionId: opts?.sessionId ?? null,
        type,
        label,
        data: opts?.data ?? null,
        durationMs: opts?.durationMs ?? null,
        createdAt: new Date(),
      });
    } catch (err) {
      this.logger.error('[audit] Failed to write audit log entry', err instanceof Error ? err : new Error(String(err)));
    }
    return id;
  }

  async getRecent(limit = 100, sessionId?: string): Promise<AuditLogEntry[]> {
    const rows = sessionId
      ? await this.drizzle.db
          .select()
          .from(auditLog)
          .where(eq(auditLog.sessionId, sessionId))
          .orderBy(desc(auditLog.createdAt))
          .limit(limit)
      : await this.drizzle.db
          .select()
          .from(auditLog)
          .orderBy(desc(auditLog.createdAt))
          .limit(limit);

    return rows.map((r) => ({
      id: r.id,
      sessionId: r.sessionId,
      type: r.type as AuditEventType,
      label: r.label,
      data: r.data as Record<string, unknown> | null,
      durationMs: r.durationMs,
      createdAt: r.createdAt instanceof Date ? r.createdAt.getTime() : (r.createdAt as number),
    }));
  }
}
