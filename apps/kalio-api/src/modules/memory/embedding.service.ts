import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { EmbeddingStatus } from '@kalio/types';

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
export class EmbeddingService {
  private readonly logger = new Logger(EmbeddingService.name);
  private provider: IEmbeddingProvider | null = null;

  constructor(private readonly config: ConfigService) {}

  private getProvider(): IEmbeddingProvider {
    if (this.provider) return this.provider;

    const apiKey = this.config.get<string>('LLM_API_KEY', '');
    const baseUrl = this.config.get<string>('LLM_BASE_URL', '');
    const model = this.config.get<string>('EMBEDDING_MODEL', 'text-embedding-3-small');
    const dimensions = this.config.get<number>('EMBEDDING_DIMENSIONS', 1536);

    if (!apiKey || !baseUrl || apiKey === 'mock' || baseUrl === 'mock') {
      this.logger.warn('Embedding provider not configured — using MockEmbeddingProvider');
      this.provider = new MockEmbeddingProvider(dimensions);
      return this.provider;
    }

    const isOllama = baseUrl.includes('localhost:11434') || baseUrl.includes('ollama');

    if (isOllama) {
      this.provider = new OllamaEmbeddingProvider(baseUrl, model, dimensions);
      this.logger.log(`Ollama embedding provider initialized: ${model}`);
    } else {
      this.provider = new OpenAICompatibleEmbeddingProvider({
        apiKey,
        baseUrl,
        model,
        dimensions,
      });
      this.logger.log(`OpenAI-compatible embedding provider initialized: ${model}`);
    }

    return this.provider;
  }

  getStatus(): EmbeddingStatus {
    const apiKey = this.config.get<string>('LLM_API_KEY', '');
    const baseUrl = this.config.get<string>('LLM_BASE_URL', '');
    const model = this.config.get<string>('EMBEDDING_MODEL', 'text-embedding-3-small');
    const dimensions = this.config.get<number>('EMBEDDING_DIMENSIONS', 1536);

    const isOllama = baseUrl.includes('localhost:11434') || baseUrl.includes('ollama');

    let baseUrlMasked = '';
    try {
      const u = new URL(baseUrl);
      baseUrlMasked = `${u.protocol}//${u.host}`;
    } catch {
      baseUrlMasked = baseUrl ? '(invalid URL)' : '(not set)';
    }

    return {
      provider: isOllama ? 'ollama' : 'openai-compatible',
      model,
      dimensions,
      baseUrlMasked,
      configured: !!apiKey && apiKey !== 'mock' && !!baseUrl && baseUrl !== 'mock',
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
