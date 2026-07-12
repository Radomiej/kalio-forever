import { Injectable } from '@nestjs/common';
import type { ToolConfirmationRequest } from '@kalio/types';
import { and, eq, sql } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { DrizzleService } from '../../database/drizzle.service';
import { hitlRequests, type HitlRequestRow } from '../../database/schema';

export type HitlRequestKind = 'tool_confirmation' | 'raapp_native' | 'tool_budget';
export type HitlRequestResolution = 'approved' | 'denied' | 'cancelled';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

@Injectable()
export class HitlRequestService {
  constructor(private readonly drizzle: DrizzleService) {}

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
        toolName,
        args,
        timeoutMs: 0,
      }];
    });
  }

  async resolve(id: string, revision: number, status: HitlRequestResolution, outcome?: Record<string, unknown>): Promise<boolean> {
    const now = new Date();
    const result = await this.drizzle.db.update(hitlRequests).set({
      status, outcome: outcome ?? null, revision: sql`${hitlRequests.revision} + 1`, updatedAt: now, resolvedAt: now,
    }).where(and(eq(hitlRequests.id, id), eq(hitlRequests.status, 'pending'), eq(hitlRequests.revision, revision))).run();
    return result.changes === 1;
  }

  async claimApprovedContinuation(id: string, revision: number): Promise<HitlRequestRow | null> {
    const request = await this.getById(id);
    if (
      !request
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
    )).run();
    return result.changes === 1;
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
