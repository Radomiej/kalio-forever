import { Injectable, Logger, NotFoundException, OnApplicationBootstrap } from '@nestjs/common';
import { nanoid } from 'nanoid';
import { readFileSync } from 'fs';
import { join } from 'path';
import type { Persona, PersonaKV, PersonaSessionConfig, CreatePersonaDto, UpdatePersonaDto } from '@kalio/types';
import { DrizzleService } from '../../database/drizzle.service';
import { personas, personaKV } from '../../database/schema';
import { eq } from 'drizzle-orm';
import type { PersonaGraphValidationResult } from './persona-graph-config';
import { validatePersonaGraphConfig } from './persona-graph-config';

@Injectable()
export class PersonaService implements OnApplicationBootstrap {
  private readonly logger = new Logger(PersonaService.name);

  constructor(private readonly drizzle: DrizzleService) {}

  async onApplicationBootstrap() {
    const now = new Date();
    const personasConfig = this.loadPersonasConfig();

    for (const [id, config] of Object.entries(personasConfig)) {
      const existing = await this.drizzle.db
        .select({ id: personas.id, systemPrompt: personas.systemPrompt })
        .from(personas)
        .where(eq(personas.id, id))
        .then((r) => r[0]);
      
      if (!existing) {
        await this.drizzle.db.insert(personas).values({
          id,
          name: config.name,
          systemPrompt: config.systemPrompt,
          model: config.model,
          allowedTools: config.allowedTools,
          skillIds: config.skillIds ?? [],
          createdAt: now,
          updatedAt: now,
        });
        this.logger.log(`Seeded ${id} persona`);
      } else {
        const updatePayload: {
          name: string;
          allowedTools: string[];
          skillIds: string[];
          updatedAt: Date;
          systemPrompt?: string;
        } = {
          name: config.name,
          allowedTools: config.allowedTools,
          skillIds: config.skillIds ?? [],
          updatedAt: now,
        };

        if (this.shouldRefreshSeededSystemPrompt(id, existing.systemPrompt, config.systemPrompt)) {
          updatePayload.systemPrompt = config.systemPrompt;
        }

        await this.drizzle.db.update(personas).set(updatePayload).where(eq(personas.id, id));
        this.logger.log(`Updated ${id} persona`);
      }
    }
  }

  private shouldRefreshSeededSystemPrompt(
    personaId: string,
    existingPrompt: string | null | undefined,
    nextPrompt: string,
  ): boolean {
    if (typeof existingPrompt !== 'string') {
      return false;
    }

    if (existingPrompt === nextPrompt) {
      return false;
    }

    if (this.matchesLegacyCliPrompt(personaId, existingPrompt)) {
      return true;
    }

    if (personaId !== 'designer') {
      return false;
    }

    const matchesRigidLegacyPrompt = existingPrompt.includes('Build every app using this structure:')
      && existingPrompt.includes('Dark theme by default')
      && existingPrompt.includes('Every app MUST have at least 2 pages with working navigation');

    const matchesPreviousVfsFirstSeed = existingPrompt.includes(
      'When the user asks for a prototype page or website, do not jump straight to raapp_create. Work in VFS first and finish with a design_preview result.',
    ) && existingPrompt.includes(
      'Use the exact tool names: vfs_list, vfs_read, vfs_write, design_preview, raapp_create',
    ) && existingPrompt.includes(
      'Never mention or attempt file_write, file_read, write_file, read_file, or other aliases - they do not exist here',
    ) && !existingPrompt.includes('image_generate')
      && !existingPrompt.includes('image_view')
      && !existingPrompt.includes('image_edit');

    return matchesRigidLegacyPrompt || matchesPreviousVfsFirstSeed;
  }

  private matchesLegacyCliPrompt(personaId: string, existingPrompt: string): boolean {
    if (existingPrompt.includes('spawn_cli_agent')) {
      return false;
    }

    if (personaId === 'orchestrator') {
      return existingPrompt.includes('Prefer run_subagent for bounded research, analysis, and specialist reasoning.')
        && existingPrompt.includes('Use run_cli_agent only for concrete implementation tasks with explicit acceptance criteria.');
    }

    if (personaId === 'dev') {
      return existingPrompt.includes('run_cli_agent: delegates a coding task to one of the configured CLI coding agents')
        && existingPrompt.includes('## Workflow');
    }

    if (personaId === 'jony') {
      return existingPrompt.includes('If delegation is needed, use run_subagent or run_cli_agent with precise acceptance criteria.')
        && existingPrompt.includes('Never leave the task half-done when tools allow completion.');
    }

    return false;
  }

  private loadPersonasConfig(): Record<string, { name: string; systemPrompt: string; model: string; allowedTools: string[]; skillIds?: string[] }> {
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

  async validateGraphConfig(personaId: string, graphConfig: unknown): Promise<PersonaGraphValidationResult> {
    await this.findOne(personaId);
    return validatePersonaGraphConfig(graphConfig);
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
      allowedTools: persona.allowedTools ?? [],
      skillIds: persona.skillIds ?? [],
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

  private mapRow(row: { id: string; name: string; systemPrompt: string; model: string; allowedTools: string[] | null; skillIds?: string[] | null; mcpPolicy?: string | null; createdAt: number | Date; updatedAt: number | Date }): Persona {
    const toMs = (v: number | Date) => v instanceof Date ? v.getTime() : v;
    return {
      id: row.id,
      name: row.name,
      systemPrompt: row.systemPrompt,
      model: row.model,
      allowedTools: row.allowedTools ?? [],
      skillIds: row.skillIds ?? [],
      mcpPolicy: (row.mcpPolicy as import('@kalio/types').MCPPolicy | null | undefined) ?? 'allow_all',
      createdAt: toMs(row.createdAt),
      updatedAt: toMs(row.updatedAt),
    };
  }
}
