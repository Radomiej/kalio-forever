import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { EmbeddingStatus } from '@kalio/types';
import { AppSettingsService } from '../../database/app-settings.service';

// ── Interfaces ──────────────────────────────────────────────────────────────

export interface IEmbeddingProvider {
  embed(texts: string[]): Promise<number[][]>;
  getDimensions(): number;
}

export interface EmbeddingProviderConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
  dimensions: number;
}

// ── OpenAI-compatible provider ─────────────────────────────────────────────

interface EmbeddingAPIResponse {
  data: Array<{ embedding: number[]; index: number }>;
  model: string;
  usage?: { prompt_tokens: number; total_tokens: number };
}

export class OpenAICompatibleEmbeddingProvider implements IEmbeddingProvider {
  private readonly config: EmbeddingProviderConfig;

  constructor(config: EmbeddingProviderConfig) {
    this.config = config;
  }

  async embed(texts: string[]): Promise<number[][]> {
    const url = `${this.config.baseUrl.replace(/\/$/, '')}/embeddings`;
    const body = JSON.stringify({
      model: this.config.model,
      input: texts,
      dimensions: this.config.dimensions,
    });

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.config.apiKey}`,
      },
      body,
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => 'unknown');
      throw new Error(`Embedding API error ${response.status}: ${errText}`);
    }

    const result = (await response.json()) as EmbeddingAPIResponse;
    if (!result.data || !Array.isArray(result.data)) {
      throw new Error('Invalid embedding API response: missing data array');
    }

    const sorted = result.data.sort((a, b) => a.index - b.index);
    return sorted.map((d) => d.embedding);
  }

  getDimensions(): number {
    return this.config.dimensions;
  }
}

// ── Ollama provider ───────────────────────────────────────────────────────

interface OllamaEmbeddingResponse {
  embedding?: number[];
  embeddings?: number[][];
}

export class OllamaEmbeddingProvider implements IEmbeddingProvider {
  private readonly baseUrl: string;
  private readonly model: string;
  private readonly dimensions: number;

  constructor(baseUrl: string, model: string, dimensions: number) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.model = model;
    this.dimensions = dimensions;
  }

  async embed(texts: string[]): Promise<number[][]> {
    const url = `${this.baseUrl}/api/embed`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: this.model, input: texts }),
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => 'unknown');
      throw new Error(`Ollama embedding error ${response.status}: ${errText}`);
    }

    const result = (await response.json()) as OllamaEmbeddingResponse;
    if (result.embeddings && Array.isArray(result.embeddings)) {
      return result.embeddings;
    }
    if (result.embedding && Array.isArray(result.embedding)) {
      return [result.embedding];
    }
    throw new Error('Invalid Ollama embedding response');
  }

  getDimensions(): number {
    return this.dimensions;
  }
}

// ── MockEmbeddingProvider ─────────────────────────────────────────────────

export class MockEmbeddingProvider implements IEmbeddingProvider {
  private readonly dimensions: number;

  constructor(dimensions = 1536) {
    this.dimensions = dimensions;
  }

  async embed(texts: string[]): Promise<number[][]> {
    return texts.map(() => Array<number>(this.dimensions).fill(0.1));
  }

  getDimensions(): number {
    return this.dimensions;
  }
}

// ── EmbeddingService ────────────────────────────────────────────────────────

@Injectable()
export class EmbeddingService implements OnModuleInit {
  private readonly logger = new Logger(EmbeddingService.name);
  private provider: IEmbeddingProvider | null = null;

  constructor(
    private readonly config: ConfigService,
    private readonly appSettings: AppSettingsService,
  ) {}

  async onModuleInit(): Promise<void> {
    // Load persisted config from DB and initialise provider eagerly
    await this.loadFromSettings();
  }

  private async loadFromSettings(): Promise<void> {
    const storedKey = await this.appSettings.get('embedding.api_key');
    const storedUrl = await this.appSettings.get('embedding.base_url');
    const storedModel = await this.appSettings.get('embedding.model');
    const storedDims = await this.appSettings.get('embedding.dimensions');

    if (storedUrl && storedKey) {
      const model = storedModel ?? 'text-embedding-3-small';
      const dimensions = storedDims ? parseInt(storedDims, 10) : 1536;
      this.provider = this.buildProvider(storedKey, storedUrl, model, dimensions);
      this.logger.log(`Embedding provider loaded from app_settings: ${model} @ ${storedUrl}`);
    }
    // If no stored config, getProvider() will fall back to env vars lazily
  }

  private buildProvider(
    apiKey: string,
    baseUrl: string,
    model: string,
    dimensions: number,
  ): IEmbeddingProvider {
    const isOllama = baseUrl.includes('localhost:11434') || baseUrl.includes('ollama');
    if (isOllama) {
      this.logger.log(`Ollama embedding provider: ${model}`);
      return new OllamaEmbeddingProvider(baseUrl, model, dimensions);
    }
    this.logger.log(`OpenAI-compatible embedding provider: ${model} @ ${baseUrl}`);
    return new OpenAICompatibleEmbeddingProvider({ apiKey, baseUrl, model, dimensions });
  }

  /**
   * Reconfigure the embedding provider at runtime and persist to DB.
   * Pass null apiKey to leave existing key unchanged.
   */
  async reconfigure(cfg: {
    baseUrl: string;
    apiKey: string | null;
    model: string;
    dimensions: number;
  }): Promise<void> {
    await this.appSettings.set('embedding.base_url', cfg.baseUrl);
    await this.appSettings.set('embedding.model', cfg.model);
    await this.appSettings.set('embedding.dimensions', String(cfg.dimensions));

    const resolvedKey =
      cfg.apiKey ??
      (await this.appSettings.get('embedding.api_key')) ??
      this.config.get<string>('EMBEDDING_API_KEY', '') ??
      this.config.get<string>('LLM_API_KEY', '');

    if (cfg.apiKey) {
      await this.appSettings.set('embedding.api_key', cfg.apiKey);
    }

    this.provider = this.buildProvider(resolvedKey, cfg.baseUrl, cfg.model, cfg.dimensions);
    this.logger.log(`Embedding provider reconfigured: ${cfg.model} @ ${cfg.baseUrl}`);
  }

  private getProvider(): IEmbeddingProvider {
    if (this.provider) return this.provider;

    // Dedicated embedding config takes priority; fall back to chat LLM config
    const apiKey = this.config.get<string>('EMBEDDING_API_KEY', '')
      || this.config.get<string>('LLM_API_KEY', '');
    const baseUrl = this.config.get<string>('EMBEDDING_BASE_URL', '')
      || this.config.get<string>('LLM_BASE_URL', '');
    const model = this.config.get<string>('EMBEDDING_MODEL', 'text-embedding-3-small');
    const dimensions = this.config.get<number>('EMBEDDING_DIMENSIONS', 1536);

    if (!apiKey || !baseUrl || apiKey === 'mock' || baseUrl === 'mock') {
      this.logger.warn('Embedding provider not configured — using MockEmbeddingProvider (set EMBEDDING_BASE_URL + EMBEDDING_API_KEY for real embeddings)');
      this.provider = new MockEmbeddingProvider(dimensions);
      return this.provider;
    }

    // Warn if falling back to shared LLM config (many chat-only providers don't support /embeddings)
    const explicitEmbedUrl = this.config.get<string>('EMBEDDING_BASE_URL', '');
    if (!explicitEmbedUrl) {
      this.logger.warn(
        `EMBEDDING_BASE_URL not set — using LLM_BASE_URL (${baseUrl}) for embeddings. ` +
        'Set EMBEDDING_BASE_URL if your chat provider does not support /embeddings.',
      );
    }
    const explicitEmbedKey = this.config.get<string>('EMBEDDING_API_KEY', '');
    if (!explicitEmbedKey) {
      this.logger.warn(
        'EMBEDDING_API_KEY not set — using LLM_API_KEY for embeddings. ' +
        'Set EMBEDDING_API_KEY if your embedding provider uses a different key.',
      );
    }

    const isOllama = baseUrl.includes('localhost:11434') || baseUrl.includes('ollama');

    if (isOllama) {
      this.provider = new OllamaEmbeddingProvider(baseUrl, model, dimensions);
      this.logger.log(`Ollama embedding provider initialized: ${model}`);
    } else {
      this.provider = new OpenAICompatibleEmbeddingProvider({ apiKey, baseUrl, model, dimensions });
      this.logger.log(`OpenAI-compatible embedding provider initialized: ${model} @ ${baseUrl}`);
    }

    return this.provider;
  }

  getStatus(): EmbeddingStatus {
    // Prefer DB-persisted config, fall back to env vars
    const apiKeyEnv = this.config.get<string>('EMBEDDING_API_KEY', '')
      || this.config.get<string>('LLM_API_KEY', '');
    const baseUrlEnv = this.config.get<string>('EMBEDDING_BASE_URL', '')
      || this.config.get<string>('LLM_BASE_URL', '');
    const modelEnv = this.config.get<string>('EMBEDDING_MODEL', 'text-embedding-3-small');
    const dimensionsEnv = this.config.get<number>('EMBEDDING_DIMENSIONS', 1536);

    if (this.provider instanceof MockEmbeddingProvider) {
      return {
        provider: 'mock',
        model: 'mock',
        dimensions: this.provider.getDimensions(),
        baseUrlMasked: '(mock)',
        configured: false,
      };
    }

    // If provider is active (either from DB or env), report it as configured
    const hasProvider = this.provider !== null;
    const baseUrl = baseUrlEnv;
    const isOllama = baseUrl.includes('localhost:11434') || baseUrl.includes('ollama');

    let baseUrlMasked = '';
    try {
      const u = new URL(baseUrl);
      baseUrlMasked = `${u.protocol}//${u.host}`;
    } catch {
      baseUrlMasked = baseUrl ? '(invalid URL)' : '(not set)';
    }

    const hasDedicatedUrl = !!this.config.get<string>('EMBEDDING_BASE_URL', '');

    return {
      provider: isOllama ? 'ollama' : 'openai-compatible',
      model: modelEnv,
      dimensions: dimensionsEnv,
      baseUrlMasked: hasProvider
        ? baseUrlMasked
        : hasDedicatedUrl ? baseUrlMasked : `${baseUrlMasked} (shared with LLM)`,
      configured:
        hasProvider ||
        (!!apiKeyEnv && apiKeyEnv !== 'mock' && !!baseUrl && baseUrl !== 'mock'),
    };
  }

  async embedOne(text: string): Promise<number[]> {
    const results = await this.getProvider().embed([text]);
    return results[0]!;
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    return this.getProvider().embed(texts);
  }

  getDimensions(): number {
    return this.getProvider().getDimensions();
  }
}
