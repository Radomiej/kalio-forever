import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import type { ToolConfirmationInvalidated, ToolConfirmationRequest, HostHitlExecutionCommit, ToolResult } from '@kalio/types';
import type { StreamContext } from './interfaces/stream-context.interface';
import { HitlNotificationService } from '../hitl/hitl-notification.service';
import { HitlPolicyService } from '../hitl/hitl-policy.service';
import { HitlRequestService } from '../hitl/hitl-request.service';
import { RuntimeAuditLogger } from './runtime-audit-logger.service';
import { readHostConfirmationRequirement } from './tool-confirmation.persistence';
import { awaitToolConfirmation } from './tool-confirmation-wait';
import type { ConfirmationWaitResult, PendingConfirmation } from './tool-confirmation-pending';
import { reconcileCommittedGoalLaunchDecision, reconcileRegisteredGoalLaunchWaiter,
  type CommittedGoalLaunchDecisionSelector, type GoalLaunchReconciliationDependencies,
  type GoalLaunchReconciliationResult } from './tool-confirmation-reconciliation';

export type ConfirmationResolutionStatus = 'resolved' | 'rejected' | 'not_found' | 'session_mismatch';
export interface ToolApprovalOutcome {
  approved: boolean;
  rejectionMessage?: string;
  execution?: { requestId: string; revision: number };
  nonDurableReason?: 'policy' | 'representative' | 'legacy_confirmation';
}
export type PendingMutationStatus = 'removed' | 'not_found' | 'session_mismatch';

@Injectable()
export class ToolConfirmationService {
  private readonly logger = new Logger(ToolConfirmationService.name);
  private readonly pending = new Map<string, PendingConfirmation>();

  constructor(
    @Optional() @Inject(HitlPolicyService) private readonly hitlPolicy: HitlPolicyService | null,
    @Optional() @Inject(HitlNotificationService) private readonly hitlNotifications: HitlNotificationService | null,
    @Optional() @Inject(RuntimeAuditLogger) private readonly runtimeAudit: RuntimeAuditLogger | null = null,
    @Optional() @Inject(HitlRequestService) private readonly hitlRequests: HitlRequestService | null = null,
  ) {}

  /** Wake an existing waiter from a durable decision; never claim or launch execution. */
  async reconcileCommittedGoalLaunchDecision(selector: CommittedGoalLaunchDecisionSelector): Promise<GoalLaunchReconciliationResult> {
    if (!this.hitlRequests) return 'conflict';
    return reconcileCommittedGoalLaunchDecision(selector, this.goalReconciliationDependencies(this.hitlRequests));
  }

  private goalReconciliationDependencies(requests: HitlRequestService): GoalLaunchReconciliationDependencies {
    const logFailure = () => this.logger.error('GOAL_LAUNCH_RECONCILIATION_FAILED');
    return { pending: this.pending, requests, logFailure,
      notifySettled: (pending, status, message) => {
        this.emitConfirmationInvalidated(pending, status === 'approved' ? 'confirmed' : 'cancelled', message);
        // Reconciliation is not an assertion that denial came from an authenticated HTTP caller.
        void Promise.all([
          this.hitlNotifications?.logApprovalLifecycle({
            eventType: status === 'approved' ? 'hitl_approval_confirmed' : 'hitl_approval_cancelled',
            requestId: pending.payload.requestId, source: 'durable_reconciliation',
            ...(message !== undefined ? { reason: message } : {}),
            request: { kind: 'tool', sessionId: pending.source!.sessionId, name: pending.source!.toolName,
              args: pending.source!.args, toolCallId: pending.source!.toolCallId, agentRun: pending.payload.agentRun },
          }),
          this.logRuntimeConfirmation(pending, status === 'approved' ? 'tool.confirmation.approved' : 'tool.confirmation.denied',
            status === 'approved' ? 'completed' : 'cancelled', message),
        ]).catch(logFailure);
      },
    };
  }

  async resolveConfirmation(requestId: string, sessionId?: string, message?: string): Promise<ConfirmationResolutionStatus> {
    return this.resolveConfirmationInternal(requestId, sessionId, message);
  }
  async resolveConfirmationFromGateway(requestId: string, sessionId: string, socketId: string, message?: string): Promise<ConfirmationResolutionStatus> {
    if (!sessionId || !socketId) return 'rejected';
    return this.resolveConfirmationInternal(requestId, sessionId, message, socketId);
  }
  private async resolveConfirmationInternal(requestId: string, sessionId?: string, message?: string, socketId?: string): Promise<ConfirmationResolutionStatus> {
    const pending = this.pending.get(requestId);
    if (!pending) return 'not_found';
    if (sessionId && pending.sessionId !== sessionId) {
      this.logger.warn(
        `Ignoring tool confirmation for request ${requestId}: session mismatch (${sessionId} !== ${pending.sessionId})`,
      );
      return 'session_mismatch';
    }
    if (pending.hostConfirmationRequired && (!socketId || !sessionId || !this.hitlRequests || pending.revision === undefined)) return 'rejected';
    if (this.hitlRequests && pending.revision !== undefined) {
      const resolved = pending.hostConfirmationRequired
        ? await this.hitlRequests.resolveHostConfirmationFromGateway(requestId, pending.revision, pending.sessionId, socketId!, message)
        : await this.hitlRequests.resolve(requestId, pending.revision, 'approved', message ? { message } : undefined);
      if (!resolved) return 'not_found';
    }
    this.pending.delete(requestId);
    this.emitConfirmationInvalidated(pending, 'confirmed');
    this.logConfirmationLifecycle(pending, 'hitl_approval_confirmed', 'manual', message);
    void this.logRuntimeConfirmation(pending, 'tool.confirmation.approved', 'completed');
    pending.resolve();
    return 'resolved';
  }

