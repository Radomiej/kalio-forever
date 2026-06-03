import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { OnModuleDestroy } from '@nestjs/common';
import type { EmbeddingStatus } from '@kalio/types';
import { EmbeddingCredentialsService, type LocalEmbeddingConfig } from './embedding-credentials.service';
import type { EmbeddingProviderConfig, IEmbeddingProvider } from './embedding-provider.types';
import {
  DEFAULT_LOCAL_EMBEDDING_DIMENSIONS,
  DEFAULT_LOCAL_EMBEDDING_BACKEND,
  DEFAULT_LOCAL_EMBEDDING_MODEL,
  LOCAL_EMBEDDING_MODEL_PARAMETERS,
  LocalTransformersEmbeddingProvider,
  type LocalEmbeddingBackend,
} from './local-transformers-embedding.provider';
import {
  MockEmbeddingProvider,
  OllamaEmbeddingProvider,
  OpenAICompatibleEmbeddingProvider,
} from './embedding.providers';

export {
  MockEmbeddingProvider,
  OllamaEmbeddingProvider,
  OpenAICompatibleEmbeddingProvider,
} from './embedding.providers';

const DEFAULT_REMOTE_EMBEDDING_MODEL = 'text-embedding-3-small';
const DEFAULT_REMOTE_EMBEDDING_DIMENSIONS = 1536;
const DEFAULT_LOCAL_EMBEDDING_CACHE_DIR = './data/embeddings-cache';

// ── Helpers ───────────────────────────────────────────────────────────────

function maskUrl(baseUrl: string): string {
  if (baseUrl.startsWith('local-cache:')) {
    return '(local cache)';
  }

  try {
    const u = new URL(baseUrl);
    return `${u.protocol}//${u.host}`;
  } catch {
    return baseUrl ? '(invalid URL)' : '(not set)';
  }
}

function isOllamaUrl(baseUrl: string): boolean {
  return baseUrl.includes('localhost:11434') || baseUrl.toLowerCase().includes('ollama');
}

function buildProvider(cfg: EmbeddingProviderConfig): IEmbeddingProvider {
  if (isOllamaUrl(cfg.baseUrl)) {
    return new OllamaEmbeddingProvider(cfg.baseUrl, cfg.model, cfg.dimensions);
  }
  return new OpenAICompatibleEmbeddingProvider(cfg);
}

function buildLocalProvider(config: LocalEmbeddingConfig): IEmbeddingProvider {
  return new LocalTransformersEmbeddingProvider({
    model: config.model,
    dimensions: config.dimensions,
    cacheDir: config.cacheDir,
    backend: config.backend,
  });
}

function sanitizeProfilePart(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'default';
}

function buildProfileId(provider: string, model: string, dimensions: number, backend?: string): string {
  return [provider, model, String(dimensions), backend]
    .filter((value): value is string => typeof value === 'string' && value.length > 0)
    .map(sanitizeProfilePart)
    .join('-');
}

// ── EmbeddingService ────────────────────────────────────────────────────────

