import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { nanoid } from 'nanoid';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import type { ChatQueuedPayload, ChatRunPhase, ChatRunSnapshot, ChatRunStatus } from '@kalio/types';
import { DrizzleService } from '../../database/drizzle.service';
import { chatRuns, type ChatRunRow } from '../../database/schema';

const ACTIVE_STATUSES: ChatRunStatus[] = ['active'];
const CURRENT_STATUSES: ChatRunStatus[] = ['active', 'waiting_for_human', 'interrupted_needs_retry'];
const NON_REPLAYABLE_HISTORY_STATUSES: ChatRunStatus[] = ['failed', 'cancelled', 'interrupted'];
const SAFE_LLM_PHASES = new Set<ChatRunPhase>(['queued', 'started', 'llm_streaming']);

interface StartRunInput {
  sessionId: string;
  turnId: string;
  provider?: string;
  model?: string;
}

interface AcceptQueuedRunInput {
  sessionId: string;
  turnId: string;
  queueIdempotencyKey: string;
  queuedPayload: ChatQueuedPayload;
  provider?: string;
  model?: string;
}

interface CheckpointInput {
  phase?: ChatRunPhase;
  status?: ChatRunStatus;
  provider?: string;
  model?: string;
  retryCount?: number;
  safeResume?: boolean;
  errorCode?: string | null;
  errorMessage?: string | null;
}

@Injectable()
export class RunJournalService implements OnModuleInit {
  private readonly logger = new Logger(RunJournalService.name);
  private readonly completedListeners = new Set<(run: ChatRunSnapshot) => void | Promise<void>>();

  constructor(private readonly drizzle: DrizzleService) {}

  async onModuleInit(): Promise<void> {
    await this.recoverStaleActiveRuns();
  }

  async startRun(input: StartRunInput): Promise<ChatRunSnapshot> {
    const now = new Date();
    const id = nanoid();
    await this.drizzle.db.insert(chatRuns).values({
      id,
      sessionId: input.sessionId,
      turnId: input.turnId,
      phase: 'started',
      status: 'active',
      provider: input.provider ?? null,
      model: input.model ?? null,
      revision: 1,
      retryCount: 0,
      safeResume: false,
      startedAt: now,
      updatedAt: now,
      lastHeartbeatAt: now,
    });

    return this.getRun(id);
  }

  async acceptQueuedRun(input: AcceptQueuedRunInput): Promise<ChatRunSnapshot> {
    const now = new Date();
    const id = nanoid();
    await this.drizzle.db.insert(chatRuns).values({
      id,
      sessionId: input.sessionId,
      turnId: input.turnId,
      phase: 'queued',
      status: 'queued',
      provider: input.provider ?? null,
      model: input.model ?? null,
      revision: 1,
      retryCount: 0,
      safeResume: false,
      queueIdempotencyKey: input.queueIdempotencyKey,
      queuedPayload: input.queuedPayload,
      queuedAt: now,
      startedAt: now,
      updatedAt: now,
      lastHeartbeatAt: now,
    }).onConflictDoNothing({
      target: [chatRuns.sessionId, chatRuns.queueIdempotencyKey],
    });

    const existing = await this.getRunByQueueKey(input.sessionId, input.queueIdempotencyKey);
    if (!existing) {
      throw new Error(`Queued chat run not found after accept: ${input.sessionId}/${input.queueIdempotencyKey}`);
    }
    return existing;
  }

  async findRunByQueueKey(sessionId: string, queueIdempotencyKey: string): Promise<ChatRunSnapshot | null> {
    return this.getRunByQueueKey(sessionId, queueIdempotencyKey);
  }

