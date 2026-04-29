import { Injectable, NotFoundException } from '@nestjs/common';
import { nanoid } from 'nanoid';
import { eq } from 'drizzle-orm';
import type { AgentLoop, AgentTask, CreateAgentLoopDto, CreateAgentTaskDto } from '@kalio/types';
import { DrizzleService } from '../../database/drizzle.service';
import { agentLoops, agentTasks } from '../../database/schema';

const toMs = (v: number | Date): number => (v instanceof Date ? v.getTime() : v);

@Injectable()
export class AgentLoopService {
  constructor(private readonly drizzle: DrizzleService) {}

  async create(dto: CreateAgentLoopDto): Promise<AgentLoop> {
    const now = new Date();
    const id = nanoid();
    const config = {
      maxIterations: dto.maxIterations ?? 100,
      iterationDelayMs: 1000,
      mode: dto.mode ?? 'continuous',
      maxConsecutiveFailures: 5,
    };
    await this.drizzle.db.insert(agentLoops).values({
      id,
      name: dto.name,
      personaId: dto.personaId,
      systemPrompt: dto.systemPrompt ?? '',
      status: 'idle',
      config,
      createdAt: now,
      updatedAt: now,
    });
    const [row] = await this.drizzle.db.select().from(agentLoops).where(eq(agentLoops.id, id));
    return this.mapLoop(row!);
  }

  async findAll(): Promise<AgentLoop[]> {
    const rows = await this.drizzle.db.select().from(agentLoops);
    return rows.map((r) => this.mapLoop(r));
  }

  async findOne(id: string): Promise<AgentLoop> {
    const [row] = await this.drizzle.db.select().from(agentLoops).where(eq(agentLoops.id, id));
    if (!row) throw new NotFoundException(`Agent loop ${id} not found`);
    return this.mapLoop(row);
  }

  async delete(id: string): Promise<void> {
    const [row] = await this.drizzle.db.select({ id: agentLoops.id }).from(agentLoops).where(eq(agentLoops.id, id));
    if (!row) throw new NotFoundException(`Agent loop ${id} not found`);
    await this.drizzle.db.delete(agentLoops).where(eq(agentLoops.id, id));
  }

  async addTask(loopId: string, dto: CreateAgentTaskDto): Promise<AgentTask> {
    await this.findOne(loopId);
    const now = new Date();
    const id = nanoid();
    await this.drizzle.db.insert(agentTasks).values({
      id,
      loopId,
      title: dto.title,
      description: dto.description ?? '',
      priority: dto.priority ?? 0,
      status: 'pending',
      orderIndex: 0,
      createdAt: now,
      updatedAt: now,
    });
    const [row] = await this.drizzle.db.select().from(agentTasks).where(eq(agentTasks.id, id));
    return this.mapTask(row!);
  }

  private mapLoop(row: typeof agentLoops.$inferSelect): AgentLoop {
    return {
      id: row.id,
      name: row.name,
      personaId: row.personaId,
      systemPrompt: row.systemPrompt,
      status: row.status,
      config: row.config,
      currentTaskId: row.currentTaskId ?? undefined,
      chatSessionId: row.chatSessionId ?? undefined,
      iterationCount: row.iterationCount,
      createdAt: toMs(row.createdAt),
      updatedAt: toMs(row.updatedAt),
    };
  }

  private mapTask(row: typeof agentTasks.$inferSelect): AgentTask {
    return {
      id: row.id,
      loopId: row.loopId,
      title: row.title,
      description: row.description,
      priority: row.priority,
      status: row.status,
      resultSummary: row.resultSummary ?? undefined,
      orderIndex: row.orderIndex,
      createdAt: toMs(row.createdAt),
      updatedAt: toMs(row.updatedAt),
    };
  }
}
