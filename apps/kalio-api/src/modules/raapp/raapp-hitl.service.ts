import { Injectable, Logger, Inject, Optional } from '@nestjs/common';
import { eq, and, inArray } from 'drizzle-orm';
import { DrizzleService } from '../../database/drizzle.service';
import { raappPendingApprovals } from '../../database/schema';
import { NativeSystemRegistry } from './native/native-system-registry.service';
import type { NativeSessionContext } from './native/native-system-registry.service';
import type { PendingApproval } from './effects-processor.service';
import { AuditService } from '../chat/audit.service';
import { HitlPolicyService } from '../hitl/hitl-policy.service';
import type { RaAppNativeResult, RaAppPendingApproval } from '@kalio/types';
import type { RaAppOutputPatch } from './raapp-output-patches.util';

export interface SavedApproval {
  id: string;
  sessionId: string;
  toolCallId: string;
  system: string;
  args: Record<string, unknown>;
  outputPath?: string;
  displayLabel: string;
  status: 'pending' | 'approved' | 'cancelled' | 'executed' | 'error';
  result?: Record<string, unknown>;
  createdAt: Date;
}

export interface ApproveResult {
  id: string;
  system: string;
  toolCallId: string;
  status: 'executed' | 'error';
  result?: unknown;
  error?: string;
}

export interface ResolvePendingApprovalsResult {
  pendingApprovals: RaAppPendingApproval[];
  nativeResults: RaAppNativeResult[];
  outputPatches: RaAppOutputPatch[];
}

/**
 * Manages the lifecycle of RA-App pending approvals:
 * save → approve/cancel → execute → store result.
 */
@Injectable()
export class RAAppHITLService {
  private readonly logger = new Logger(RAAppHITLService.name);

  constructor(
    private readonly drizzle: DrizzleService,
    private readonly nativeRegistry: NativeSystemRegistry,
    private readonly audit: AuditService,
    @Optional() @Inject(HitlPolicyService) private readonly hitlPolicy: HitlPolicyService | null,
  ) {}

  async savePendingApprovals(
    toolCallId: string,
    sessionId: string,
    approvals: PendingApproval[],
  ): Promise<SavedApproval[]> {
    const rows = approvals.map((a) => ({
      id: a.id,
      sessionId,
      toolCallId,
      system: a.system,
      args: a.args,
      outputPath: a.outputPath ?? null,
      displayLabel: a.displayLabel,
      status: 'pending' as const,
      result: undefined,
      createdAt: new Date(),
    }));

    if (rows.length === 0) return [];

    await this.drizzle.db.insert(raappPendingApprovals).values(rows);
    this.logger.log(
      `Saved ${rows.length} pending approvals for toolCallId=${toolCallId} session=${sessionId}`,
    );

    return rows.map((r) => ({ ...r, outputPath: r.outputPath ?? undefined }));
  }

  async executeApproved(
    requestIds: string[],
    sessionId: string,
  ): Promise<ApproveResult[]> {
    if (requestIds.length === 0) return [];

    const pending = await this.drizzle.db
      .select()
      .from(raappPendingApprovals)
      .where(
        and(
          inArray(raappPendingApprovals.id, requestIds),
          eq(raappPendingApprovals.sessionId, sessionId),
          eq(raappPendingApprovals.status, 'pending'),
        ),
      );

    if (pending.length === 0) {
      this.logger.warn(`No pending approvals found for ids=[${requestIds.join(',')}] session=${sessionId}`);
      return [];
    }

    const sessionCtx: NativeSessionContext = { sessionId };
    const results: ApproveResult[] = [];

    for (const row of pending) {
      try {
        const result = await this.nativeRegistry.executeApproved(
          row.system,
          (row.args as Record<string, unknown>),
          sessionCtx,
        );

        await this.drizzle.db
          .update(raappPendingApprovals)
          .set({ status: 'executed', result: result as Record<string, unknown> })
          .where(eq(raappPendingApprovals.id, row.id));

        void this.audit.log({
          sessionId,
          type: 'raapp_native_approved',
          label: `raapp:approved ${row.system}`,
          data: { system: row.system, approvalId: row.id, result: result as Record<string, unknown> },
        });

        results.push({ id: row.id, system: row.system, toolCallId: row.toolCallId, status: 'executed', result });
        this.logger.log(`Approval executed: ${row.system} id=${row.id} session=${sessionId}`);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        this.logger.error(`Approval execution failed: ${row.system} id=${row.id} — ${message}`, err);

        await this.drizzle.db
          .update(raappPendingApprovals)
          .set({ status: 'error', result: { error: message } })
          .where(eq(raappPendingApprovals.id, row.id));

        results.push({ id: row.id, system: row.system, toolCallId: row.toolCallId, status: 'error', error: message });
      }
    }

    return results;
  }

