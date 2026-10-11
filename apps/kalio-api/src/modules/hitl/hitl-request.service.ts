import { Injectable } from '@nestjs/common';
import type { ToolConfirmationRequest, ToolResult, HostHitlExecutionCommit } from '@kalio/types';
import { and, eq, sql } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { DrizzleService } from '../../database/drizzle.service';
import { hitlRequests, type HitlRequestRow } from '../../database/schema';
import { isProtectedGoalRequest } from '../../common/goal-launch-request-family';
import { commitOrdinaryContinuationCancellationBatch, type OrdinaryCancellationBatchInput,
  type OrdinaryCancellationResult } from '../../database/ordinary-continuation-cancellation';

export type HitlRequestKind = 'tool_confirmation' | 'raapp_native' | 'tool_budget';
export type HitlRequestResolution = 'approved' | 'denied' | 'cancelled';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasHostRequirement(row: HitlRequestRow): boolean {
  return row.continuation !== null && typeof row.continuation === 'object'
    && Object.hasOwn(row.continuation, 'hostConfirmationRequirement');
}

function assertHostScope(row: HitlRequestRow, originRequired: boolean): void {
  const cursor = row.continuation;
  const requirement = cursor?.['hostConfirmationRequirement'];
  if (!isRecord(cursor) || !isRecord(requirement) || Object.keys(requirement).length !== 3
    || requirement['kind'] !== 'human_only' || requirement['toolName'] !== 'terminal_spawn'
    || !row.toolCallId || requirement['callId'] !== row.toolCallId || row.kind !== 'tool_confirmation'
    || row.payload?.['toolName'] !== 'terminal_spawn' || !row.sessionId || !row.turnId || !row.runId
    || !Number.isSafeInteger(row.revision) || row.revision < 1
    || cursor['sessionId'] !== row.sessionId || cursor['turnId'] !== row.turnId || cursor['runId'] !== row.runId
    || typeof cursor['promptMessageId'] !== 'string' || !cursor['promptMessageId'].trim()) throw new Error('HOST_CONFIRMATION_INVALID');
  if (!originRequired) return;
  const origin = cursor['approvalOrigin'];
  if (!isRecord(origin) || Object.keys(origin).length !== 7 || origin['schemaVersion'] !== 1
    || origin['kind'] !== 'gateway_tool_confirm' || origin['requestId'] !== row.id
    || origin['sessionId'] !== row.sessionId || origin['toolCallId'] !== row.toolCallId
    || typeof origin['socketId'] !== 'string' || !origin['socketId'].trim()
    || typeof origin['approvedFromRevision'] !== 'number' || !Number.isSafeInteger(origin['approvedFromRevision'])
    || origin['approvedFromRevision'] < 1 || origin['approvedFromRevision'] >= row.revision) throw new Error('HOST_CONFIRMATION_INVALID');
}

@Injectable()
export class HitlRequestService {
  constructor(private readonly drizzle: DrizzleService) {}

  /** Ordinary pending rows only; never authority to cancel the protected goal family. */
  async cancelOrdinaryContinuationsRequired(input: OrdinaryCancellationBatchInput): Promise<OrdinaryCancellationResult> {
    return commitOrdinaryContinuationCancellationBatch(this.drizzle.db, input);
  }

  async create(input: {
    id?: string;
    kind: HitlRequestKind;
    sessionId: string;
    turnId?: string;
    runId?: string;
    toolCallId?: string;
    payload: Record<string, unknown>;
    continuation?: Record<string, unknown>;
  }): Promise<HitlRequestRow> {
    const now = new Date();
    const { id: requestedId, ...values } = input;
    const id = requestedId ?? nanoid();
    await this.drizzle.db.insert(hitlRequests).values({ id, ...values, revision: 1, createdAt: now, updatedAt: now });
    return this.getRequired(id);
  }

  async listPending(sessionId: string): Promise<HitlRequestRow[]> {
    return this.drizzle.db.select().from(hitlRequests)
      .where(and(eq(hitlRequests.sessionId, sessionId), eq(hitlRequests.status, 'pending')));
  }

