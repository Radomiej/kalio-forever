import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { nanoid } from 'nanoid';
import type { Credential, CreateCredentialDto, LLMProviderType } from '@kalio/types';
import { DrizzleService } from '../../database/drizzle.service';
import { credentials, appSettings } from '../../database/schema';
import { eq } from 'drizzle-orm';
import type { ProviderConfig } from '../llm/providers/provider-factory';

@Injectable()
export class CredentialsService {
  private readonly logger = new Logger(CredentialsService.name);

  constructor(private readonly drizzle: DrizzleService) {}

  async findAll(): Promise<Credential[]> {
    const rows = await this.drizzle.db.select().from(credentials);
    return rows.map(({ apiKey: _omit, ...rest }) => ({
      ...rest,
      createdAt: rest.createdAt instanceof Date ? rest.createdAt.getTime() : rest.createdAt,
      baseUrl: rest.baseUrl ?? undefined,
      model: rest.model ?? undefined,
    }));
  }

  async create(dto: CreateCredentialDto): Promise<Credential> {
    const id = nanoid();
    await this.drizzle.db.insert(credentials).values({
      id,
      name: dto.name,
      provider: dto.provider,
      apiKey: dto.apiKey,
      baseUrl: dto.baseUrl ?? null,
      model: dto.model ?? null,
      createdAt: new Date(),
    });
    const { apiKey: _omit, ...row } = (await this.drizzle.db.select().from(credentials).where(eq(credentials.id, id)).then((r) => r[0]))!;
    return {
      ...row,
      createdAt: row.createdAt instanceof Date ? row.createdAt.getTime() : row.createdAt,
      baseUrl: row.baseUrl ?? undefined,
      model: row.model ?? undefined,
    };
  }

  async remove(id: string): Promise<void> {
    const activeId = await this.getActiveCredentialId();
    if (activeId === id) {
      // Clear active if the deleted credential was active
      await this.drizzle.db.delete(appSettings).where(eq(appSettings.key, 'active_llm_credential'));
    }
    await this.drizzle.db.delete(credentials).where(eq(credentials.id, id));
  }

  async getApiKey(credentialId: string): Promise<string | null> {
    const row = await this.drizzle.db.select().from(credentials).where(eq(credentials.id, credentialId)).then((r) => r[0]);
    return row?.apiKey ?? null;
  }

  // ─── Active credential management ────────────────────────────────────────────

  async getActiveCredentialId(): Promise<string | null> {
    const row = await this.drizzle.db
      .select()
      .from(appSettings)
      .where(eq(appSettings.key, 'active_llm_credential'))
      .then((r) => r[0]);
    return row?.value ?? null;
  }

  async setActiveCredential(credentialId: string): Promise<void> {
    const cred = await this.drizzle.db
      .select()
      .from(credentials)
      .where(eq(credentials.id, credentialId))
      .then((r) => r[0]);
    if (!cred) throw new NotFoundException(`Credential ${credentialId} not found`);

    const now = new Date();
    // upsert into app_settings
    const existing = await this.drizzle.db
      .select()
      .from(appSettings)
      .where(eq(appSettings.key, 'active_llm_credential'))
      .then((r) => r[0]);

    if (existing) {
      await this.drizzle.db
        .update(appSettings)
        .set({ value: credentialId, updatedAt: now })
        .where(eq(appSettings.key, 'active_llm_credential'));
    } else {
      await this.drizzle.db
        .insert(appSettings)
        .values({ key: 'active_llm_credential', value: credentialId, updatedAt: now });
    }
    this.logger.log(`Active LLM credential set to: ${credentialId} (${cred.provider}/${cred.model})`);
  }

  async clearActiveCredential(): Promise<void> {
    await this.drizzle.db.delete(appSettings).where(eq(appSettings.key, 'active_llm_credential'));
    this.logger.log('Active LLM credential cleared (will fall back to .env)');
  }

  async getActiveProviderConfig(): Promise<ProviderConfig | null> {
    const activeId = await this.getActiveCredentialId();
    if (!activeId) return null;
    const row = await this.drizzle.db
      .select()
      .from(credentials)
      .where(eq(credentials.id, activeId))
      .then((r) => r[0]);
    if (!row) return null;
    return {
      provider: row.provider as LLMProviderType,
      apiKey: row.apiKey,
      model: row.model ?? '',
      baseUrl: row.baseUrl ?? undefined,
    };
  }

  // ─── Context window settings ──────────────────────────────────────────────────

  async getContextWindowSize(): Promise<number> {
    const row = await this.drizzle.db
      .select()
      .from(appSettings)
      .where(eq(appSettings.key, 'context_window_size'))
      .then((r) => r[0]);
    return row ? parseInt(row.value, 10) : 32000;
  }

  async setContextWindowSize(size: number): Promise<void> {
    const now = new Date();
    const existing = await this.drizzle.db
      .select()
      .from(appSettings)
      .where(eq(appSettings.key, 'context_window_size'))
      .then((r) => r[0]);
    if (existing) {
      await this.drizzle.db.update(appSettings).set({ value: String(size), updatedAt: now }).where(eq(appSettings.key, 'context_window_size'));
    } else {
      await this.drizzle.db.insert(appSettings).values({ key: 'context_window_size', value: String(size), updatedAt: now });
    }
  }
}
