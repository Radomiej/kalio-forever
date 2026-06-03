import { Logger } from '@nestjs/common';
import { env, pipeline } from '@huggingface/transformers';
import fs from 'node:fs';
import path from 'node:path';

import type { IEmbeddingProvider } from './embedding-provider.types';

export const DEFAULT_LOCAL_EMBEDDING_MODEL = 'Xenova/multilingual-e5-small';
export const DEFAULT_LOCAL_EMBEDDING_DIMENSIONS = 384;
export const DEFAULT_LOCAL_EMBEDDING_BACKEND = 'cpu';
export const LOCAL_EMBEDDING_MODEL_PARAMETERS: Record<string, string> = {
  'Xenova/multilingual-e5-small': '118M',
  'Xenova/paraphrase-multilingual-MiniLM-L12-v2': '118M',
  'Xenova/multilingual-e5-base': '278M',
  'Xenova/distiluse-base-multilingual-cased-v2': '135M',
};

export type LocalEmbeddingBackend = 'auto' | 'webgpu' | 'cpu';
export type ActiveLocalEmbeddingBackend = 'webgpu' | 'cpu';

type FeatureExtractionOutput = { data: ArrayLike<number> };
type FeatureExtractor = ((
  text: string,
  options?: { pooling: 'mean'; normalize: true }
) => Promise<FeatureExtractionOutput>) & {
  dispose?: () => Promise<void> | void;
};

interface FeatureExtractionPipelineOptions {
  device?: 'webgpu' | 'cpu';
  dtype?: 'fp16' | 'q8';
}

type FeatureExtractionPipelineFactory = (
  task: 'feature-extraction',
  model: string,
  options?: FeatureExtractionPipelineOptions
) => Promise<FeatureExtractor>;

interface LocalTransformersEmbeddingProviderConfig {
  model: string;
  dimensions: number;
  cacheDir: string;
  backend: LocalEmbeddingBackend;
}

function toVector(output: unknown): number[] {
  if (typeof output !== 'object' || output === null || !('data' in output)) {
    throw new Error('Invalid Hugging Face embedding output');
  }

  const data = (output as { data: ArrayLike<number> }).data;
  return Array.from(data);
}

export class LocalTransformersEmbeddingProvider implements IEmbeddingProvider {
  private readonly logger = new Logger(LocalTransformersEmbeddingProvider.name);
  private extractor: Promise<FeatureExtractor> | null = null;
  private activeBackend: ActiveLocalEmbeddingBackend | null = null;

  constructor(private readonly config: LocalTransformersEmbeddingProviderConfig) {
    const cacheDir = path.resolve(this.config.cacheDir);
    fs.mkdirSync(cacheDir, { recursive: true });
    env.cacheDir = cacheDir;
    env.allowRemoteModels = true;
  }

  private async createExtractor(): Promise<FeatureExtractor> {
    const pipelineFactory = pipeline as unknown as FeatureExtractionPipelineFactory;

    if (this.config.backend === 'webgpu') {
      const extractor = await pipelineFactory('feature-extraction', this.config.model, { device: 'webgpu', dtype: 'fp16' });
      this.activeBackend = 'webgpu';
      return extractor;
    }

    if (this.config.backend === 'cpu') {
      const extractor = await pipelineFactory('feature-extraction', this.config.model, { device: 'cpu', dtype: 'q8' });
      this.activeBackend = 'cpu';
      return extractor;
    }

    if (process.platform === 'win32') {
      const extractor = await pipelineFactory('feature-extraction', this.config.model, { device: 'cpu', dtype: 'q8' });
      this.activeBackend = 'cpu';
      return extractor;
    }

    try {
      const extractor = await pipelineFactory('feature-extraction', this.config.model, { device: 'webgpu', dtype: 'fp16' });
      this.activeBackend = 'webgpu';
      return extractor;
    } catch (err) {
      this.logger.warn(`WebGPU unavailable for ${this.config.model}, falling back to CPU`, err instanceof Error ? err : new Error(String(err)));
      const extractor = await pipelineFactory('feature-extraction', this.config.model, { device: 'cpu', dtype: 'q8' });
      this.activeBackend = 'cpu';
      return extractor;
    }
  }

  private async getExtractor(): Promise<FeatureExtractor> {
    if (!this.extractor) {
      this.extractor = this.createExtractor().catch((err: unknown) => {
        this.extractor = null;
        throw err;
      });
    }

    return this.extractor;
  }

  async embed(texts: string[]): Promise<number[][]> {
    const extractor = await this.getExtractor();

    try {
      const outputs = await Promise.all(
        texts.map(async (text) => {
          const output = await extractor(text, {
            pooling: 'mean',
            normalize: true,
          });
          return toVector(output);
        })
      );

      return outputs;
    } catch (err) {
      this.logger.error(`Failed to embed texts with local model ${this.config.model}`, err instanceof Error ? err : new Error(String(err)));
      throw err;
    }
  }

  getDimensions(): number {
    return this.config.dimensions;
  }

  getActiveBackend(): ActiveLocalEmbeddingBackend | null {
    return this.activeBackend;
  }

  isGpuAvailable(): boolean | undefined {
    if (this.activeBackend === 'webgpu') return true;
    if (this.activeBackend === 'cpu' && this.config.backend !== 'cpu') return false;
    return undefined;
  }

  async dispose(): Promise<void> {
    const extractor = await this.extractor;
    await extractor?.dispose?.();
    this.extractor = null;
    this.activeBackend = null;
  }
}
