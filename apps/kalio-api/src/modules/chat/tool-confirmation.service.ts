import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { nanoid } from 'nanoid';
import type { ToolConfirmationInvalidated, ToolConfirmationRequest } from '@kalio/types';
import type { StreamContext } from './interfaces/stream-context.interface';
import { HitlNotificationService } from '../hitl/hitl-notification.service';
import { HitlPolicyService } from '../hitl/hitl-policy.service';
import { RuntimeAuditLogger } from './runtime-audit-logger.service';

const HITL_TIMEOUT_MS = 0;
const BUILTIN_SUBAGENT_AUTO_APPROVE_TOOLS = new Set(['vfs_write']);
const OPT_IN_SUBAGENT_AUTO_APPROVE_TOOLS = new Set([
  'fs_write',
  'image_generate',
  'run_cli_agent',
  'spawn_cli_agent',
  'message_cli_agent',
  'stop_cli_agent',
  'terminal_spawn',
]);

type SubagentAgentRunContext = NonNullable<StreamContext['agentRun']> & { autoApproveTools?: string[] };
export type ConfirmationResolutionStatus = 'resolved' | 'rejected' | 'not_found' | 'session_mismatch';
type ConfirmationWaitResult = { status: 'approved' | 'rejected' | 'timeout'; requestId: string; message?: string };
export interface ToolApprovalOutcome {
  approved: boolean;
  rejectionMessage?: string;
}
export type PendingMutationStatus = 'removed' | 'not_found' | 'session_mismatch';

interface PendingConfirmation {
  sessionId: string;
  payload: ToolConfirmationRequest;
  emit: StreamContext['emit'];
  resolve: () => void;
  reject: (message?: string) => void;
}

@Injectable()
export class ToolConfirmationService {
  private readonly logger = new Logger(ToolConfirmationService.name);
  private readonly pending = new Map<string, PendingConfirmation>();

  constructor(
    @Optional() @Inject(HitlPolicyService) private readonly hitlPolicy: HitlPolicyService | null,
    @Optional() @Inject(HitlNotificationService) private readonly hitlNotifications: HitlNotificationService | null,
    @Optional() @Inject(RuntimeAuditLogger) private readonly runtimeAudit: RuntimeAuditLogger | null = null,
  ) {}

  resolveConfirmation(requestId: string, sessionId?: string, message?: string): ConfirmationResolutionStatus {
    const pending = this.pending.get(requestId);
    if (!pending) return 'not_found';
    if (sessionId && pending.sessionId !== sessionId) {
      this.logger.warn(
        `Ignoring tool confirmation for request ${requestId}: session mismatch (${sessionId} !== ${pending.sessionId})`,
      );
      return 'session_mismatch';
    }
    this.pending.delete(requestId);
    this.emitConfirmationInvalidated(pending, 'confirmed');
    this.logConfirmationLifecycle(pending, 'hitl_approval_confirmed', 'manual', message);
    void this.logRuntimeConfirmation(pending, 'tool.confirmation.approved', 'completed');
    pending.resolve();
    return 'resolved';
  }

  cancelConfirmation(requestId: string, sessionId?: string, message?: string): ConfirmationResolutionStatus {
    const pending = this.pending.get(requestId);
    if (!pending) return 'not_found';
    if (sessionId && pending.sessionId !== sessionId) {
      this.logger.warn(
        `Ignoring tool cancellation for request ${requestId}: session mismatch (${sessionId} !== ${pending.sessionId})`,
      );
      return 'session_mismatch';
    }
    this.pending.delete(requestId);
    this.emitConfirmationInvalidated(pending, 'cancelled');
    this.logConfirmationLifecycle(pending, 'hitl_approval_cancelled', 'manual', message);
    void this.logRuntimeConfirmation(pending, 'tool.confirmation.denied', 'cancelled', message);
    pending.reject(message);
    return 'rejected';
  }

  getPendingConfirmations(sessionId: string): ToolConfirmationRequest[] {
    return Array.from(this.pending.values())
      .filter((pending) => pending.sessionId === sessionId)
      .map((pending) => pending.payload);
  }

  seedPendingConfirmation(payload: ToolConfirmationRequest): void {
    this.pending.set(payload.requestId, {
      sessionId: payload.sessionId,
      payload,
      emit: () => undefined,
      resolve: () => undefined,
      reject: () => undefined,
    });
  }

  dropPendingConfirmation(requestId: string, sessionId?: string): PendingMutationStatus {
    const pending = this.pending.get(requestId);
    if (!pending) return 'not_found';
    if (sessionId && pending.sessionId !== sessionId) {
      return 'session_mismatch';
    }

    this.pending.delete(requestId);
    return 'removed';
  }

