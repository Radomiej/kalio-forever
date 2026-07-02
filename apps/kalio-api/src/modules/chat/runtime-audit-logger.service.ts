import { Injectable } from '@nestjs/common';
import type { WorkflowErrorCode, WorkflowReasonCode } from '@kalio/types';
import { AuditService } from './audit.service';

export type RuntimeAuditStatus =
  | 'started'
  | 'running'
  | 'completed'
  | 'waiting_for_human'
  | 'failed'
  | 'cancelled';

export interface RuntimeAuditEventInput {
  eventName: string;
  sessionId?: string;
  runId?: string;
  nodeId?: string;
  turnId?: string;
  status?: RuntimeAuditStatus;
  reasonCode?: WorkflowReasonCode | string;
  errorCode?: WorkflowErrorCode | string;
  durationMs?: number;
  data?: Record<string, unknown>;
}

const REDACTED_RUNTIME_KEYS = new Set([
  'prompt',
  'rawPrompt',
  'systemPrompt',
  'effectiveSystemPrompt',
  'content',
  'messages',
  'history',
  'apiKey',
  'authorization',
  'token',
  'secret',
]);

@Injectable()
export class RuntimeAuditLogger {
  constructor(private readonly audit: AuditService) {}

  async log(event: RuntimeAuditEventInput): Promise<string> {
    return this.audit.log({
      sessionId: event.sessionId,
      type: 'runtime_event',
      label: event.eventName,
      durationMs: event.durationMs,
      data: {
        domain: 'runtime',
        eventName: event.eventName,
        ...(event.runId ? { runId: event.runId } : {}),
        ...(event.nodeId ? { nodeId: event.nodeId } : {}),
        ...(event.turnId ? { turnId: event.turnId } : {}),
        ...(event.status ? { status: event.status } : {}),
        ...(event.reasonCode ? { reasonCode: event.reasonCode } : {}),
        ...(event.errorCode ? { errorCode: event.errorCode } : {}),
        ...sanitizeRuntimeAuditData(event.data),
      },
    });
  }
}

function sanitizeRuntimeAuditData(data: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!data) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(data).filter(([key]) => !REDACTED_RUNTIME_KEYS.has(key)),
  );
}
