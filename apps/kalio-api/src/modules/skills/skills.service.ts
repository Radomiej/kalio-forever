import { Injectable } from '@nestjs/common';
import { nanoid } from 'nanoid';
import type { Skill, CreateSkillDto, UpdateSkillDto } from '@kalio/types';
import { DrizzleService } from '../../database/drizzle.service';
import { skills } from '../../database/schema';
import { eq } from 'drizzle-orm';

@Injectable()
export class SkillsService {
  constructor(private readonly drizzle: DrizzleService) {}

  async findAll(): Promise<Skill[]> {
    const rows = await this.drizzle.db.select().from(skills).orderBy(skills.createdAt);
    return rows.map(this.toSkill);
  }

  async findOne(id: string): Promise<Skill | null> {
    const [row] = await this.drizzle.db.select().from(skills).where(eq(skills.id, id));
    return row ? this.toSkill(row) : null;
  }

  async create(dto: CreateSkillDto): Promise<Skill> {
    const id = nanoid();
    const now = new Date();
    await this.drizzle.db.insert(skills).values({
      id,
      name: dto.name,
      description: dto.description ?? '',
      prompt: dto.prompt,
      source: dto.source ?? 'user',
      createdAt: now,
      updatedAt: now,
    });
    return this.findOne(id) as Promise<Skill>;
  }

  async update(id: string, dto: UpdateSkillDto): Promise<Skill | null> {
    const existing = await this.findOne(id);
    if (!existing) return null;
    await this.drizzle.db
      .update(skills)
      .set({
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.description !== undefined && { description: dto.description }),
        ...(dto.prompt !== undefined && { prompt: dto.prompt }),
        updatedAt: new Date(),
      })
      .where(eq(skills.id, id));
    return this.findOne(id);
  }

  async remove(id: string): Promise<void> {
    await this.drizzle.db.delete(skills).where(eq(skills.id, id));
  }

  private toSkill(row: typeof skills.$inferSelect): Skill {
    return {
      id: row.id,
      name: row.name,
      description: row.description,
      prompt: row.prompt,
      source: row.source as Skill['source'],
      createdAt: row.createdAt instanceof Date ? row.createdAt.getTime() : (row.createdAt as number),
      updatedAt: row.updatedAt instanceof Date ? row.updatedAt.getTime() : (row.updatedAt as number),
    };
  }
}
