import type { EmbeddingProviderConfig, IEmbeddingProvider } from './embedding-provider.types';

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
