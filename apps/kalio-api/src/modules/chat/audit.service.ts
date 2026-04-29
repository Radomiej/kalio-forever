import { Injectable, Logger } from '@nestjs/common';
import { nanoid } from 'nanoid';
import { DrizzleService } from '../../database/drizzle.service';
import { auditLog } from '../../database/schema';

export type AuditType = 'llm_request' | 'llm_response' | 'tool_call' | 'tool_result' | 'error' | 'raapp_native_call' | 'raapp_native_approved';

export interface AuditEntry {
  sessionId?: string;
  type: AuditType;
  label: string;
  data?: Record<string, unknown>;
  durationMs?: number;
}

/**
 * Writes observability records to the audit_log table.
 * Failures are logged as warnings and never propagate — the chat turn must not
 * be interrupted by an audit failure.
 */
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly drizzle: DrizzleService) {}

  async log(entry: AuditEntry): Promise<void> {
    try {
      await this.drizzle.db.insert(auditLog).values({
        id: nanoid(),
        sessionId: entry.sessionId ?? null,
        type: entry.type,
        label: entry.label,
        data: entry.data ?? null,
        durationMs: entry.durationMs ?? null,
        createdAt: new Date(),
      });
    } catch (err) {
      this.logger.warn(
        `Audit log failed [${entry.type}/${entry.label}]: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}