  async approveOrRequestConfirmation(
    callId: string,
    toolName: string,
    args: Record<string, unknown>,
    ctx: StreamContext,
  ): Promise<ToolApprovalOutcome> {
    if (this.canAutoApprove(toolName, ctx)) {
      return { approved: true };
    }

    if (this.hitlPolicy) {
      try {
        const resolution = await this.hitlPolicy.resolveApproval({
          kind: 'tool',
          sessionId: ctx.sessionId,
          name: toolName,
          args,
          abortSignal: ctx.abortSignal,
          agentRun: ctx.agentRun,
          toolCallId: callId,
        });

        if (resolution.status === 'approved') {
          return { approved: true };
        }

        if (resolution.status === 'rejected') {
          this.logger.log(
            `Global HITL policy rejected tool [${toolName}] for session ${ctx.sessionId}${resolution.reason ? `: ${resolution.reason}` : ''}`,
          );
          return { approved: false };
        }
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        this.logger.error(
          `Global HITL policy failed for tool [${toolName}] session=${ctx.sessionId}`,
          error,
        );
      }
    }

    const waitResult = await this.awaitConfirmation(callId, toolName, args, ctx);
    if (waitResult.status === 'approved') {
      return { approved: true };
    }

    if (waitResult.status === 'rejected' || !this.hitlPolicy) {
      return {
        approved: false,
        ...(waitResult.message ? { rejectionMessage: waitResult.message } : {}),
      };
    }

    try {
      const resolution = await this.hitlPolicy.resolveUnattendedApproval({
        kind: 'tool',
        sessionId: ctx.sessionId,
        name: toolName,
        args,
        abortSignal: ctx.abortSignal,
        agentRun: ctx.agentRun,
        toolCallId: callId,
      });

      if (resolution.status === 'approved') {
        this.logUnattendedLifecycle('hitl_approval_representative_approved', waitResult.requestId, callId, toolName, args, ctx, resolution.reason);
        return { approved: true };
      }

      if (resolution.status === 'rejected') {
        this.logUnattendedLifecycle('hitl_approval_representative_rejected', waitResult.requestId, callId, toolName, args, ctx, resolution.reason);
        this.logger.log(
          `Representative HITL fallback rejected tool [${toolName}] for session ${ctx.sessionId}${resolution.reason ? `: ${resolution.reason}` : ''}`,
        );
      } else {
        this.logUnattendedLifecycle('hitl_approval_representative_manual', waitResult.requestId, callId, toolName, args, ctx, resolution.reason);
      }
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      this.logger.error(
        `Representative HITL fallback failed for tool [${toolName}] session=${ctx.sessionId}`,
        error,
      );
    }

    return {
      approved: false,
      ...(waitResult.message ? { rejectionMessage: waitResult.message } : {}),
    };
  }

  private awaitConfirmation(
    callId: string,
    toolName: string,
    args: Record<string, unknown>,
    ctx: StreamContext,
  ): Promise<ConfirmationWaitResult> {
    const requestId = nanoid();
    const timeoutMs = ctx.agentRun?.agentType === 'subagent' ? 0 : HITL_TIMEOUT_MS;

    const payload: ToolConfirmationRequest = {
      requestId,
      toolCallId: callId,
      sessionId: ctx.sessionId,
      toolName,
      args,
      timeoutMs,
      agentRun: ctx.agentRun,
    };

    ctx.emit('tool:confirmation_required', payload);
    void this.hitlNotifications?.notifyApprovalRequested({
      requestId,
      timeoutMs,
      request: {
        kind: 'tool',
        sessionId: ctx.sessionId,
        name: toolName,
        args,
        abortSignal: ctx.abortSignal,
        agentRun: ctx.agentRun,
        toolCallId: callId,
      },
    });
    void this.runtimeAudit?.log({
      eventName: 'tool.confirmation.requested',
      sessionId: ctx.sessionId,
      turnId: ctx.turnId,
      status: 'waiting_for_human',
      data: {
        requestId,
        toolCallId: callId,
        toolName,
        agentRunId: ctx.agentRun?.agentRunId,
        agentType: ctx.agentRun?.agentType,
      },
    });

    return new Promise<ConfirmationWaitResult>(resolve => {
      const timeout = timeoutMs > 0
        ? setTimeout(() => {
            const pending = this.pending.get(requestId);
          if (pending) {
            this.pending.delete(requestId);
            this.emitConfirmationInvalidated(pending, 'timeout', `Approval timed out for tool ${toolName}.`);
            this.logConfirmationLifecycle(pending, 'hitl_approval_timeout', 'manual');
            void this.logRuntimeConfirmation(pending, 'tool.confirmation.timeout', 'failed');
          }
            this.logger.warn(`HITL confirmation timed out for tool [${toolName}] session=${ctx.sessionId}`);
            resolve({ status: 'timeout', requestId });
          }, timeoutMs)
        : null;

      const cleanupAbortListener = () => {
        ctx.abortSignal?.removeEventListener('abort', handleAbort);
      };

      const handleAbort = () => {
        const pending = this.pending.get(requestId);
        if (pending) {
          this.pending.delete(requestId);
          this.emitConfirmationInvalidated(pending, 'cancelled', `Tool confirmation aborted for ${toolName}.`);
          this.logConfirmationLifecycle(pending, 'hitl_approval_cancelled', 'abort');
          void this.logRuntimeConfirmation(pending, 'tool.confirmation.cancelled', 'cancelled');
        }
        if (timeout) clearTimeout(timeout);
        cleanupAbortListener();
        resolve({ status: 'rejected', requestId });
      };

      this.pending.set(requestId, {
        sessionId: ctx.sessionId,
        payload,
        emit: ctx.emit,
        resolve: () => {
          if (timeout) clearTimeout(timeout);
          cleanupAbortListener();
          resolve({ status: 'approved', requestId });
        },
        reject: (message?: string) => {
          if (timeout) clearTimeout(timeout);
          cleanupAbortListener();
          resolve({ status: 'rejected', requestId, ...(message ? { message } : {}) });
        },
      });

      if (ctx.abortSignal?.aborted) {
        handleAbort();
        return;
      }
      ctx.abortSignal?.addEventListener('abort', handleAbort, { once: true });
    });
  }

