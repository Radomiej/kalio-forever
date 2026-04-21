import { Injectable } from '@nestjs/common';
import { nanoid } from 'nanoid';
import { eq, and } from 'drizzle-orm';
import type {
  AgentLoop,
  AgentTask,
  AgentIteration,
  CreateAgentLoopDto,
  CreateAgentTaskDto,
} from '@kalio/types';
import { DrizzleService } from '../../database/drizzle.service';
import { agentLoops, agentTasks, agentIterations } from '../../database/schema';

@Injectable()
export class AgentLoopService {
  constructor(private readonly drizzle: DrizzleService) {}

  // ── Loops ──────────────────────────────────────────────────────────────────

  async findAllLoops(personaId?: string): Promise<AgentLoop[]> {
    const rows = personaId
      ? await this.drizzle.db.select().from(agentLoops).where(eq(agentLoops.personaId, personaId))
      : await this.drizzle.db.select().from(agentLoops);
    return rows.map(this.toLoop);
  }

  async findLoop(id: string): Promise<AgentLoop | null> {
    const [row] = await this.drizzle.db.select().from(agentLoops).where(eq(agentLoops.id, id));
    return row ? this.toLoop(row) : null;
  }

  async createLoop(dto: CreateAgentLoopDto): Promise<AgentLoop> {
    const id = nanoid();
    const now = new Date();
    const config = {
      mode: dto.mode ?? 'continuous',
      watchdogIntervalMs: (dto.watchdogIntervalMinutes ?? 5) * 60_000,
      maxIterations: dto.maxIterations ?? 1000,
      iterationDelayMs: 1000,
      maxConsecutiveFailures: 5,
    };
    await this.drizzle.db.insert(agentLoops).values({
      id,
      name: dto.name,
      personaId: dto.personaId,
      systemPrompt: dto.systemPrompt ?? '',
      status: 'idle',
      config,
      iterationCount: 0,
      createdAt: now,
      updatedAt: now,
    });
    return this.findLoop(id) as Promise<AgentLoop>;
  }

  async updateLoop(id: string, patch: Partial<typeof agentLoops.$inferInsert>): Promise<void> {
    await this.drizzle.db
      .update(agentLoops)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(agentLoops.id, id));
  }

  async deleteLoop(id: string): Promise<void> {
    await this.drizzle.db.delete(agentLoops).where(eq(agentLoops.id, id));
  }

  // ── Tasks ──────────────────────────────────────────────────────────────────

  async findTasks(loopId: string): Promise<AgentTask[]> {
    const rows = await this.drizzle.db
      .select()
      .from(agentTasks)
      .where(eq(agentTasks.loopId, loopId));
    return rows.map(this.toTask);
  }

  async findTask(id: string): Promise<AgentTask | null> {
    const [row] = await this.drizzle.db.select().from(agentTasks).where(eq(agentTasks.id, id));
    return row ? this.toTask(row) : null;
  }

  async createTask(dto: CreateAgentTaskDto): Promise<AgentTask> {
    const id = nanoid();
    const now = new Date();
    const allTasks = await this.findTasks(dto.loopId);
    const orderIndex = allTasks.length;
    await this.drizzle.db.insert(agentTasks).values({
      id,
      loopId: dto.loopId,
      title: dto.title,
      description: dto.description ?? '',
      priority: dto.priority ?? 0,
      status: 'pending',
      orderIndex,
      createdAt: now,
      updatedAt: now,
    });
    return this.findTask(id) as Promise<AgentTask>;
  }

  async updateTask(id: string, patch: Partial<typeof agentTasks.$inferInsert>): Promise<void> {
    await this.drizzle.db
      .update(agentTasks)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(agentTasks.id, id));
  }

  async getNextPendingTask(loopId: string): Promise<AgentTask | null> {
    const rows = await this.drizzle.db
      .select()
      .from(agentTasks)
      .where(and(eq(agentTasks.loopId, loopId), eq(agentTasks.status, 'pending')));
    if (rows.length === 0) return null;
    rows.sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0) || (a.orderIndex ?? 0) - (b.orderIndex ?? 0));
    return this.toTask(rows[0]!);
  }

  // ── Iterations ─────────────────────────────────────────────────────────────

  async findIterations(loopId: string): Promise<AgentIteration[]> {
    const rows = await this.drizzle.db
      .select()
      .from(agentIterations)
      .where(eq(agentIterations.loopId, loopId));
    return rows.map(this.toIteration);
  }

  async createIteration(data: {
    loopId: string;
    taskId?: string;
    iterationNumber: number;
    action: string;
    promptUsed: string;
    resultSummary: string;
    durationMs: number;
  }): Promise<void> {
    await this.drizzle.db.insert(agentIterations).values({
      id: nanoid(),
      loopId: data.loopId,
      taskId: data.taskId ?? null,
      iterationNumber: data.iterationNumber,
      action: data.action as 'execute_task' | 'pause' | 'resume' | 'error' | 'watchdog',
      promptUsed: data.promptUsed,
      resultSummary: data.resultSummary,
      durationMs: data.durationMs,
      createdAt: new Date(),
    });
  }

  // ── Mappers ────────────────────────────────────────────────────────────────

  private toLoop(row: typeof agentLoops.$inferSelect): AgentLoop {
    return {
      id: row.id,
      name: row.name,
      personaId: row.personaId,
      systemPrompt: row.systemPrompt ?? '',
      status: row.status as AgentLoop['status'],
      config: typeof row.config === 'string' ? JSON.parse(row.config) : row.config,
      currentTaskId: row.currentTaskId ?? undefined,
      chatSessionId: row.chatSessionId ?? undefined,
      iterationCount: row.iterationCount ?? 0,
      createdAt: row.createdAt instanceof Date ? row.createdAt.getTime() : (row.createdAt as number),
      updatedAt: row.updatedAt instanceof Date ? row.updatedAt.getTime() : (row.updatedAt as number),
    };
  }

  private toTask(row: typeof agentTasks.$inferSelect): AgentTask {
    return {
      id: row.id,
      loopId: row.loopId,
      title: row.title,
      description: row.description ?? '',
      priority: row.priority ?? 0,
      status: row.status as AgentTask['status'],
      resultSummary: row.resultSummary ?? undefined,
      orderIndex: row.orderIndex ?? 0,
      createdAt: row.createdAt instanceof Date ? row.createdAt.getTime() : (row.createdAt as number),
      updatedAt: row.updatedAt instanceof Date ? row.updatedAt.getTime() : (row.updatedAt as number),
    };
  }

  private toIteration(row: typeof agentIterations.$inferSelect): AgentIteration {
    return {
      id: row.id,
      loopId: row.loopId,
      taskId: row.taskId ?? undefined,
      iterationNumber: row.iterationNumber,
      action: row.action,
      promptUsed: row.promptUsed ?? '',
      resultSummary: row.resultSummary ?? '',
      durationMs: row.durationMs ?? 0,
      createdAt: row.createdAt instanceof Date ? row.createdAt.getTime() : (row.createdAt as number),
    };
  }
}