  async cancelConfirmation(requestId: string, sessionId?: string, message?: string): Promise<ConfirmationResolutionStatus> {
    const pending = this.pending.get(requestId);
    if (!pending) return 'not_found';
    if (sessionId && pending.sessionId !== sessionId) {
      this.logger.warn(
        `Ignoring tool cancellation for request ${requestId}: session mismatch (${sessionId} !== ${pending.sessionId})`,
      );
      return 'session_mismatch';
    }
    if (this.hitlRequests && pending.revision !== undefined) {
      const resolved = await this.hitlRequests.resolve(requestId, pending.revision, 'cancelled', message ? { message } : undefined);
      if (!resolved) return 'not_found';
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
    humanOnly = false,
  ): Promise<ToolApprovalOutcome> {
    const hostRequirement = readHostConfirmationRequirement(ctx, callId, toolName);
    if (hostRequirement) {
      humanOnly = true;
      if (!this.hitlRequests || !ctx.onResolvedToolDispatch || !ctx.registerToolResultReceiptCommit) throw new Error('HOST_CONFIRMATION_DURABILITY_REQUIRED');
    }
    if (this.hitlPolicy && !humanOnly) {
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
          this.logPolicyLifecycle('hitl_approval_confirmed', resolution.source, callId, toolName, args, ctx, resolution.reason);
          return ctx.onResolvedToolDispatch ? { approved: true, nonDurableReason: 'policy' } : { approved: true };
        }

        if (resolution.status === 'rejected') {
          this.logger.log(
            `Global HITL policy rejected tool [${toolName}] for session ${ctx.sessionId}${resolution.reason ? `: ${resolution.reason}` : ''}`,
          );
          this.logPolicyLifecycle('hitl_approval_cancelled', resolution.source, callId, toolName, args, ctx, resolution.reason);
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
      if (this.hitlRequests) {
        const approved = await this.hitlRequests.getById(waitResult.requestId);
        const claimed = approved && !ctx.abortSignal.aborted
          ? hostRequirement
            ? await this.hitlRequests.claimApprovedHostContinuation(approved.id, approved.revision, ctx.sessionId, callId)
            : await this.hitlRequests.claimApprovedContinuation(approved.id, approved.revision)
          : null;
        if (!claimed) return { approved: false, rejectionMessage: 'Durable approval execution could not be claimed.' };
        return { approved: true, execution: { requestId: claimed.id, revision: claimed.revision } };
      }
      return ctx.onResolvedToolDispatch ? { approved: true, nonDurableReason: 'legacy_confirmation' } : { approved: true };
    }

    if (waitResult.status === 'rejected' || humanOnly || !this.hitlPolicy) {
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
        return ctx.onResolvedToolDispatch ? { approved: true, nonDurableReason: 'representative' } : { approved: true };
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

  private async awaitConfirmation(
    callId: string,
    toolName: string,
    args: Record<string, unknown>,
    ctx: StreamContext,
  ): Promise<ConfirmationWaitResult> {
    return awaitToolConfirmation({
      callId, toolName, args, ctx, pending: this.pending,
      hitlRequests: this.hitlRequests, hitlNotifications: this.hitlNotifications,
      runtimeAudit: this.runtimeAudit, logger: this.logger,
      emitConfirmationInvalidated: (pending, reason, message) => this.emitConfirmationInvalidated(pending, reason, message),
      logConfirmationLifecycle: (pending, eventType, source, reason) => this.logConfirmationLifecycle(pending, eventType, source, reason),
      logRuntimeConfirmation: (pending, eventName, status, reason) => this.logRuntimeConfirmation(pending, eventName, status, reason),
      onGoalWaitRegistered: this.hitlRequests
        ? requestId => reconcileRegisteredGoalLaunchWaiter(requestId, this.goalReconciliationDependencies(this.hitlRequests!))
        : undefined,
    });
  }

  /** Call only after the canonical tool result has been durably saved. */
  async finishLiveExecution(execution: NonNullable<ToolApprovalOutcome['execution']>, outcome: Record<string, unknown>): Promise<void> {
    if (!this.hitlRequests || !await this.hitlRequests.markContinuationToolResult(execution.requestId, execution.revision, outcome)) {
      throw new Error(`Unable to commit durable tool execution ${execution.requestId}; execution remains uncertain.`);
    }
  }
  async finishLiveExecutionRequired(execution: NonNullable<ToolApprovalOutcome['execution']>, outcome: { status: ToolResult['status'] }): Promise<HostHitlExecutionCommit> {
    try {
      if (!this.hitlRequests) throw new Error('missing');
      return await this.hitlRequests.markContinuationToolResultRequired(execution.requestId, execution.revision, outcome);
    } catch { throw new Error('HITL_EXECUTION_COMMIT_FAILED'); }
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

  private logPolicyLifecycle(
    eventType: Parameters<HitlNotificationService['logApprovalLifecycle']>[0]['eventType'],
    source: string,
    callId: string,
    toolName: string,
    args: Record<string, unknown>,
    ctx: StreamContext,
    reason?: string,
  ): void {
    void this.hitlNotifications?.logApprovalLifecycle({
      eventType,
      requestId: `policy:${callId}`,
      source,
      ...(reason ? { reason } : {}),
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