  async resolvePendingApprovals(
    toolCallId: string,
    sessionId: string,
    approvals: PendingApproval[],
    abortSignal?: AbortSignal,
  ): Promise<ResolvePendingApprovalsResult> {
    if (approvals.length === 0) {
      return {
        pendingApprovals: [],
        nativeResults: [],
        outputPatches: [],
      };
    }

    const shouldAutoExecute = await this.shouldAutoExecuteBatch(toolCallId, sessionId, approvals, abortSignal);
    await this.savePendingApprovals(toolCallId, sessionId, approvals);

    if (!shouldAutoExecute) {
      return {
        pendingApprovals: approvals.map((approval) => ({
          id: approval.id,
          system: approval.system,
          displayLabel: approval.displayLabel,
          args: approval.args,
        })),
        nativeResults: [],
        outputPatches: [],
      };
    }

    const results = await this.executeApproved(
      approvals.map((approval) => approval.id),
      sessionId,
    );
    const outputPatches = this.buildOutputPatches(approvals, results);

    return {
      pendingApprovals: [],
      nativeResults: results.map((result) => ({
        id: result.id,
        system: result.system,
        status: result.status,
        result: result.result,
        error: result.error,
      })),
      outputPatches,
    };
  }

  async cancelApprovals(requestIds: string[], sessionId: string): Promise<{ toolCallId: string }> {
    if (requestIds.length === 0) return { toolCallId: '' };

    // Fetch first row before updating so we can return toolCallId
    const first = await this.drizzle.db
      .select({ toolCallId: raappPendingApprovals.toolCallId })
      .from(raappPendingApprovals)
      .where(
        and(
          inArray(raappPendingApprovals.id, requestIds),
          eq(raappPendingApprovals.sessionId, sessionId),
        ),
      )
      .limit(1);

    await this.drizzle.db
      .update(raappPendingApprovals)
      .set({ status: 'cancelled' })
      .where(
        and(
          inArray(raappPendingApprovals.id, requestIds),
          eq(raappPendingApprovals.sessionId, sessionId),
          eq(raappPendingApprovals.status, 'pending'),
        ),
      );

    this.logger.log(`Cancelled ${requestIds.length} approvals session=${sessionId}`);
    return { toolCallId: first[0]?.toolCallId ?? '' };
  }

  async getPendingForSession(sessionId: string): Promise<SavedApproval[]> {
    const rows = await this.drizzle.db
      .select()
      .from(raappPendingApprovals)
      .where(
        and(
          eq(raappPendingApprovals.sessionId, sessionId),
          eq(raappPendingApprovals.status, 'pending'),
        ),
      );

    return rows.map((r) => ({
      id: r.id,
      sessionId: r.sessionId,
      toolCallId: r.toolCallId,
      system: r.system,
      args: r.args as Record<string, unknown>,
      outputPath: r.outputPath ?? undefined,
      displayLabel: r.displayLabel,
      status: r.status as SavedApproval['status'],
      result: r.result as Record<string, unknown> | undefined,
      createdAt: r.createdAt instanceof Date ? r.createdAt : new Date(r.createdAt as unknown as number),
    }));
  }

  private async shouldAutoExecuteBatch(
    toolCallId: string,
    sessionId: string,
    approvals: PendingApproval[],
    abortSignal?: AbortSignal,
  ): Promise<boolean> {
    if (!this.hitlPolicy) {
      return false;
    }

    const resolutions = await Promise.all(
      approvals.map((approval) => this.hitlPolicy!.resolveApproval({
        kind: 'raapp_native',
        sessionId,
        name: approval.system,
        args: approval.args,
        abortSignal,
        displayLabel: approval.displayLabel,
        toolCallId,
      })),
    );

    return resolutions.length > 0 && resolutions.every((resolution) => resolution.status === 'approved');
  }

  private buildOutputPatches(
    approvals: PendingApproval[],
    results: ApproveResult[],
  ): RaAppOutputPatch[] {
    const approvalsById = new Map(approvals.map((approval) => [approval.id, approval]));

    return results.flatMap((result) => {
      const approval = approvalsById.get(result.id);
      if (!approval?.outputPath) {
        return [];
      }

      return [{
        outputPath: approval.outputPath,
        value: result.status === 'executed'
          ? result.result
          : { error: result.error ?? 'Execution failed' },
      }];
    });
  }
}
