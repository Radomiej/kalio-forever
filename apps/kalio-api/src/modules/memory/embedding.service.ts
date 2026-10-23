import { Injectable, Logger, OnModuleInit, Optional } from '@nestjs/common';
import { EmbeddingModelIdentityService } from './embedding-model-identity.service';
import { ConfigService } from '@nestjs/config';
import type { OnModuleDestroy } from '@nestjs/common';
import type { EmbeddingSpace, EmbeddingStatus } from '@kalio/types';
import { buildEmbeddingSpace, embeddingPromptVersions, GEMMA2_EMBEDDING_PROMPT_VERSION, isEmbeddingGemma2,
  preparePinnedEmbeddingTexts, RAW_EMBEDDING_PROMPT_VERSION, validateEmbeddingVectors,
  type EmbeddingPurpose } from './embedding-identity';
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
import { readEnvBooleanFlag } from '../../common/utils/llm-provider-http.util';

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

export function isOllamaUrl(baseUrl: string): boolean {
  try {
    const url = new URL(baseUrl);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
    const hostname = url.hostname.toLowerCase();
    const loopback = hostname === 'localhost' || hostname === '[::1]'
      || /^127(?:\.\d{1,3}){3}$/.test(hostname);
    return hostname.includes('ollama') || loopback && url.port === '11434';
  } catch {
    return false;
  }
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
    allowRemoteModels: false,
  });
}

