import { Injectable, Logger, NotFoundException, OnApplicationBootstrap } from '@nestjs/common';
import { nanoid } from 'nanoid';
import { readFileSync } from 'fs';
import { join } from 'path';
import type { Persona, PersonaKV, PersonaSessionConfig, CreatePersonaDto, UpdatePersonaDto } from '@kalio/types';
import { DrizzleService } from '../../database/drizzle.service';
import { personas, personaKV } from '../../database/schema';
import { eq } from 'drizzle-orm';

@Injectable()
export class PersonaService implements OnApplicationBootstrap {
  private readonly logger = new Logger(PersonaService.name);

  constructor(private readonly drizzle: DrizzleService) {}

  async onApplicationBootstrap() {
    const now = new Date();
    const personasConfig = this.loadPersonasConfig();

    for (const [id, config] of Object.entries(personasConfig)) {
      const existing = await this.drizzle.db.select({ id: personas.id }).from(personas).where(eq(personas.id, id)).then((r) => r[0]);
      
      if (!existing) {
        await this.drizzle.db.insert(personas).values({
          id,
          name: config.name,
          systemPrompt: config.systemPrompt,
          model: config.model,
          skills: config.skills,
          createdAt: now,
          updatedAt: now,
        });
        this.logger.log(`Seeded ${id} persona`);
      } else {
        await this.drizzle.db.update(personas).set({
          skills: config.skills,
          updatedAt: now,
        }).where(eq(personas.id, id));
        this.logger.log(`Updated ${id} persona`);
      }
    }
  }

  private loadPersonasConfig(): Record<string, { name: string; systemPrompt: string; model: string; skills: string[] }> {
    try {
      const configPath = join(__dirname, '../../assets/personas.json');
      const configContent = readFileSync(configPath, 'utf-8');
      return JSON.parse(configContent);
    } catch (error) {
      this.logger.error('Failed to load personas config', error);
      return {};
    }
  }

  async findAll(): Promise<Persona[]> {
    const rows = await this.drizzle.db.select().from(personas);
    return rows.map(this.mapRow);
  }

  async findOne(id: string): Promise<Persona> {
    const row = await this.drizzle.db.select().from(personas).where(eq(personas.id, id)).then((r) => r[0]);
    if (!row) throw new NotFoundException(`Persona ${id} not found`);
    return this.mapRow(row);
  }

  async create(dto: CreatePersonaDto): Promise<Persona> {
    const now = new Date();
    const id = nanoid();
    await this.drizzle.db.insert(personas).values({ id, ...dto, createdAt: now, updatedAt: now });
    return this.findOne(id);
  }

  async update(id: string, dto: UpdatePersonaDto): Promise<Persona> {
    await this.findOne(id);
    await this.drizzle.db
      .update(personas)
      .set({ ...dto, updatedAt: new Date() })
      .where(eq(personas.id, id));
    return this.findOne(id);
  }

  async remove(id: string): Promise<void> {
    await this.findOne(id);
    await this.drizzle.db.delete(personas).where(eq(personas.id, id));
  }

  async getSessionConfig(personaId: string): Promise<PersonaSessionConfig | null> {
    const persona = await this.drizzle.db.select().from(personas).where(eq(personas.id, personaId)).then((r) => r[0]);
    if (!persona) return null;

    const kvRows = await this.drizzle.db.select().from(personaKV).where(eq(personaKV.personaId, personaId));
    const kv: Record<string, string> = {};
    for (const row of kvRows) kv[row.key] = row.value;

    return {
      systemPrompt: persona.systemPrompt,
      model: persona.model,
      availableSkills: persona.skills ?? [],
      mcpPolicy: persona.mcpPolicy ?? 'allow_all',
      kv,
    };
  }

  async setKV(personaId: string, key: string, value: string): Promise<PersonaKV> {
    await this.findOne(personaId);
    const existing = await this.drizzle.db
      .select()
      .from(personaKV)
      .where(eq(personaKV.personaId, personaId))
      .then((rows) => rows.find((r) => r.key === key));

    const now = new Date();
    const nowMs = now.getTime();
    if (existing) {
      await this.drizzle.db.update(personaKV).set({ value, updatedAt: now }).where(eq(personaKV.id, existing.id));
      return { id: existing.id, personaId, key, value, updatedAt: nowMs };
    }
    const id = nanoid();
    await this.drizzle.db.insert(personaKV).values({ id, personaId, key, value, updatedAt: now });
    return { id, personaId, key, value, updatedAt: nowMs };
  }

  private mapRow(row: { id: string; name: string; systemPrompt: string; model: string; skills: string[] | null; mcpPolicy?: string | null; createdAt: number | Date; updatedAt: number | Date }): Persona {
    const toMs = (v: number | Date) => v instanceof Date ? v.getTime() : v;
    return {
      id: row.id,
      name: row.name,
      systemPrompt: row.systemPrompt,
      model: row.model,
      skills: row.skills ?? [],
      mcpPolicy: (row.mcpPolicy as import('@kalio/types').MCPPolicy | null | undefined) ?? 'allow_all',
      createdAt: toMs(row.createdAt),
      updatedAt: toMs(row.updatedAt),
    };
  }
}
