import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { nanoid } from 'nanoid';
import { and, desc, eq, inArray } from 'drizzle-orm';
import type { ChatRunPhase, ChatRunSnapshot, ChatRunStatus } from '@kalio/types';
import { DrizzleService } from '../../database/drizzle.service';
import { chatRuns, type ChatRunRow } from '../../database/schema';

const ACTIVE_STATUSES: ChatRunStatus[] = ['active'];
const CURRENT_STATUSES: ChatRunStatus[] = ['active', 'interrupted_needs_retry'];
const SAFE_LLM_PHASES = new Set<ChatRunPhase>(['queued', 'started', 'llm_streaming']);

interface StartRunInput {
  sessionId: string;
  turnId: string;
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
      retryCount: 0,
      safeResume: false,
      startedAt: now,
      updatedAt: now,
      lastHeartbeatAt: now,
    });

    return this.getRun(id);
  }

  async checkpoint(id: string, patch: CheckpointInput): Promise<void> {
    const now = new Date();
    const set: Record<string, unknown> = {
      updatedAt: now,
      lastHeartbeatAt: now,
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

  async complete(id: string): Promise<void> {
    const now = new Date();
    await this.drizzle.db
      .update(chatRuns)
      .set({
        phase: 'completed',
        status: 'completed',
        safeResume: false,
        updatedAt: now,
        lastHeartbeatAt: now,
        completedAt: now,
      })
      .where(eq(chatRuns.id, id));
  }

  async interrupt(id: string, message: string): Promise<void> {
    const now = new Date();
    await this.drizzle.db
      .update(chatRuns)
      .set({
        phase: 'interrupted',
        status: 'interrupted',
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

  private toSnapshot(row: ChatRunRow): ChatRunSnapshot {
    return {
      id: row.id,
      sessionId: row.sessionId,
      turnId: row.turnId,
      phase: row.phase,
      status: row.status,
      provider: row.provider ?? undefined,
      model: row.model ?? undefined,
      retryCount: row.retryCount,
      safeResume: row.safeResume,
      errorCode: row.errorCode ?? undefined,
      errorMessage: row.errorMessage ?? undefined,
      startedAt: row.startedAt.getTime(),
      updatedAt: row.updatedAt.getTime(),
      lastHeartbeatAt: row.lastHeartbeatAt.getTime(),
      completedAt: row.completedAt?.getTime(),
    };
  }
}