  async listPendingToolConfirmations(sessionId: string): Promise<ToolConfirmationRequest[]> {
    const requests = await this.listPending(sessionId);
    return requests.flatMap((request) => {
      // Goal approval has a separate protected projection. Keep raw listPending
      // unchanged so preparing/malformed requests remain cancellable by Stop.
      if (isProtectedGoalRequest(request)) return [];
      if (request.kind !== 'tool_confirmation' || !request.toolCallId || !isRecord(request.payload)) {
        return [];
      }
      const { toolName, args } = request.payload;
      if (typeof toolName !== 'string' || !isRecord(args)) {
        return [];
      }
      return [{
        requestId: request.id,
        toolCallId: request.toolCallId,
        sessionId: request.sessionId,
        ...(request.turnId ? { turnId: request.turnId } : {}),
        ...(isRecord(request.continuation) && typeof request.continuation['promptMessageId'] === 'string'
          ? { promptMessageId: request.continuation['promptMessageId'] } : {}),
        toolName,
        args,
        timeoutMs: 0,
      }];
    });
  }

  async resolve(id: string, revision: number, status: HitlRequestResolution, outcome?: Record<string, unknown>): Promise<boolean> {
    if (status === 'approved') {
      const row = await this.getById(id);
      if (row && hasHostRequirement(row)) return false;
    }
    const now = new Date();
    const result = await this.drizzle.db.update(hitlRequests).set({
      status, outcome: outcome ?? null, revision: sql`${hitlRequests.revision} + 1`, updatedAt: now, resolvedAt: now,
    }).where(and(eq(hitlRequests.id, id), eq(hitlRequests.status, 'pending'), eq(hitlRequests.revision, revision),
      ...(status === 'approved' ? [sql`json_type(${hitlRequests.continuation}, '$.hostConfirmationRequirement') IS NULL`] : []))).run();
    return result.changes === 1;
  }

  async claimApprovedContinuation(id: string, revision: number): Promise<HitlRequestRow | null> {
    const request = await this.getById(id);
    if (
      !request
      || hasHostRequirement(request)
      || request.status !== 'approved'
      || request.revision !== revision
      || !isRecord(request.continuation)
      || request.continuation['executionState'] !== 'pending'
    ) {
      return null;
    }

    const now = new Date();
    const result = await this.drizzle.db.update(hitlRequests).set({
      continuation: { ...request.continuation, executionState: 'claimed' },
      revision: sql`${hitlRequests.revision} + 1`,
      updatedAt: now,
    }).where(and(
      eq(hitlRequests.id, id),
      eq(hitlRequests.status, 'approved'),
      eq(hitlRequests.revision, revision),
      sql`json_type(${hitlRequests.continuation}, '$.hostConfirmationRequirement') IS NULL`,
    )).run();
    return result.changes === 1 ? this.getRequired(id) : null;
  }

  async markContinuationToolResult(
    id: string,
    revision: number,
    outcome: Record<string, unknown>,
  ): Promise<boolean> {
    const request = await this.getById(id);
    if (
      !request
      || hasHostRequirement(request)
      || request.status !== 'approved'
      || request.revision !== revision
      || !isRecord(request.continuation)
      || request.continuation['executionState'] !== 'claimed'
    ) {
      return false;
    }

    const now = new Date();
    const result = await this.drizzle.db.update(hitlRequests).set({
      continuation: { ...request.continuation, executionState: 'tool_result_committed' },
      outcome,
      revision: sql`${hitlRequests.revision} + 1`,
      updatedAt: now,
    }).where(and(
      eq(hitlRequests.id, id),
      eq(hitlRequests.status, 'approved'),
      eq(hitlRequests.revision, revision),
      sql`json_type(${hitlRequests.continuation}, '$.hostConfirmationRequirement') IS NULL`,
    )).run();
    return result.changes === 1;
  }

