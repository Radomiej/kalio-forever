import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { EmbeddingStatus } from '@kalio/types';
import { EmbeddingCredentialsService } from './embedding-credentials.service';

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

// ── Helpers ───────────────────────────────────────────────────────────────

function maskUrl(baseUrl: string): string {
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

// ── EmbeddingService ────────────────────────────────────────────────────────

@Injectable()
export class EmbeddingService implements OnModuleInit {
  private readonly logger = new Logger(EmbeddingService.name);
  private provider: IEmbeddingProvider | null = null;
  private providerSource: 'db' | 'env' | 'mock' = 'mock';
  private activeCredentialId: string | null = null;
  private activeCredentialName: string | null = null;
  private activeModel: string | null = null;
  private activeBaseUrl: string | null = null;
  private activeDimensions: number | null = null;

  constructor(
    private readonly config: ConfigService,
    private readonly embeddingCredentials: EmbeddingCredentialsService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.reloadFromCredential();
  }

  /**
   * Called on startup and after any credential CRUD to refresh the provider.
   */
  async reloadFromCredential(): Promise<void> {
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
      this.logger.log(`Embedding provider loaded from DB credential "${active.name}": ${active.model} @ ${active.baseUrl}`);
      return;
    }

    // No DB credential — check env vars
    const apiKey = this.config.get<string>('EMBEDDING_API_KEY', '')
      || this.config.get<string>('LLM_API_KEY', '');
    const baseUrl = this.config.get<string>('EMBEDDING_BASE_URL', '')
      || this.config.get<string>('LLM_BASE_URL', '');
    const model = this.config.get<string>('EMBEDDING_MODEL', 'text-embedding-3-small');
    const dimensions = parseInt(this.config.get<string>('EMBEDDING_DIMENSIONS', '1536'), 10);

    if (apiKey && baseUrl && apiKey !== 'mock' && baseUrl !== 'mock') {
      this.provider = buildProvider({ apiKey, baseUrl, model, dimensions });
      this.providerSource = 'env';
      this.activeCredentialId = null;
      this.activeCredentialName = null;
      this.activeModel = model;
      this.activeBaseUrl = baseUrl;
      this.activeDimensions = dimensions;
      this.logger.log(`Embedding provider initialized from env: ${model} @ ${baseUrl}`);
    } else {
      this.provider = new MockEmbeddingProvider(dimensions);
      this.providerSource = 'mock';
      this.activeCredentialId = null;
      this.activeCredentialName = null;
      this.activeModel = null;
      this.activeBaseUrl = null;
      this.activeDimensions = null;
      this.logger.warn('Embedding provider not configured — using MockEmbeddingProvider');
    }
  }

  getStatus(): EmbeddingStatus {
    if (this.providerSource === 'mock' || !this.provider) {
      return {
        provider: 'mock',
        source: 'mock',
        model: 'mock',
        dimensions: this.provider?.getDimensions() ?? 1536,
        baseUrlMasked: '(mock)',
        configured: false,
      };
    }

    const baseUrl = this.activeBaseUrl ?? '';
    return {
      provider: isOllamaUrl(baseUrl) ? 'ollama' : 'openai-compatible',
      source: this.providerSource,
      model: this.activeModel ?? '',
      dimensions: this.activeDimensions ?? this.provider.getDimensions(),
      baseUrlMasked: maskUrl(baseUrl),
      configured: true,
      ...(this.activeCredentialId && {
        activeCredentialId: this.activeCredentialId,
        activeCredentialName: this.activeCredentialName ?? undefined,
      }),
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

  async getModelName(): Promise<string> {
    if (this.activeModel) return this.activeModel;
    return this.config.get<string>('EMBEDDING_MODEL', 'text-embedding-3-small');
  }

  private getProvider(): IEmbeddingProvider {
    if (!this.provider) {
      this.logger.warn('getProvider() called before onModuleInit — returning mock');
      return new MockEmbeddingProvider();
    }
    return this.provider;
  }
}
