import type { EmbeddingProviderConfig, IEmbeddingProvider } from './embedding-provider.types';
import { validateEmbeddingVectors } from './embedding-identity';

export const EMBEDDING_PROVIDER_TIMEOUT_MS = 30_000;

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
      signal: AbortSignal.timeout(EMBEDDING_PROVIDER_TIMEOUT_MS),
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
    if (sorted.some((item, index) => item.index !== index)) throw new Error('EMBEDDING_VECTORS_INVALID');
    const vectors = sorted.map((d) => d.embedding);
    validateEmbeddingVectors(vectors, texts.length, this.config.dimensions);
    return vectors;
  }

  getDimensions(): number {
    return this.config.dimensions;
  }
}

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
      body: JSON.stringify({ model: this.model, input: texts, dimensions: this.dimensions, truncate: false }),
      signal: AbortSignal.timeout(EMBEDDING_PROVIDER_TIMEOUT_MS),
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => 'unknown');
      throw new Error(`Ollama embedding error ${response.status}: ${errText}`);
    }

    const result = (await response.json()) as OllamaEmbeddingResponse;
    if (result.embeddings && Array.isArray(result.embeddings)) {
      validateEmbeddingVectors(result.embeddings, texts.length, this.dimensions);
      return result.embeddings;
    }
    if (result.embedding && Array.isArray(result.embedding)) {
      validateEmbeddingVectors([result.embedding], texts.length, this.dimensions);
      return [result.embedding];
    }
    throw new Error('Invalid Ollama embedding response');
  }

  getDimensions(): number {
    return this.dimensions;
  }
}

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
