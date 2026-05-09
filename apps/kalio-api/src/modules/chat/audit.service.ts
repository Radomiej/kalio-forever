import { Injectable, Logger } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import type { AuditType } from '@kalio/types';
import { DrizzleService } from '../../database/drizzle.service';
import { auditLog } from '../../database/schema';

export type { AuditType };

export interface AuditLogInput {
  sessionId?: string;
  type: AuditType;
  label: string;
  data?: Record<string, unknown>;
  durationMs?: number;
  chunkCount?: number;
}

/**
 * Writes observability records to the audit_log table.
 * Failures are logged as warnings and never propagate — the chat turn must not
 * be interrupted by an audit failure.
 *
 * log() returns the inserted row id so callers can incrementally update it
 * (e.g. live chunkCount updates during LLM streaming).
 */
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly drizzle: DrizzleService) {}

  async log(entry: AuditLogInput): Promise<string> {
    const id = nanoid();
    try {
      await this.drizzle.db.insert(auditLog).values({
        id,
        sessionId: entry.sessionId ?? null,
        type: entry.type,
        label: entry.label,
        data: entry.data ?? null,
        durationMs: entry.durationMs ?? null,
        chunkCount: entry.chunkCount ?? null,
        createdAt: new Date(),
      });
    } catch (err) {
      this.logger.warn(
        `Audit log failed [${entry.type}/${entry.label}]: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    return id;
  }

  async update(id: string, patch: { chunkCount?: number; durationMs?: number; data?: Record<string, unknown> }): Promise<void> {
    try {
      await this.drizzle.db
        .update(auditLog)
        .set({
          ...(patch.chunkCount !== undefined ? { chunkCount: patch.chunkCount } : {}),
          ...(patch.durationMs !== undefined ? { durationMs: patch.durationMs } : {}),
          ...(patch.data !== undefined ? { data: patch.data } : {}),
        })
        .where(eq(auditLog.id, id));
    } catch (err) {
      this.logger.warn(
        `Audit update failed [${id}]: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}
