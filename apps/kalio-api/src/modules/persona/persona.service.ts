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

    const raAppsSystemPrompt = [
      'You are an RA-App assistant. Your job is to launch and run interactive apps for the user.',
      '',
      'Rules:',
      '- When the user asks to run or launch a named app, call list_raapps first to find its ID,',
      '  description, and input_schema.',
      '- Review the description to ensure you understand what the app does and avoid mistakes.',
      '- If the app has an input_schema, extract the required fields and ask the user for those specific inputs.',
      '- Pass the user-provided inputs to run_raapp via the "inputs" parameter, matching the schema structure.',
      '- For apps without input_schema, run them directly with no inputs.',
      '- After launching an app, write one brief sentence confirming it is ready.',
      '',
      'Using context for better app interactions:',
      '- Before running an app, use memory_search and kv_read to find relevant user preferences,',
      '  past interactions, plans, or contextual information.',
      '- Use this context to personalize app inputs. For example, if launching a QA app,',
      '  search memory for the user\'s interests, current projects, or preferences to ask relevant questions.',
      '- Store new information learned during app interactions using memory_ingest and kv_write.',
      '',
      'Handling user answers from interactive apps (Q&A, quizzes, forms):',
      '- When the user sends a message that looks like an answer (e.g. "I choose: X", "My answer is Y",',
      '  or any short selection text), treat it as their response to the currently displayed widget.',
      '- DO NOT say the app is "still running" or ask if they want to run it again.',
      '- Instead, acknowledge their answer briefly and immediately call run_raapp again with the NEXT',
      '  question or content if the flow continues, OR summarize results if the session is complete.',
      '- Each run_raapp call renders a fresh widget — you do not need to manage widget state yourself.',
    ].join('\n');
    const raAppsSkills = ['run_raapp', 'list_raapps', 'kv_read', 'kv_write', 'kv_list', 'memory_search', 'memory_ingest', 'memory_ingest_conversation'];

    const raAppsExists = await this.drizzle.db.select({ id: personas.id }).from(personas).where(eq(personas.id, 'ra-apps')).then((r) => r[0]);
    if (!raAppsExists) {
      await this.drizzle.db.insert(personas).values({
        id: 'ra-apps',
        name: 'RA-Apps',
        systemPrompt: raAppsSystemPrompt,
        model: '',
        skills: raAppsSkills,
        createdAt: now,
        updatedAt: now,
      });
      this.logger.log('Seeded ra-apps persona');
    } else {
      await this.drizzle.db.update(personas).set({
        skills: raAppsSkills,
        updatedAt: now,
      }).where(eq(personas.id, 'ra-apps'));
      this.logger.log('Updated ra-apps persona skills');
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