  async checkpoint(id: string, patch: CheckpointInput): Promise<void> {
    const now = new Date();
    const set: Record<string, unknown> = {
      updatedAt: now,
      lastHeartbeatAt: now,
      revision: sql`${chatRuns.revision} + 1`,
    };

    if (patch.phase !== undefined) set['phase'] = patch.phase;
    if (patch.status !== undefined) set['status'] = patch.status;
    if (patch.provider !== undefined) set['provider'] = patch.provider;
    if (patch.model !== undefined) set['model'] = patch.model;
    if (patch.retryCount !== undefined) set['retryCount'] = patch.retryCount;
    if (patch.safeResume !== undefined) set['safeResume'] = patch.safeResume;
    if (patch.errorCode !== undefined) set['errorCode'] = patch.errorCode;
    if (patch.errorMessage !== undefined) set['errorMessage'] = patch.errorMessage;

    await this.drizzle.db.update(chatRuns).set(set).where(eq(chatRuns.id, id));
  }

  async claimQueuedRun(sessionId: string, runId?: string): Promise<ChatRunSnapshot | null> {
    for (;;) {
      const [candidate] = await this.drizzle.db
        .select()
        .from(chatRuns)
        .where(and(
          eq(chatRuns.sessionId, sessionId),
          eq(chatRuns.status, 'queued'),
          ...(runId ? [eq(chatRuns.id, runId)] : []),
        ))
        .orderBy(asc(chatRuns.queuedAt), asc(sql`rowid`))
        .limit(1);

      if (!candidate) {
        return null;
      }

      const now = new Date();
      const result = await this.drizzle.db
        .update(chatRuns)
        .set({
          phase: 'started',
          status: 'active',
          revision: sql`${chatRuns.revision} + 1`,
          queueClaimedAt: now,
          updatedAt: now,
          lastHeartbeatAt: now,
        })
        .where(and(
          eq(chatRuns.id, candidate.id),
          eq(chatRuns.status, 'queued'),
          eq(chatRuns.revision, candidate.revision),
        ))
        .run();

      if (result.changes === 1) {
        return this.getRun(candidate.id);
      }
    }
  }

  async listQueuedRuns(sessionId: string): Promise<ChatRunSnapshot[]> {
    const rows = await this.drizzle.db
      .select()
      .from(chatRuns)
      .where(and(
        eq(chatRuns.sessionId, sessionId),
        eq(chatRuns.status, 'queued'),
      ))
      .orderBy(asc(chatRuns.queuedAt), asc(sql`rowid`));
    return rows.map((row) => this.toSnapshot(row));
  }

  async cancelQueuedRun(id: string, expectedRevision?: number): Promise<boolean> {
    const now = new Date();
    const clauses = [
      eq(chatRuns.id, id),
      eq(chatRuns.status, 'queued'),
    ];
    if (expectedRevision !== undefined) {
      clauses.push(eq(chatRuns.revision, expectedRevision));
    }

    const result = await this.drizzle.db
      .update(chatRuns)
      .set({
        status: 'cancelled',
        revision: sql`${chatRuns.revision} + 1`,
        queueCancelledAt: now,
        updatedAt: now,
        lastHeartbeatAt: now,
        completedAt: now,
      })
      .where(and(...clauses))
      .run();

    if (result.changes === 1) {
      return true;
    }

    const [row] = await this.drizzle.db
      .select({ status: chatRuns.status })
      .from(chatRuns)
      .where(eq(chatRuns.id, id))
      .limit(1);
    return row?.status === 'cancelled';
  }