function parseNumberOrDefault(value: string, fallback: number): number {
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function buildDefaultLocalEmbeddingConfig(config: ConfigService): LocalEmbeddingConfig {
  const hasRemoteEmbeddingEnv = Boolean(config.get<string>('EMBEDDING_API_KEY', '') && config.get<string>('EMBEDDING_BASE_URL', ''));
  const legacyLocalModel = hasRemoteEmbeddingEnv
    ? DEFAULT_LOCAL_EMBEDDING_MODEL
    : config.get<string>('EMBEDDING_MODEL', DEFAULT_LOCAL_EMBEDDING_MODEL);
  const legacyLocalDimensions = hasRemoteEmbeddingEnv
    ? DEFAULT_LOCAL_EMBEDDING_DIMENSIONS
    : parseNumberOrDefault(
      config.get<string>('EMBEDDING_DIMENSIONS', String(DEFAULT_LOCAL_EMBEDDING_DIMENSIONS)),
      DEFAULT_LOCAL_EMBEDDING_DIMENSIONS,
    );

  return {
    enabled: readEnvBooleanFlag(config.get<boolean | string>('EMBEDDING_ENABLED'), true),
    model: config.get<string>('EMBEDDING_LOCAL_MODEL', legacyLocalModel),
    dimensions: parseNumberOrDefault(
      config.get<string>('EMBEDDING_LOCAL_DIMENSIONS', String(legacyLocalDimensions)),
      legacyLocalDimensions,
    ),
    cacheDir: config.get<string>(
      'EMBEDDING_LOCAL_CACHE_DIR',
      config.get<string>('EMBEDDING_CACHE_DIR', DEFAULT_LOCAL_EMBEDDING_CACHE_DIR),
    ),
    backend: config.get<LocalEmbeddingBackend>(
      'EMBEDDING_LOCAL_BACKEND',
      config.get<LocalEmbeddingBackend>('EMBEDDING_BACKEND', DEFAULT_LOCAL_EMBEDDING_BACKEND),
    ),
  };
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
  private profileEpoch = 0;
  private activeModelRevision = 'unresolved';
  private activeProviderScope = 'unresolved';
  private identityRefresh: { epoch: number; promise: Promise<{ modelRevision: string; providerScope: string }> } | null = null;

  constructor(
    private readonly config: ConfigService,
    private readonly embeddingCredentials: EmbeddingCredentialsService,
    @Optional() private readonly identities: EmbeddingModelIdentityService = new EmbeddingModelIdentityService(),
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
    const epoch = this.profileEpoch + 1;
    await this.disposeProvider();
    if (epoch !== this.profileEpoch) throw new Error('EMBEDDING_SPACE_CHANGED');

    const active = await this.embeddingCredentials.getActiveConfig();
    if (epoch !== this.profileEpoch) throw new Error('EMBEDDING_SPACE_CHANGED');
    this.activeModelRevision = 'unresolved';
    this.activeProviderScope = 'unresolved';
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
      this.activeProfileId = this.buildActiveSpace(RAW_EMBEDDING_PROMPT_VERSION).id;
      this.logger.log(`Embedding provider loaded from DB: ${active.model} @ ${maskUrl(active.baseUrl)}`);
      return;
    }

    const configuredProvider = this.config.get<string>('EMBEDDING_PROVIDER', '').trim().toLowerCase();
    if (configuredProvider === 'mock') {
      this.provider = new MockEmbeddingProvider();
      this.providerSource = 'mock';
      this.activeCredentialId = null;
      this.activeCredentialName = null;
      this.activeModel = 'mock';
      this.activeBaseUrl = 'mock';
      this.activeDimensions = this.provider.getDimensions();
      this.activeBackend = null;
      this.activeCacheDir = null;
      this.activeProfileId = this.buildActiveSpace(RAW_EMBEDDING_PROMPT_VERSION).id;
      this.logger.log('Embedding provider initialized from explicit mock configuration');
      return;
    }

    // No DB credential — prefer explicit remote embeddings config when present,
    // otherwise fall back to the auto-downloaded local model.
    // We deliberately do NOT fall back to LLM_API_KEY / LLM_BASE_URL:
    // an LLM key may not support the embeddings API, and silently inheriting
    // it causes confusing runtime failures.
    const apiKey = this.config.get<string>('EMBEDDING_API_KEY', '');
    const baseUrl = this.config.get<string>('EMBEDDING_BASE_URL', '');
    const localDefaults = buildDefaultLocalEmbeddingConfig(this.config);
    const localConfig = await this.embeddingCredentials.getLocalConfig(localDefaults);
    const remoteModel = this.config.get<string>('EMBEDDING_MODEL', DEFAULT_REMOTE_EMBEDDING_MODEL);
    const remoteDimensions = parseInt(
      this.config.get<string>('EMBEDDING_DIMENSIONS', String(DEFAULT_REMOTE_EMBEDDING_DIMENSIONS)),
      10,
    );
    const forceLocal = this.config.get<string>('EMBEDDING_FORCE_LOCAL', 'false') === 'true'
      || await this.embeddingCredentials.shouldForceLocal();
    if (epoch !== this.profileEpoch) throw new Error('EMBEDDING_SPACE_CHANGED');

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
      this.activeProfileId = this.buildActiveSpace(RAW_EMBEDDING_PROMPT_VERSION).id;
      this.logger.log(`Embedding provider initialized from env: ${remoteModel} @ ${maskUrl(baseUrl)}`);
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
      this.activeProfileId = this.buildActiveSpace(RAW_EMBEDDING_PROMPT_VERSION).id;
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
      this.activeProfileId = this.buildActiveSpace(RAW_EMBEDDING_PROMPT_VERSION).id;
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
        configured: this.providerSource === 'mock' && this.provider !== null,
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

  /** Legacy methods deliberately send raw text. Gemma2 task prefixes belong only
   * to embedPinned's different space identity; migration must reindex vectors. */
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
    return this.activeDimensions ?? buildDefaultLocalEmbeddingConfig(this.config).dimensions;
  }

  async getModelName(): Promise<string> {
    if (this.activeModel) return this.activeModel;
    return buildDefaultLocalEmbeddingConfig(this.config).model;
  }

  getProfileId(): string {
    return this.activeProfileId;
  }

  captureSpace(): EmbeddingSpace {
    if (!this.provider || this.providerSource === 'disabled') throw new Error('EMBEDDING_SPACE_UNAVAILABLE');
    return this.buildActiveSpace(isEmbeddingGemma2(this.activeModel ?? '')
      ? GEMMA2_EMBEDDING_PROMPT_VERSION : RAW_EMBEDDING_PROMPT_VERSION);
  }

  async ensureCurrentIdentity(): Promise<{ modelRevision: string; providerScope: string }> {
    const epoch = this.profileEpoch;
    if (this.identityRefresh?.epoch === epoch) return this.identityRefresh.promise;
    const promise = this.refreshIdentity(epoch);
    this.identityRefresh = { epoch, promise };
    try { return await promise; } finally {
      if (this.identityRefresh?.promise === promise) this.identityRefresh = null;
    }
  }

  private async refreshIdentity(epoch: number): Promise<{ modelRevision: string; providerScope: string }> {
    const identity = this.providerSource === 'local'
      ? this.provider?.getModelIdentity?.() ?? { modelRevision: 'unresolved', providerScope: 'unresolved' }
      : this.getStatus().provider === 'ollama' && this.provider
      ? await this.identities.resolve(this.activeBaseUrl ?? '', this.activeModel ?? '',
        this.activeCredentialId ? `credential:${this.activeCredentialId}` : `source:${this.providerSource}`)
      : { modelRevision: 'unresolved', providerScope: 'unresolved' };
    if (epoch !== this.profileEpoch) throw new Error('EMBEDDING_SPACE_CHANGED');
    if (identity.modelRevision !== this.activeModelRevision || identity.providerScope !== this.activeProviderScope) {
      ++this.profileEpoch;
      this.activeModelRevision = identity.modelRevision;
      this.activeProviderScope = identity.providerScope;
      this.activeProfileId = this.buildActiveSpace(RAW_EMBEDDING_PROMPT_VERSION).id;
    }
    return identity;
  }

  async embedPinned(space: EmbeddingSpace, texts: string[], purpose: EmbeddingPurpose = 'document'): Promise<number[][]> {
    const initial = this.captureSpace();
    if (!space || Object.keys(initial).some(key => space[key as keyof EmbeddingSpace] !== initial[key as keyof EmbeddingSpace])) throw new Error('EMBEDDING_SPACE_CHANGED');
    if (!texts.length) return [];
    // Legacy ordinary memory can still use unresolved providers. Project resources
    // enforce producer/inference trust separately before reaching this method.
    const refreshIdentity = space.modelRevision !== 'unresolved' && space.providerScope !== 'unresolved';
    if (refreshIdentity) await this.ensureCurrentIdentity();
    const provider = this.provider;
    const epoch = this.profileEpoch;
    const expected = this.captureSpace();
    const matches = () => !!space && Object.keys(expected).every(key =>
      space[key as keyof EmbeddingSpace] === expected[key as keyof EmbeddingSpace]);
    if (!provider || !matches()) throw new Error('EMBEDDING_SPACE_CHANGED');
    const input = preparePinnedEmbeddingTexts(expected, texts, purpose);
    const fits = refreshIdentity ? await provider.getInputSizer?.() : undefined;
    if (fits && input.some(text => !fits(text))) throw new Error('EMBEDDING_INPUT_TOO_LONG');
    if (epoch !== this.profileEpoch || provider !== this.provider || !matches()) throw new Error('EMBEDDING_SPACE_CHANGED');
    const vectors = input.length ? await provider.embed(input) : [];
    // Metadata checks do not prove digest-pinned inference (including hidden ABA).
    if (refreshIdentity) await this.ensureCurrentIdentity();
    if (epoch !== this.profileEpoch || provider !== this.provider || !matches()) throw new Error('EMBEDDING_SPACE_CHANGED');
    validateEmbeddingVectors(vectors, input.length, expected.dimensions);
    return vectors;
  }

  async getDocumentSizer(space: EmbeddingSpace): Promise<((text: string) => boolean) | undefined> {
    const provider = this.provider; const epoch = this.profileEpoch;
    const assertCurrent = () => {
      if (!provider || provider !== this.provider || epoch !== this.profileEpoch
        || this.captureSpace().id !== space.id) throw new Error('EMBEDDING_SPACE_CHANGED');
    };
    assertCurrent();
    const fits = await provider?.getInputSizer?.();
    assertCurrent();
    if (!fits) return undefined;
    return text => { assertCurrent(); return fits(preparePinnedEmbeddingTexts(space, [text], 'document')[0]!); };
  }

  private buildActiveSpace(promptVersion: string): EmbeddingSpace {
    const provider = this.providerSource === 'local' ? 'local-transformers'
      : this.providerSource === 'mock' || this.providerSource === 'disabled' ? this.providerSource
      : isOllamaUrl(this.activeBaseUrl ?? '') ? 'ollama' : 'openai-compatible';
    return buildEmbeddingSpace({ provider, providerScope: this.activeProviderScope,
      model: this.activeModel ?? '', modelRevision: this.activeModelRevision,
      dimensions: this.activeDimensions ?? 0, backend: this.activeBackend ?? '',
      baseUrl: this.activeBaseUrl ?? '', promptVersion, ...embeddingPromptVersions(promptVersion) });
  }

  private getProvider(): IEmbeddingProvider {
    if (!this.provider) {
      this.logger.warn('getProvider() called before onModuleInit — returning mock');
      return new MockEmbeddingProvider();
    }
    return this.provider;
  }

  private async disposeProvider(): Promise<void> {
    ++this.profileEpoch;
    const current = this.provider;
    this.provider = null;
    await current?.dispose?.();
  }
}
