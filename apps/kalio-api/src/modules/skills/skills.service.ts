import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { readFileSync } from 'fs';
import { join } from 'path';
import { nanoid } from 'nanoid';
import type { Skill, CreateSkillDto, UpdateSkillDto } from '@kalio/types';
import { DrizzleService } from '../../database/drizzle.service';
import { skills } from '../../database/schema';
import { eq, inArray } from 'drizzle-orm';

@Injectable()
export class SkillsService implements OnApplicationBootstrap {
  private readonly logger = new Logger(SkillsService.name);

  constructor(private readonly drizzle: DrizzleService) {}

  async onApplicationBootstrap(): Promise<void> {
    const seededSkills = this.loadSeedSkills();
    const now = new Date();
    for (const [id, seed] of Object.entries(seededSkills)) {
      const existing = await this.drizzle.db
        .select({ id: skills.id })
        .from(skills)
        .where(eq(skills.id, id))
        .then((rows) => rows[0]);
      if (existing) {
        await this.drizzle.db
          .update(skills)
          .set({
            name: seed.name,
            description: seed.description ?? '',
            prompt: seed.prompt,
            source: seed.source ?? 'agent',
            updatedAt: now,
          })
          .where(eq(skills.id, id));
      } else {
        await this.drizzle.db.insert(skills).values({
          id,
          name: seed.name,
          description: seed.description ?? '',
          prompt: seed.prompt,
          source: seed.source ?? 'agent',
          createdAt: now,
          updatedAt: now,
        });
      }
    }
  }

  private loadSeedSkills(): Record<string, { name: string; description?: string; prompt: string; source?: 'user' | 'agent' }> {
    try {
      const configPath = join(__dirname, '../../assets/skills.json');
      return JSON.parse(readFileSync(configPath, 'utf-8'));
    } catch (error) {
      this.logger.error('Failed to load skills config', error);
      return {};
    }
  }

  async findAll(): Promise<Skill[]> {
    const rows = await this.drizzle.db.select().from(skills).orderBy(skills.createdAt);
    return rows.map(this.toSkill);
  }

  async findByIds(ids: string[]): Promise<Skill[]> {
    if (ids.length === 0) return [];
    const rows = await this.drizzle.db.select().from(skills).where(inArray(skills.id, ids));
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
    const skill = await this.findOne(id);
    if (!skill) throw new Error(`Skill ${id} not found after insert`);
    return skill;
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