@Injectable()
export class EmbeddingService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(EmbeddingService.name);
  private provider: IEmbeddingProvider | null = null;
  private providerSource: 'db' | 'env' | 'local' | 'disabled' | 'mock' = 'mock';
  private activeCredentialId: string | null = null;
  private activeCredentialName: string | null = null;
  private activeModel: string | null = null;
  private activeBaseUrl: string | null = null;
  private activeDimensions: number | null = null;
  private activeBackend: LocalEmbeddingBackend | null = null;
  private activeCacheDir: string | null = null;
  private activeProfileId = 'mock';

  constructor(
    private readonly config: ConfigService,
    private readonly embeddingCredentials: EmbeddingCredentialsService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.reloadFromCredential();
  }

  async onModuleDestroy(): Promise<void> {
    await this.disposeProvider();
  }

  /**
   * Called on startup and after any credential CRUD to refresh the provider.
   */
  async reloadFromCredential(): Promise<void> {
    await this.disposeProvider();

    const active = await this.embeddingCredentials.getActiveConfig();
    if (active) {
      this.provider = buildProvider({
        apiKey: active.apiKey,
        baseUrl: active.baseUrl,
        model: active.model,
        dimensions: active.dimensions,
      });
      this.providerSource = 'db';
      this.activeCredentialId = active.id;
      this.activeCredentialName = active.name;
      this.activeModel = active.model;
      this.activeBaseUrl = active.baseUrl;
      this.activeDimensions = active.dimensions;
      this.activeBackend = null;
      this.activeCacheDir = null;
      this.activeProfileId = buildProfileId(isOllamaUrl(active.baseUrl) ? 'ollama' : 'openai-compatible', active.model, active.dimensions);
      this.logger.log(`Embedding provider loaded from DB credential "${active.name}": ${active.model} @ ${active.baseUrl}`);
      return;
    }

    // No DB credential — prefer explicit remote embeddings config when present,
    // otherwise fall back to the auto-downloaded local model.
    // We deliberately do NOT fall back to LLM_API_KEY / LLM_BASE_URL:
    // an LLM key may not support the embeddings API, and silently inheriting
    // it causes confusing runtime failures.
    const apiKey = this.config.get<string>('EMBEDDING_API_KEY', '');
    const baseUrl = this.config.get<string>('EMBEDDING_BASE_URL', '');
    const localDefaults: LocalEmbeddingConfig = {
      enabled: this.config.get<string>('EMBEDDING_ENABLED', 'true') !== 'false',
      model: this.config.get<string>('EMBEDDING_MODEL', DEFAULT_LOCAL_EMBEDDING_MODEL),
      dimensions: parseInt(this.config.get<string>('EMBEDDING_DIMENSIONS', String(DEFAULT_LOCAL_EMBEDDING_DIMENSIONS)), 10),
      cacheDir: this.config.get<string>('EMBEDDING_CACHE_DIR', DEFAULT_LOCAL_EMBEDDING_CACHE_DIR),
      backend: this.config.get<LocalEmbeddingBackend>('EMBEDDING_BACKEND', DEFAULT_LOCAL_EMBEDDING_BACKEND),
    };
    const localConfig = await this.embeddingCredentials.getLocalConfig(localDefaults);
    const remoteModel = this.config.get<string>('EMBEDDING_MODEL', DEFAULT_REMOTE_EMBEDDING_MODEL);
    const remoteDimensions = parseInt(
      this.config.get<string>('EMBEDDING_DIMENSIONS', String(DEFAULT_REMOTE_EMBEDDING_DIMENSIONS)),
      10,
    );
    const forceLocal = this.config.get<string>('EMBEDDING_FORCE_LOCAL', 'false') === 'true'
      || await this.embeddingCredentials.shouldForceLocal();

    if (!forceLocal && apiKey && baseUrl && apiKey !== 'mock' && baseUrl !== 'mock') {
      this.provider = buildProvider({ apiKey, baseUrl, model: remoteModel, dimensions: remoteDimensions });
      this.providerSource = 'env';
      this.activeCredentialId = null;
      this.activeCredentialName = null;
      this.activeModel = remoteModel;
      this.activeBaseUrl = baseUrl;
      this.activeDimensions = remoteDimensions;
      this.activeBackend = null;
      this.activeCacheDir = null;
      this.activeProfileId = buildProfileId(isOllamaUrl(baseUrl) ? 'ollama' : 'openai-compatible', remoteModel, remoteDimensions);
      this.logger.log(`Embedding provider initialized from env: ${remoteModel} @ ${baseUrl}`);
    } else if (!localConfig.enabled) {
      this.provider = null;
      this.providerSource = 'disabled';
      this.activeCredentialId = null;
      this.activeCredentialName = null;
      this.activeModel = localConfig.model;
      this.activeBaseUrl = '';
      this.activeDimensions = localConfig.dimensions;
      this.activeBackend = localConfig.backend;
      this.activeCacheDir = localConfig.cacheDir;
      this.activeProfileId = buildProfileId('disabled', localConfig.model, localConfig.dimensions, localConfig.backend);
      this.logger.log('Embedding provider disabled by local config');
    } else {
      this.provider = buildLocalProvider(localConfig);
      this.providerSource = 'local';
      this.activeCredentialId = null;
      this.activeCredentialName = null;
      this.activeModel = localConfig.model;
      this.activeBaseUrl = `local-cache:${localConfig.cacheDir}#${localConfig.backend}`;
      this.activeDimensions = localConfig.dimensions;
      this.activeBackend = localConfig.backend;
      this.activeCacheDir = localConfig.cacheDir;
      this.activeProfileId = buildProfileId('local-transformers', localConfig.model, localConfig.dimensions, localConfig.backend);
      this.logger.log(`Embedding provider initialized locally: ${localConfig.model} (${localConfig.backend}) @ ${this.activeBaseUrl}`);
    }
  }

  getStatus(): EmbeddingStatus {
    if (this.providerSource === 'mock' || !this.provider) {
      if (this.providerSource === 'disabled') {
        return {
          provider: 'disabled',
          source: 'disabled',
          model: this.activeModel ?? DEFAULT_LOCAL_EMBEDDING_MODEL,
          dimensions: this.activeDimensions ?? DEFAULT_LOCAL_EMBEDDING_DIMENSIONS,
          baseUrlMasked: '(disabled)',
          configured: false,
          backend: this.activeBackend ?? undefined,
          cacheDir: this.activeCacheDir ?? undefined,
          profileId: this.activeProfileId,
          modelParameters: LOCAL_EMBEDDING_MODEL_PARAMETERS[this.activeModel ?? DEFAULT_LOCAL_EMBEDDING_MODEL],
        };
      }
      return {
        provider: 'mock',
        source: 'mock',
        model: 'mock',
        dimensions: this.provider?.getDimensions() ?? DEFAULT_LOCAL_EMBEDDING_DIMENSIONS,
        baseUrlMasked: '(mock)',
        configured: false,
      };
    }

    const baseUrl = this.activeBaseUrl ?? '';
    return {
      provider: this.providerSource === 'local' ? 'local-transformers' : isOllamaUrl(baseUrl) ? 'ollama' : 'openai-compatible',
      source: this.providerSource,
      model: this.activeModel ?? '',
      dimensions: this.activeDimensions ?? this.provider.getDimensions(),
      baseUrlMasked: maskUrl(baseUrl),
      configured: true,
      backend: this.activeBackend ?? undefined,
      activeBackend: this.provider.getActiveBackend?.() ?? undefined,
      gpuAvailable: this.providerSource === 'local' ? this.provider.isGpuAvailable?.() : undefined,
      cacheDir: this.activeCacheDir ?? undefined,
      profileId: this.activeProfileId,
      ...(this.providerSource === 'local' && {
        modelParameters: LOCAL_EMBEDDING_MODEL_PARAMETERS[this.activeModel ?? ''],
      }),
      ...(this.activeCredentialId && {
        activeCredentialId: this.activeCredentialId,
        activeCredentialName: this.activeCredentialName ?? undefined,
      }),
    };
  }

  async embedOne(text: string): Promise<number[]> {
    if (!this.provider) {
      await this.reloadFromCredential();
    }
    if (this.providerSource === 'disabled') {
      throw new Error('Embedding provider is disabled');
    }
    const results = await this.getProvider().embed([text]);
    return results[0]!;
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    if (!this.provider) {
      await this.reloadFromCredential();
    }
    if (this.providerSource === 'disabled') {
      throw new Error('Embedding provider is disabled');
    }
    return this.getProvider().embed(texts);
  }

  getDimensions(): number {
    return this.activeDimensions ?? parseInt(this.config.get<string>('EMBEDDING_DIMENSIONS', String(DEFAULT_LOCAL_EMBEDDING_DIMENSIONS)), 10);
  }

  async getModelName(): Promise<string> {
    if (this.activeModel) return this.activeModel;
    return this.config.get<string>('EMBEDDING_MODEL', DEFAULT_LOCAL_EMBEDDING_MODEL);
  }

  getProfileId(): string {
    return this.activeProfileId;
  }

  private getProvider(): IEmbeddingProvider {
    if (!this.provider) {
      this.logger.warn('getProvider() called before onModuleInit — returning mock');
      return new MockEmbeddingProvider();
    }
    return this.provider;
  }

  private async disposeProvider(): Promise<void> {
    const current = this.provider;
    this.provider = null;
    await current?.dispose?.();
  }
}
