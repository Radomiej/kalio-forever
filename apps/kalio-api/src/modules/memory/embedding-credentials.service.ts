import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { nanoid } from 'nanoid';
import { eq } from 'drizzle-orm';
import type { EmbeddingCredential, CreateEmbeddingCredentialDto, UpdateLocalEmbeddingConfigDto } from '@kalio/types';
import { DrizzleService } from '../../database/drizzle.service';
import { AppSettingsService } from '../../database/app-settings.service';
import { embeddingCredentials } from '../../database/schema';

const ACTIVE_KEY = 'active_embedding_credential';
const LOCAL_CONFIG_KEY = 'local_embedding_config';
const FORCE_LOCAL_KEY = 'force_local_embeddings';

function toEmbeddingCredentialResponse(row: typeof embeddingCredentials.$inferSelect): EmbeddingCredential {
  return {
    id: row.id,
    name: row.name,
    provider: row.provider as EmbeddingCredential['provider'],
    baseUrl: row.baseUrl ?? undefined,
    model: row.model ?? undefined,
    dimensions: row.dimensions ?? undefined,
    createdAt: row.createdAt instanceof Date ? row.createdAt.getTime() : row.createdAt,
  };
}

export interface EmbeddingCredentialFull extends EmbeddingCredential {
  apiKey: string;
}

export interface LocalEmbeddingConfig extends UpdateLocalEmbeddingConfigDto {
  cacheDir: string;
}

@Injectable()
export class EmbeddingCredentialsService {
  private readonly logger = new Logger(EmbeddingCredentialsService.name);

  constructor(
    private readonly drizzle: DrizzleService,
    private readonly appSettings: AppSettingsService,
  ) {}

  async findAll(): Promise<EmbeddingCredential[]> {
    const rows = await this.drizzle.db.select().from(embeddingCredentials);
    return rows.map((row) => toEmbeddingCredentialResponse(row));
  }

  async create(dto: CreateEmbeddingCredentialDto): Promise<EmbeddingCredential> {
    const id = nanoid();
    await this.drizzle.db.insert(embeddingCredentials).values({
      id,
      name: dto.name,
      provider: dto.provider,
      apiKey: dto.apiKey,
      baseUrl: dto.baseUrl,
      model: dto.model,
      dimensions: dto.dimensions,
      createdAt: new Date(),
    });
    const row = await this.drizzle.db
      .select()
      .from(embeddingCredentials)
      .where(eq(embeddingCredentials.id, id))
      .then((r) => r[0]);
    if (!row) throw new Error(`Embedding credential insert succeeded but row not found for id: ${id}`);
    this.logger.log(`Embedding credential created: "${dto.name}" (${dto.provider})`);
    return toEmbeddingCredentialResponse(row);
  }

  async remove(id: string): Promise<void> {
    const activeId = await this.getActiveId();
    if (activeId === id) {
      await this.appSettings.delete(ACTIVE_KEY);
      this.logger.log(`Embedding credential ${id} was active — cleared active setting`);
    }
    await this.drizzle.db
      .delete(embeddingCredentials)
      .where(eq(embeddingCredentials.id, id));
    this.logger.log(`Embedding credential removed: ${id}`);
  }

  async setActive(id: string): Promise<void> {
    const row = await this.drizzle.db
      .select({ id: embeddingCredentials.id })
      .from(embeddingCredentials)
      .where(eq(embeddingCredentials.id, id))
      .then((r) => r[0]);
    if (!row) throw new NotFoundException(`Embedding credential ${id} not found`);
    await this.appSettings.set(ACTIVE_KEY, id);
    await this.appSettings.set(FORCE_LOCAL_KEY, 'false');
    this.logger.log(`Active embedding credential set: ${id}`);
  }

  async clearActive(): Promise<void> {
    await this.appSettings.delete(ACTIVE_KEY);
    await this.appSettings.set(FORCE_LOCAL_KEY, 'true');
    this.logger.log('Active embedding credential cleared — will fall back to env/local default');
  }

  async shouldForceLocal(): Promise<boolean> {
    return await this.appSettings.get(FORCE_LOCAL_KEY) === 'true';
  }

  async getLocalConfig(defaults: LocalEmbeddingConfig): Promise<LocalEmbeddingConfig> {
    const raw = await this.appSettings.get(LOCAL_CONFIG_KEY);
    if (!raw) return defaults;

    try {
      const parsed = JSON.parse(raw) as Partial<LocalEmbeddingConfig>;
      return {
        enabled: typeof parsed.enabled === 'boolean' ? parsed.enabled : defaults.enabled,
        model: typeof parsed.model === 'string' && parsed.model.trim() ? parsed.model : defaults.model,
        dimensions: typeof parsed.dimensions === 'number' && Number.isFinite(parsed.dimensions) ? Math.round(parsed.dimensions) : defaults.dimensions,
        backend: parsed.backend === 'webgpu' || parsed.backend === 'cpu' || parsed.backend === 'auto' ? parsed.backend : defaults.backend,
        cacheDir: typeof parsed.cacheDir === 'string' && parsed.cacheDir.trim() ? parsed.cacheDir : defaults.cacheDir,
      };
    } catch {
      return defaults;
    }
  }

  async updateLocalConfig(dto: UpdateLocalEmbeddingConfigDto): Promise<LocalEmbeddingConfig> {
    const defaults: LocalEmbeddingConfig = {
      enabled: true,
      model: 'Xenova/multilingual-e5-small',
      dimensions: 384,
      backend: 'cpu',
      cacheDir: './data/embeddings-cache',
    };
    const next: LocalEmbeddingConfig = {
      ...defaults,
      enabled: dto.enabled,
      model: dto.model,
      dimensions: dto.dimensions,
      backend: dto.backend,
    };
    await this.appSettings.set(LOCAL_CONFIG_KEY, JSON.stringify(next));
    this.logger.log(`Local embedding config updated: ${next.model} (${next.dimensions}, ${next.backend}, enabled=${next.enabled})`);
    return next;
  }

  async getActiveId(): Promise<string | null> {
    return this.appSettings.get(ACTIVE_KEY);
  }

  /**
   * Returns the full credential row including apiKey.
   * Internal use only — never expose apiKey over HTTP.
   */
  async getActiveConfig(): Promise<EmbeddingCredentialFull | null> {
    const activeId = await this.getActiveId();
    if (!activeId) return null;
    const row = await this.drizzle.db
      .select()
      .from(embeddingCredentials)
      .where(eq(embeddingCredentials.id, activeId))
      .then((r) => r[0]);
    if (!row) return null;
    return {
      ...row,
      provider: row.provider as EmbeddingCredential['provider'],
      createdAt: row.createdAt instanceof Date ? row.createdAt.getTime() : row.createdAt,
    };
  }

  async getConfigById(id: string): Promise<EmbeddingCredentialFull | null> {
    const row = await this.drizzle.db
      .select()
      .from(embeddingCredentials)
      .where(eq(embeddingCredentials.id, id))
      .then((r) => r[0]);
    if (!row) return null;
    return {
      ...row,
      provider: row.provider as EmbeddingCredential['provider'],
      createdAt: row.createdAt instanceof Date ? row.createdAt.getTime() : row.createdAt,
    };
  }
}
