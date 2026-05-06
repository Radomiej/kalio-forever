import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { nanoid } from 'nanoid';
import type { Credential, CreateCredentialDto, LLMProviderType } from '@kalio/types';
import { DrizzleService } from '../../database/drizzle.service';
import { credentials, appSettings } from '../../database/schema';
import { eq } from 'drizzle-orm';
import type { ProviderConfig } from '../llm/llm.types';
import { TimeoutSettingsService } from './timeout-settings.service';
import { isLocalLlmProvider } from '../../common/utils/local-llm-provider.util';

@Injectable()
export class CredentialsService {
  private readonly logger = new Logger(CredentialsService.name);

  constructor(
    private readonly drizzle: DrizzleService,
    private readonly timeoutSettings: TimeoutSettingsService,
  ) {}

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

  // ─── Model update ─────────────────────────────────────────────────────────────

  async updateModel(id: string, model: string): Promise<Credential> {
    const existing = await this.drizzle.db.select().from(credentials).where(eq(credentials.id, id)).then((r) => r[0]);
    if (!existing) throw new NotFoundException(`Credential ${id} not found`);
    await this.drizzle.db.update(credentials).set({ model }).where(eq(credentials.id, id));
    const { apiKey: _omit, ...row } = (await this.drizzle.db.select().from(credentials).where(eq(credentials.id, id)).then((r) => r[0]))!;
    return {
      ...row,
      createdAt: row.createdAt instanceof Date ? row.createdAt.getTime() : row.createdAt,
      baseUrl: row.baseUrl ?? undefined,
      model: row.model ?? undefined,
    };
  }

  // ─── Generation settings ──────────────────────────────────────────────────────

  async getGenerationSettings(): Promise<{ temperature: number; maxTokens: number }> {
    const rows = await this.drizzle.db.select().from(appSettings).where(
      // We'll do two separate queries for simplicity
      eq(appSettings.key, 'llm_temperature'),
    );
    const tempRow = rows[0];

    const maxRows = await this.drizzle.db.select().from(appSettings).where(
      eq(appSettings.key, 'llm_max_tokens'),
    );
    const maxRow = maxRows[0];

    return {
      temperature: tempRow ? parseFloat(tempRow.value) : 0.7,
      maxTokens: maxRow ? parseInt(maxRow.value, 10) : 4096,
    };
  }

  async setGenerationSettings(settings: { temperature?: number; maxTokens?: number }): Promise<void> {
    const now = new Date();
    if (settings.temperature !== undefined) {
      await this.upsertSetting('llm_temperature', String(settings.temperature), now);
    }
    if (settings.maxTokens !== undefined) {
      await this.upsertSetting('llm_max_tokens', String(settings.maxTokens), now);
    }
  }

  private async upsertSetting(key: string, value: string, now: Date): Promise<void> {
    const existing = await this.drizzle.db.select().from(appSettings).where(eq(appSettings.key, key)).then((r) => r[0]);
    if (existing) {
      await this.drizzle.db.update(appSettings).set({ value, updatedAt: now }).where(eq(appSettings.key, key));
    } else {
      await this.drizzle.db.insert(appSettings).values({ key, value, updatedAt: now });
    }
  }

  // ─── Model listing for credential ─────────────────────────────────────────────

  async getModelsForCredential(id: string): Promise<string[]> {
    const row = await this.drizzle.db.select().from(credentials).where(eq(credentials.id, id)).then((r) => r[0]);
    if (!row) throw new NotFoundException(`Credential ${id} not found`);

    const PROVIDER_BASE_URLS: Record<string, string> = {
      openai:     'https://api.openai.com/v1',
      xiaomimimo: 'https://token-plan-ams.xiaomimimo.com/v1',
      deepseek:   'https://api.deepseek.com/v1',
      cometapi:   'https://api.cometapi.com/v1',
      openrouter: 'https://openrouter.ai/api/v1',
      ollama:     'http://localhost:11434/v1',
      bitnet:     'http://localhost:8080/v1',
    };

    const isLocal = isLocalLlmProvider(row.provider, row.baseUrl ?? undefined);
    const resolvedBase = (row.baseUrl ?? PROVIDER_BASE_URLS[row.provider] ?? '').replace(/\/$/, '');
    if (!resolvedBase) return [];

    const endpoint = `${resolvedBase}/models`;
    const timeoutMs = await this.timeoutSettings.getProviderTimeoutMs(isLocal);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const authHeaders: Record<string, string> = row.apiKey ? { Authorization: `Bearer ${row.apiKey}` } : {};
      if (row.provider === 'xiaomimimo') {
        authHeaders['HTTP-Referer'] = 'https://github.com/RooVetGit/Roo-Cline';
        authHeaders['X-Title'] = 'Roo Code';
        authHeaders['User-Agent'] = 'RooCode/3.17.0';
      }
      const res = await fetch(endpoint, { headers: authHeaders, signal: controller.signal });
      if (!res.ok) return [];
      const json = await res.json() as { data?: { id: string }[]; models?: { id: string }[] };
      const items = json.data ?? json.models ?? [];
      return items.map((m) => (typeof m === 'string' ? m : m.id)).filter(Boolean);
    } catch {
      return [];
    } finally {
      clearTimeout(timer);
    }
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

  // ─── Agent loop settings ───────────────────────────────────────────────────

  async getMaxToolAttempts(): Promise<number> {
    const row = await this.drizzle.db
      .select()
      .from(appSettings)
      .where(eq(appSettings.key, 'max_tool_attempts'))
      .then((r) => r[0]);
    if (!row) return 8;
    const parsed = parseInt(row.value, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 8;
  }

  async setMaxToolAttempts(size: number): Promise<void> {
    const normalized = Math.max(1, Math.min(100, Math.round(size)));
    const now = new Date();
    const existing = await this.drizzle.db
      .select()
      .from(appSettings)
      .where(eq(appSettings.key, 'max_tool_attempts'))
      .then((r) => r[0]);
    if (existing) {
      await this.drizzle.db.update(appSettings).set({ value: String(normalized), updatedAt: now }).where(eq(appSettings.key, 'max_tool_attempts'));
    } else {
      await this.drizzle.db.insert(appSettings).values({ key: 'max_tool_attempts', value: String(normalized), updatedAt: now });
    }
  }
}