  /** Commit and read back within one synchronous SQLite transaction. Legacy boolean API is unchanged. */
  async markContinuationToolResultRequired(id: string, claimedRevision: number, outcome: { status: ToolResult['status'] }): Promise<HostHitlExecutionCommit> {
    try {
      if (!id || !Number.isSafeInteger(claimedRevision) || claimedRevision < 1
        || !['success', 'error', 'cancelled'].includes(outcome.status)) throw new Error('invalid');
      return this.drizzle.db.transaction(tx => {
        const request = tx.select().from(hitlRequests).where(eq(hitlRequests.id, id)).get();
        if (!request || request.kind !== 'tool_confirmation' || request.status !== 'approved' || request.revision !== claimedRevision
          || !isRecord(request.continuation) || request.continuation['executionState'] !== 'claimed') throw new Error('conflict');
        const gated = hasHostRequirement(request);
        if (gated) assertHostScope(request, true);
        const changed = tx.update(hitlRequests).set({
          continuation: { ...request.continuation, executionState: 'tool_result_committed' },
          outcome: { status: outcome.status }, revision: sql`${hitlRequests.revision} + 1`, updatedAt: new Date(),
        }).where(and(eq(hitlRequests.id, id), eq(hitlRequests.status, 'approved'), eq(hitlRequests.revision, claimedRevision),
          sql`json_extract(${hitlRequests.continuation}, '$.executionState') = 'claimed'`)).run();
        if (changed.changes !== 1) throw new Error('conflict');
        const row = tx.select().from(hitlRequests).where(eq(hitlRequests.id, id)).get();
        if (!row || row.kind !== 'tool_confirmation' || row.status !== 'approved' || !Number.isSafeInteger(row.revision) || row.revision <= claimedRevision
          || !isRecord(row.continuation) || row.continuation['executionState'] !== 'tool_result_committed'
          || !isRecord(row.outcome) || row.outcome['status'] !== outcome.status) throw new Error('readback');
        if (JSON.stringify(row.continuation) !== JSON.stringify({ ...request.continuation, executionState: 'tool_result_committed' })) throw new Error('readback');
        if (gated) {
          assertHostScope(row, true);
          if (row.sessionId !== request.sessionId || row.toolCallId !== request.toolCallId || row.runId !== request.runId || row.turnId !== request.turnId
            || JSON.stringify(row.continuation?.['approvalOrigin']) !== JSON.stringify(request.continuation['approvalOrigin'])
            || JSON.stringify(row.continuation?.['hostConfirmationRequirement']) !== JSON.stringify(request.continuation['hostConfirmationRequirement'])) throw new Error('readback');
        }
        const commit: HostHitlExecutionCommit = { requestId: row.id, claimedRevision, committedRevision: row.revision,
          status: 'approved', executionState: 'tool_result_committed', resultStatus: outcome.status };
        const continuation = { ...row.continuation, hostExecutionCommit: commit };
        // Same transaction: store the actual readback revision, never infer either revision on restart.
        const stored = tx.update(hitlRequests).set({ continuation }).where(and(eq(hitlRequests.id, id),
          eq(hitlRequests.status, 'approved'), eq(hitlRequests.revision, row.revision),
          sql`json_extract(${hitlRequests.continuation}, '$.executionState') = 'tool_result_committed'`)).run();
        if (stored.changes !== 1) throw new Error('conflict');
        const final = tx.select().from(hitlRequests).where(eq(hitlRequests.id, id)).get();
        if (!final || final.id !== request.id || final.kind !== request.kind || final.status !== 'approved'
          || final.revision !== commit.committedRevision || final.sessionId !== request.sessionId
          || final.turnId !== request.turnId || final.runId !== request.runId || final.toolCallId !== request.toolCallId
          || JSON.stringify(final.payload) !== JSON.stringify(request.payload)
          || JSON.stringify(final.continuation) !== JSON.stringify(continuation)
          || JSON.stringify(final.outcome) !== JSON.stringify({ status: commit.resultStatus })) throw new Error('readback');
        return Object.freeze(commit);
      });
    } catch { throw new Error('HITL_EXECUTION_COMMIT_FAILED'); }
  }

