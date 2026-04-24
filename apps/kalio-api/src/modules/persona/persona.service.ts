import { Injectable, Logger, NotFoundException, OnApplicationBootstrap } from '@nestjs/common';
import { nanoid } from 'nanoid';
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

    const defaultExists = await this.drizzle.db.select({ id: personas.id }).from(personas).where(eq(personas.id, 'default')).then((r) => r[0]);
    if (!defaultExists) {
      await this.drizzle.db.insert(personas).values({
        id: 'default',
        name: 'Default',
        systemPrompt: 'You are a helpful AI assistant.',
        model: '',
        skills: [],
        createdAt: now,
        updatedAt: now,
      });
      this.logger.log('Seeded default persona');
    }

    const raAppsExists = await this.drizzle.db.select({ id: personas.id }).from(personas).where(eq(personas.id, 'ra-apps')).then((r) => r[0]);
    if (!raAppsExists) {
      await this.drizzle.db.insert(personas).values({
        id: 'ra-apps',
        name: 'RA-Apps',
        systemPrompt: [
          'You are an RA-App runner. Your ONLY job is to invoke RA-App tools.',
          '',
          'Rules:',
          '- When asked to run or launch an app, IMMEDIATELY call the raapp_create tool.',
          '- Use type="html" with a complete, self-contained HTML document for the app.',
          '- Do NOT describe what you are about to do. Just call the tool.',
          '- After the tool returns, write exactly one sentence confirming it is ready.',
          '- Never generate the app yourself as plain text — always use raapp_create.',
        ].join('\n'),
        model: '',
        skills: ['raapp_create', 'raapp_compile'],
        createdAt: now,
        updatedAt: now,
      });
      this.logger.log('Seeded ra-apps persona');
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

  private mapRow(row: { id: string; name: string; systemPrompt: string; model: string; skills: string[] | null; createdAt: number | Date; updatedAt: number | Date }): Persona {
    const toMs = (v: number | Date) => v instanceof Date ? v.getTime() : v;
    return {
      id: row.id,
      name: row.name,
      systemPrompt: row.systemPrompt,
      model: row.model,
      skills: row.skills ?? [],
      createdAt: toMs(row.createdAt),
      updatedAt: toMs(row.updatedAt),
    };
  }
}