  async complete(id: string, outcome?: ChatRunSnapshot['outcome']): Promise<void> {
    const now = new Date();
    await this.drizzle.db
      .update(chatRuns)
      .set({
        phase: 'completed',
        status: 'completed',
        revision: sql`${chatRuns.revision} + 1`,
        safeResume: false,
        errorCode: null,
        errorMessage: null,
        outcome,
        updatedAt: now,
        lastHeartbeatAt: now,
        completedAt: now,
      })
      .where(eq(chatRuns.id, id));
    const completed = await this.getRun(id);
    for (const listener of this.completedListeners) {
      void Promise.resolve(listener(completed)).catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.error(`Completed-run listener failed for ${id}: ${message}`);
      });
    }
  }

  subscribeCompleted(listener: (run: ChatRunSnapshot) => void | Promise<void>): () => void {
    this.completedListeners.add(listener);
    return () => this.completedListeners.delete(listener);
  }

  async getCompletedTurn(sessionId: string, turnId: string): Promise<ChatRunSnapshot | null> {
    const [row] = await this.drizzle.db
      .select()
      .from(chatRuns)
      .where(and(
        eq(chatRuns.sessionId, sessionId),
        eq(chatRuns.turnId, turnId),
        eq(chatRuns.status, 'completed'),
      ))
      .orderBy(desc(chatRuns.updatedAt), desc(sql`rowid`))
      .limit(1);
    return row ? this.toSnapshot(row) : null;
  }

  async getLatestCompletedForSession(sessionId: string): Promise<ChatRunSnapshot | null> {
    const [row] = await this.drizzle.db
      .select()
      .from(chatRuns)
      .where(and(eq(chatRuns.sessionId, sessionId), eq(chatRuns.status, 'completed')))
      .orderBy(desc(chatRuns.updatedAt), desc(sql`rowid`))
      .limit(1);
    return row ? this.toSnapshot(row) : null;
  }

  async claimChildContinuation(id: string, expectedRevision: number): Promise<boolean> {
    const now = new Date();
    const result = await this.drizzle.db
      .update(chatRuns)
      .set({
        phase: 'llm_streaming',
        status: 'active',
        revision: sql`${chatRuns.revision} + 1`,
        safeResume: true,
        errorCode: null,
        errorMessage: null,
        updatedAt: now,
        lastHeartbeatAt: now,
        completedAt: null,
      })
      .where(and(
        eq(chatRuns.id, id),
        eq(chatRuns.status, 'interrupted_needs_retry'),
        eq(chatRuns.safeResume, true),
        eq(chatRuns.revision, expectedRevision),
      ))
      .run();
    return result.changes === 1;
  }

  async getTurn(sessionId: string, turnId: string): Promise<ChatRunSnapshot | null> {
    const [row] = await this.drizzle.db.select().from(chatRuns).where(and(
      eq(chatRuns.sessionId, sessionId), eq(chatRuns.turnId, turnId),
    )).orderBy(desc(chatRuns.updatedAt)).limit(1);
    return row ? this.toSnapshot(row) : null;
  }

  async interrupt(id: string, message: string): Promise<void> {
    const now = new Date();
    await this.drizzle.db
      .update(chatRuns)
      .set({
        phase: 'interrupted',
        status: 'interrupted',
        revision: sql`${chatRuns.revision} + 1`,
        safeResume: false,
        errorCode: 'INTERRUPTED',
        errorMessage: message,
        updatedAt: now,
        lastHeartbeatAt: now,
        completedAt: now,
      })
      .where(eq(chatRuns.id, id));
  }

  async fail(id: string, errorCode: string, errorMessage: string): Promise<void> {
    const now = new Date();
    await this.drizzle.db
      .update(chatRuns)
      .set({
        phase: 'failed',
        status: 'failed',
        revision: sql`${chatRuns.revision} + 1`,
        safeResume: false,
        errorCode,
        errorMessage,
        updatedAt: now,
        lastHeartbeatAt: now,
        completedAt: now,
      })
      .where(eq(chatRuns.id, id));
  }

  async getCurrentRun(sessionId: string): Promise<ChatRunSnapshot | null> {
    const [row] = await this.drizzle.db
      .select()
      .from(chatRuns)
      .where(and(eq(chatRuns.sessionId, sessionId), inArray(chatRuns.status, CURRENT_STATUSES)))
      .orderBy(desc(chatRuns.updatedAt))
      .limit(1);

    return row ? this.toSnapshot(row) : null;
  }

  async getNonReplayableTurnIds(sessionIds: string[]): Promise<Set<string>> {
    const uniqueSessionIds = [...new Set(sessionIds.filter(Boolean))];
    if (uniqueSessionIds.length === 0) return new Set();

    const rows = await this.drizzle.db
      .select({ turnId: chatRuns.turnId })
      .from(chatRuns)
      .where(and(
        inArray(chatRuns.sessionId, uniqueSessionIds),
        inArray(chatRuns.status, NON_REPLAYABLE_HISTORY_STATUSES),
      ));

    return new Set(rows.map((row) => row.turnId));
  }

  async listSafeRecoverableRuns(): Promise<ChatRunSnapshot[]> {
    const rows = await this.drizzle.db
      .select()
      .from(chatRuns)
      .where(and(
        eq(chatRuns.status, 'interrupted_needs_retry'),
        eq(chatRuns.safeResume, true),
      ))
      .orderBy(desc(chatRuns.updatedAt));
    return rows.map((row) => this.toSnapshot(row));
  }

  async recoverStaleActiveRuns(): Promise<void> {
    const activeRows = await this.drizzle.db
      .select()
      .from(chatRuns)
      .where(inArray(chatRuns.status, ACTIVE_STATUSES));

    if (activeRows.length === 0) {
      return;
    }

    const now = new Date();
    await Promise.all(activeRows.map(async (row) => {
      const safeResume = SAFE_LLM_PHASES.has(row.phase);
      await this.drizzle.db
        .update(chatRuns)
        .set({
          status: 'interrupted_needs_retry',
          revision: sql`${chatRuns.revision} + 1`,
          safeResume,
          errorCode: 'BACKEND_RESTART',
          errorMessage: safeResume
            ? 'Backend restarted during LLM streaming. Resume is safe because no tool was running.'
            : 'Backend restarted while a tool was running. Retry manually to avoid duplicate tool execution.',
          updatedAt: now,
          lastHeartbeatAt: now,
        })
        .where(eq(chatRuns.id, row.id));
    }));

    this.logger.warn(`Recovered ${activeRows.length} stale active chat run(s) after restart`);
  }

  private async getRun(id: string): Promise<ChatRunSnapshot> {
    const [row] = await this.drizzle.db.select().from(chatRuns).where(eq(chatRuns.id, id)).limit(1);
    if (!row) {
      throw new Error(`Chat run not found: ${id}`);
    }
    return this.toSnapshot(row);
  }

  private async getRunByQueueKey(sessionId: string, queueIdempotencyKey: string): Promise<ChatRunSnapshot | null> {
    const [row] = await this.drizzle.db
      .select()
      .from(chatRuns)
      .where(and(
        eq(chatRuns.sessionId, sessionId),
        eq(chatRuns.queueIdempotencyKey, queueIdempotencyKey),
      ))
      .orderBy(desc(chatRuns.updatedAt), desc(sql`rowid`))
      .limit(1);
    return row ? this.toSnapshot(row) : null;
  }

  private toSnapshot(row: ChatRunRow): ChatRunSnapshot {
    return {
      id: row.id,
      sessionId: row.sessionId,
      turnId: row.turnId,
      phase: row.phase,
      status: row.status,
      provider: row.provider ?? undefined,
      model: row.model ?? undefined,
      revision: row.revision,
      retryCount: row.retryCount,
      safeResume: row.safeResume,
      errorCode: row.errorCode ?? undefined,
      errorMessage: row.errorMessage ?? undefined,
      queueIdempotencyKey: row.queueIdempotencyKey ?? undefined,
      queuedPayload: row.queuedPayload ?? undefined,
      queuedAt: row.queuedAt?.getTime(),
      queueClaimedAt: row.queueClaimedAt?.getTime(),
      queueCancelledAt: row.queueCancelledAt?.getTime(),
      outcome: row.outcome ?? undefined,
      startedAt: row.startedAt.getTime(),
      updatedAt: row.updatedAt.getTime(),
      lastHeartbeatAt: row.lastHeartbeatAt.getTime(),
      completedAt: row.completedAt?.getTime(),
    };
  }
}
