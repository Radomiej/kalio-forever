import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';
import { nanoid } from 'nanoid';
import type { Credential, CreateCredentialDto, LLMProviderType } from '@kalio/types';
import { DrizzleService } from '../../database/drizzle.service';
import { credentials, appSettings } from '../../database/schema';
import { eq } from 'drizzle-orm';
import type { ProviderConfig } from '../llm/llm.types';
import { TimeoutSettingsService } from './timeout-settings.service';
import { isLocalLlmProvider } from '../../common/utils/local-llm-provider.util';
import {
  buildProviderCompatHeaders,
  resolveLlmProviderBaseUrl,
} from '../../common/utils/llm-provider-http.util';

const CREDENTIALS_CIPHER_PREFIX = 'kalio-enc-v1';
const CREDENTIALS_MASTER_KEY_ENV = 'CREDENTIALS_MASTER_KEY';
const DEV_FALLBACK_CREDENTIALS_MASTER_KEY = 'kalio-dev-credentials-master-key-not-for-production';

@Injectable()
export class CredentialsService {
  private readonly logger = new Logger(CredentialsService.name);
  private hasWarnedAboutFallbackMasterKey = false;

  constructor(
    private readonly drizzle: DrizzleService,
    private readonly timeoutSettings: TimeoutSettingsService,
    private readonly config: ConfigService,
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
      apiKey: this.encryptApiKey(dto.apiKey ?? ''),
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
    if (!row || typeof row.apiKey !== 'string') {
      return null;
    }
    return this.tryDecryptApiKey(row.apiKey, `Failed to decrypt API key for credential ${credentialId}`);
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
    const apiKey = this.tryDecryptApiKey(row.apiKey, `Failed to decrypt active credential secret for ${activeId}`);
    if (apiKey === null) {
      return null;
    }
    return {
      provider: row.provider as LLMProviderType,
      apiKey,
      model: row.model ?? '',
      baseUrl: row.baseUrl ?? undefined,
    };
  }

  async getEnvModelOverride(): Promise<string | null> {
    const row = await this.drizzle.db
      .select()
      .from(appSettings)
      .where(eq(appSettings.key, 'env_llm_model_override'))
      .then((results) => results[0]);

    return row?.value ?? null;
  }

  async setEnvModelOverride(model: string): Promise<void> {
    await this.upsertSetting('env_llm_model_override', model, new Date());
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
    const apiKey = this.tryDecryptApiKey(
      row.apiKey,
      `Failed to decrypt credential secret while fetching models for ${id}`,
    );
    if (row.apiKey.length > 0 && apiKey === null) {
      return [];
    }

    return this.getModelsForProviderConfig({
      provider: row.provider as LLMProviderType,
      apiKey: apiKey ?? '',
      model: row.model ?? '',
      baseUrl: row.baseUrl ?? undefined,
    }, `credential ${id}`);
  }

  async getModelsForProviderConfig(config: ProviderConfig, sourceLabel?: string): Promise<string[]> {
    const isLocal = isLocalLlmProvider(config.provider, config.baseUrl ?? undefined);
    const resolvedBase = resolveLlmProviderBaseUrl(config.provider, config.baseUrl ?? undefined);
    if (!resolvedBase) {
      return [];
    }

    const endpoint = `${resolvedBase}/models`;
    const timeoutMs = await this.timeoutSettings.getProviderTimeoutMs(isLocal);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const authHeaders = buildProviderCompatHeaders(config.provider, config.apiKey || undefined);
      const res = await fetch(endpoint, { headers: authHeaders, signal: controller.signal });
      if (!res.ok) return [];
      const json = await res.json() as { data?: { id: string }[]; models?: { id: string }[] };
      const items = json.data ?? json.models ?? [];
      return items.map((m) => (typeof m === 'string' ? m : m.id)).filter(Boolean);
    } catch (err) {
      this.logger.error(
        `Failed to fetch models for ${sourceLabel ?? `provider ${config.provider}`}`,
        err instanceof Error ? err : new Error(String(err)),
      );
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

  private encryptApiKey(apiKey: string): string {
    if (!apiKey) return '';

    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.getEncryptionKey(), iv);
    const encrypted = Buffer.concat([cipher.update(apiKey, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();

    return [
      CREDENTIALS_CIPHER_PREFIX,
      iv.toString('base64'),
      authTag.toString('base64'),
      encrypted.toString('base64'),
    ].join(':');
  }

  private decryptApiKey(storedValue: string): string {
    if (!storedValue || !storedValue.startsWith(`${CREDENTIALS_CIPHER_PREFIX}:`)) {
      return storedValue;
    }

    const [prefix, ivBase64, authTagBase64, payloadBase64] = storedValue.split(':');
    if (!prefix || !ivBase64 || !authTagBase64 || !payloadBase64) {
      throw new Error('Stored credential is malformed and cannot be decrypted');
    }

    const decipher = createDecipheriv('aes-256-gcm', this.getEncryptionKey(), Buffer.from(ivBase64, 'base64'));
    decipher.setAuthTag(Buffer.from(authTagBase64, 'base64'));

    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(payloadBase64, 'base64')),
      decipher.final(),
    ]);

    return decrypted.toString('utf8');
  }

  private tryDecryptApiKey(storedValue: string, message: string): string | null {
    try {
      return this.decryptApiKey(storedValue);
    } catch (err) {
      this.logger.error(message, err instanceof Error ? err : new Error(String(err)));
      return null;
    }
  }

  private getEncryptionKey(): Buffer {
    return scryptSync(this.getMasterKey(), CREDENTIALS_CIPHER_PREFIX, 32);
  }

  private getMasterKey(): string {
    const configured = this.config.get<string>(CREDENTIALS_MASTER_KEY_ENV, '');
    if (configured) {
      return configured;
    }

    const nodeEnv = this.config.get<string>('NODE_ENV', 'development');
    if (nodeEnv === 'production') {
      throw new Error(`${CREDENTIALS_MASTER_KEY_ENV} must be configured in production`);
    }

    if (nodeEnv !== 'test' && !this.hasWarnedAboutFallbackMasterKey) {
      this.hasWarnedAboutFallbackMasterKey = true;
      this.logger.warn(
        `${CREDENTIALS_MASTER_KEY_ENV} is not set; using the development fallback key. Set it explicitly outside local dev.`,
      );
    }

    return DEV_FALLBACK_CREDENTIALS_MASTER_KEY;
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