  private canAutoApprove(toolName: string, ctx: StreamContext): boolean {
    const agentRun = ctx.agentRun as SubagentAgentRunContext | undefined;
    if (agentRun?.agentType !== 'subagent') {
      return false;
    }

    if (BUILTIN_SUBAGENT_AUTO_APPROVE_TOOLS.has(toolName)) {
      return (agentRun.vfsMode === 'isolated' && ctx.vfsSessionId === ctx.sessionId)
        || (agentRun.vfsMode === 'shared' && Array.isArray(agentRun.autoApproveTools) && agentRun.autoApproveTools.includes(toolName));
    }

    return Array.isArray(agentRun.autoApproveTools)
      && agentRun.autoApproveTools.some(
        (candidate) => candidate === toolName && OPT_IN_SUBAGENT_AUTO_APPROVE_TOOLS.has(candidate),
      );
  }

  private logConfirmationLifecycle(
    pending: PendingConfirmation,
    eventType: Parameters<HitlNotificationService['logApprovalLifecycle']>[0]['eventType'],
    source: string,
    reason?: string,
  ): void {
    void this.hitlNotifications?.logApprovalLifecycle({
      eventType,
      requestId: pending.payload.requestId,
      source,
      ...(reason ? { reason } : {}),
      request: {
        kind: 'tool',
        sessionId: pending.payload.sessionId,
        name: pending.payload.toolName,
        args: pending.payload.args,
        agentRun: pending.payload.agentRun,
        toolCallId: pending.payload.toolCallId,
      },
    });
  }

  private logUnattendedLifecycle(
    eventType: Parameters<HitlNotificationService['logApprovalLifecycle']>[0]['eventType'],
    requestId: string,
    callId: string,
    toolName: string,
    args: Record<string, unknown>,
    ctx: StreamContext,
    reason?: string,
  ): void {
    void this.hitlNotifications?.logApprovalLifecycle({
      eventType,
      requestId,
      source: 'representative',
      reason,
      request: {
        kind: 'tool',
        sessionId: ctx.sessionId,
        name: toolName,
        args,
        agentRun: ctx.agentRun,
        toolCallId: callId,
      },
    });
  }

  private emitConfirmationInvalidated(
    pending: PendingConfirmation,
    reason: ToolConfirmationInvalidated['reason'],
    message?: string,
  ): void {
    pending.emit('tool:confirmation_invalidated', {
      requestId: pending.payload.requestId,
      toolCallId: pending.payload.toolCallId,
      sessionId: pending.payload.sessionId,
      reason,
      ...(message !== undefined ? { message } : {}),
      ...(pending.payload.agentRun !== undefined ? { agentRun: pending.payload.agentRun } : {}),
    });
  }

  private logRuntimeConfirmation(
    pending: PendingConfirmation,
    eventName: string,
    status: 'completed' | 'failed' | 'cancelled',
    reason?: string,
  ): Promise<string> | undefined {
    return this.runtimeAudit?.log({
      eventName,
      sessionId: pending.payload.sessionId,
      status,
      data: {
        requestId: pending.payload.requestId,
        toolCallId: pending.payload.toolCallId,
        toolName: pending.payload.toolName,
        agentRunId: pending.payload.agentRun?.agentRunId,
        agentType: pending.payload.agentRun?.agentType,
        ...(reason ? { message: reason } : {}),
      },
    });
  }
}
