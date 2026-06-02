import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { nanoid } from 'nanoid';
import { DrizzleService } from '../../database/drizzle.service';
import { auditLog } from '../../database/schema';
import { RelayService } from '../relay/relay.service';
import { HitlConfigService } from './hitl-config.service';
import type { HitlApprovalRequest } from './hitl.types';

export interface HitlApprovalNotification {
  requestId: string;
  timeoutMs: number;
  request: HitlApprovalRequest;
}

export type HitlApprovalLifecycleEvent =
  | 'hitl_approval_requested'
  | 'hitl_approval_confirmed'
  | 'hitl_approval_cancelled'
  | 'hitl_approval_timeout'
  | 'hitl_approval_representative_approved'
  | 'hitl_approval_representative_rejected'
  | 'hitl_approval_representative_manual';

export interface HitlApprovalLifecycleLog {
  eventType: HitlApprovalLifecycleEvent;
  requestId: string;
  request: HitlApprovalRequest;
  source?: string;
  reason?: string;
}

export type HitlApprovalReplyDecision = 'approve' | 'reject' | 'unknown';

export interface HitlApprovalReply {
  decision: HitlApprovalReplyDecision;
  requestId?: string;
  reason?: string;
}

@Injectable()
export class HitlNotificationService {
  private readonly logger = new Logger(HitlNotificationService.name);

  constructor(
    private readonly hitlConfig: HitlConfigService,
    private readonly drizzle: DrizzleService,
    @Optional() @Inject(RelayService) private readonly relay: RelayService | null,
  ) {}

  async notifyApprovalRequested(notification: HitlApprovalNotification): Promise<void> {
    const config = await this.hitlConfig.getConfig();
    let delivered = false;
    let error: string | null = null;

    if (config.notificationChannel === 'telegram') {
      try {
        delivered = await this.relay?.broadcast(this.formatTelegramApproval(notification)) ?? false;
      } catch (err) {
        error = err instanceof Error ? err.message : String(err);
        this.logger.warn(`HITL Telegram notification failed: ${error}`);
      }
    }

    await this.logNotification(notification, config.notificationChannel, delivered, error);
  }

  async logApprovalLifecycle(event: HitlApprovalLifecycleLog): Promise<void> {
    await this.logEvent({
      sessionId: event.request.sessionId,
      label: this.lifecycleLabel(event),
      data: {
        domain: 'hitl',
        approvalKind: event.request.kind,
        eventType: event.eventType,
        approvalId: event.requestId,
        requestId: event.requestId,
        request: this.serializeRequest(event.request),
        ...(event.source ? { source: event.source } : {}),
        ...(event.reason ? { reason: event.reason } : {}),
      },
    });
  }

  parseApprovalReply(text: string): HitlApprovalReply {
    const trimmed = text.trim();
    const match = /^(approve|approved|yes|reject|rejected|deny|no)\s+([A-Za-z0-9_-]+)(?:\s+([\s\S]+))?$/i.exec(trimmed);
    if (!match) {
      return { decision: 'unknown' };
    }

    const verb = match[1].toLowerCase();
    const decision: HitlApprovalReplyDecision = verb === 'approve' || verb === 'approved' || verb === 'yes'
      ? 'approve'
      : 'reject';
    const reason = match[3]?.trim();

    return {
      decision,
      requestId: match[2],
      ...(reason ? { reason } : {}),
    };
  }

  private formatTelegramApproval(notification: HitlApprovalNotification): string {
    const { request, requestId, timeoutMs } = notification;
    const timeoutLabel = timeoutMs > 0 ? `${Math.round(timeoutMs / 1000)}s` : 'no auto-timeout';
    return [
      'Kalio approval requested',
      `Request: ${requestId}`,
      `Session: ${request.sessionId}`,
      `Action: ${request.kind}/${request.name}`,
      `Timeout: ${timeoutLabel}`,
      '',
      `Reply with: approve ${requestId} <reason>`,
      `Or: /approve ${requestId} <reason>`,
      `Cancel with: reject ${requestId} <reason>`,
      `Or: /cancel ${requestId} <reason>`,
    ].join('\n');
  }

  private async logNotification(
    notification: HitlApprovalNotification,
    channel: string,
    delivered: boolean,
    error: string | null,
  ): Promise<void> {
    await this.logEvent({
      sessionId: notification.request.sessionId,
      label: `HITL approval requested: ${notification.request.name}`,
      data: {
        domain: 'hitl',
        approvalKind: notification.request.kind,
        eventType: 'hitl_approval_requested',
        approvalId: notification.requestId,
        requestId: notification.requestId,
        channel,
        delivered,
        timeoutMs: notification.timeoutMs,
        request: this.serializeRequest(notification.request),
        ...(error ? { error } : {}),
      },
    });
  }

  private lifecycleLabel(event: HitlApprovalLifecycleLog): string {
    const action = event.eventType
      .replace('hitl_approval_', '')
      .replaceAll('_', ' ');
    return `HITL approval ${action}: ${event.request.name}`;
  }

  private async logEvent(entry: {
    sessionId: string;
    label: string;
    data: Record<string, unknown>;
  }): Promise<void> {
    try {
      await this.drizzle.db.insert(auditLog).values({
        id: nanoid(),
        sessionId: entry.sessionId,
        type: 'external_hitl',
        label: entry.label,
        data: entry.data,
        durationMs: null,
        chunkCount: null,
        createdAt: new Date(),
      });
    } catch (err) {
      this.logger.warn(`HITL notification audit failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private serializeRequest(request: HitlApprovalRequest): Record<string, unknown> {
    return {
      kind: request.kind,
      sessionId: request.sessionId,
      name: request.name,
      args: request.args,
      displayLabel: request.displayLabel,
      toolCallId: request.toolCallId,
      agentRun: request.agentRun,
    };
  }
}