  /** Only the membership-checked socket gateway calls this; origin is constructed here, not supplied by a client. */
  async resolveHostConfirmationFromGateway(id: string, expectedRevision: number, sessionId: string, socketId: string, message?: string): Promise<boolean> {
    try {
      if (!socketId.trim() || !sessionId.trim() || !Number.isSafeInteger(expectedRevision) || expectedRevision < 1) return false;
      return this.drizzle.db.transaction(tx => {
        const row = tx.select().from(hitlRequests).where(eq(hitlRequests.id, id)).get();
        if (!row || !hasHostRequirement(row) || row.status !== 'pending' || row.revision !== expectedRevision || row.sessionId !== sessionId
          || row.continuation?.['executionState'] !== 'pending') return false;
        assertHostScope(row, false);
        if (Object.hasOwn(row.continuation!, 'approvalOrigin')) return false;
        const origin = { schemaVersion: 1, kind: 'gateway_tool_confirm', requestId: row.id, sessionId: row.sessionId,
          toolCallId: row.toolCallId, socketId, approvedFromRevision: row.revision };
        const now = new Date();
        const changed = tx.update(hitlRequests).set({ status: 'approved', revision: sql`${hitlRequests.revision} + 1`,
          continuation: { ...row.continuation, approvalOrigin: origin }, outcome: message ? { message } : null, updatedAt: now, resolvedAt: now,
        }).where(and(eq(hitlRequests.id, id), eq(hitlRequests.sessionId, sessionId), eq(hitlRequests.status, 'pending'), eq(hitlRequests.revision, expectedRevision))).run();
        if (changed.changes !== 1) throw new Error('conflict');
        const approved = tx.select().from(hitlRequests).where(eq(hitlRequests.id, id)).get();
        if (!approved || approved.status !== 'approved' || approved.revision <= expectedRevision || approved.sessionId !== sessionId
          || approved.toolCallId !== row.toolCallId || approved.runId !== row.runId || approved.turnId !== row.turnId
          || JSON.stringify(approved.continuation?.['approvalOrigin']) !== JSON.stringify(origin)
          || JSON.stringify(approved.continuation?.['hostConfirmationRequirement']) !== JSON.stringify(row.continuation!['hostConfirmationRequirement'])) throw new Error('readback');
        assertHostScope(approved, true);
        return true;
      });
    } catch { throw new Error('HOST_CONFIRMATION_PERSISTENCE_FAILED'); }
  }

  async claimApprovedHostContinuation(id: string, expectedRevision: number, sessionId: string, toolCallId: string): Promise<HitlRequestRow | null> {
    try {
      return this.drizzle.db.transaction(tx => {
        const row = tx.select().from(hitlRequests).where(eq(hitlRequests.id, id)).get();
        if (!row || !hasHostRequirement(row) || row.status !== 'approved' || row.revision !== expectedRevision
          || row.sessionId !== sessionId || row.toolCallId !== toolCallId || row.continuation?.['executionState'] !== 'pending') return null;
        assertHostScope(row, true);
        const changed = tx.update(hitlRequests).set({ continuation: { ...row.continuation, executionState: 'claimed' },
          revision: sql`${hitlRequests.revision} + 1`, updatedAt: new Date(),
        }).where(and(eq(hitlRequests.id, id), eq(hitlRequests.status, 'approved'), eq(hitlRequests.revision, expectedRevision),
          eq(hitlRequests.sessionId, sessionId), eq(hitlRequests.toolCallId, toolCallId),
          sql`json_extract(${hitlRequests.continuation}, '$.executionState') = 'pending'`)).run();
        if (changed.changes !== 1) throw new Error('conflict');
        const claimed = tx.select().from(hitlRequests).where(eq(hitlRequests.id, id)).get();
        if (!claimed || claimed.status !== 'approved' || !Number.isSafeInteger(claimed.revision) || claimed.revision <= expectedRevision
          || claimed.sessionId !== sessionId || claimed.toolCallId !== toolCallId || claimed.runId !== row.runId || claimed.turnId !== row.turnId
          || claimed.continuation?.['executionState'] !== 'claimed'
          || JSON.stringify(claimed.continuation['approvalOrigin']) !== JSON.stringify(row.continuation!['approvalOrigin'])
          || JSON.stringify(claimed.continuation['hostConfirmationRequirement']) !== JSON.stringify(row.continuation!['hostConfirmationRequirement'])) throw new Error('readback');
        assertHostScope(claimed, true);
        return structuredClone(claimed);
      });
    } catch { throw new Error('HOST_CONFIRMATION_CLAIM_FAILED'); }
  }

  async getById(id: string): Promise<HitlRequestRow | null> {
    const [row] = await this.drizzle.db.select().from(hitlRequests).where(eq(hitlRequests.id, id)).limit(1);
    return row ?? null;
  }

  private async getRequired(id: string): Promise<HitlRequestRow> {
    const row = await this.getById(id);
    if (!row) throw new Error(`HITL request not found: ${id}`);
    return row;
  }
}
