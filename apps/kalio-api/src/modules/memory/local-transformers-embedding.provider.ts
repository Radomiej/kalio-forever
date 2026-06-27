import { Logger } from '@nestjs/common';
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
  local_files_only?: boolean;
  progress_callback?: (progress: unknown) => void;
}

type FeatureExtractionPipelineFactory = (
  task: 'feature-extraction',
  model: string,
  options?: FeatureExtractionPipelineOptions
) => Promise<FeatureExtractor>;

type TransformersDependency = {
  env: {
    cacheDir: string;
    allowRemoteModels: boolean;
  };
  pipeline: FeatureExtractionPipelineFactory;
};

let transformersRuntime: Promise<TransformersDependency> | null = null;

async function loadTransformersRuntime(): Promise<TransformersDependency> {
  if (!transformersRuntime) {
    transformersRuntime = import('@huggingface/transformers').then((mod) => {
      const dependency = mod as unknown as TransformersDependency;
      if (typeof dependency.pipeline !== 'function') {
        throw new Error('Invalid transformers runtime: missing pipeline factory');
      }
      return dependency;
    });
  }

  return transformersRuntime;
}

interface LocalTransformersEmbeddingProviderConfig {
  model: string;
  dimensions: number;
  cacheDir: string;
  backend: LocalEmbeddingBackend;
  allowRemoteModels?: boolean;
  progressCallback?: (progress: unknown) => void;
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
  private readonly cacheDir: string;

  constructor(private readonly config: LocalTransformersEmbeddingProviderConfig) {
    this.cacheDir = path.resolve(this.config.cacheDir);
    fs.mkdirSync(this.cacheDir, { recursive: true });
  }

  static isMissingLocalModelError(err: unknown): boolean {
    const message = err instanceof Error ? err.message : String(err);
    return /file was not found locally/i.test(message)
      || /local_files_only=true/i.test(message)
      || /allowRemoteModels=false/i.test(message);
  }

  private buildPipelineOptions(device: 'webgpu' | 'cpu', dtype: 'fp16' | 'q8'): FeatureExtractionPipelineOptions {
    return {
      device,
      dtype,
      local_files_only: !(this.config.allowRemoteModels ?? false),
      progress_callback: this.config.progressCallback,
    };
  }

  private async createExtractor(): Promise<FeatureExtractor> {
    const { env, pipeline: pipelineFactory } = await loadTransformersRuntime();
    env.cacheDir = this.cacheDir;
    env.allowRemoteModels = this.config.allowRemoteModels ?? false;

    if (this.config.backend === 'webgpu') {
      const extractor = await pipelineFactory('feature-extraction', this.config.model, this.buildPipelineOptions('webgpu', 'fp16'));
      this.activeBackend = 'webgpu';
      return extractor;
    }

    if (this.config.backend === 'cpu') {
      const extractor = await pipelineFactory('feature-extraction', this.config.model, this.buildPipelineOptions('cpu', 'q8'));
      this.activeBackend = 'cpu';
      return extractor;
    }

    if (process.platform === 'win32') {
      const extractor = await pipelineFactory('feature-extraction', this.config.model, this.buildPipelineOptions('cpu', 'q8'));
      this.activeBackend = 'cpu';
      return extractor;
    }

    try {
      const extractor = await pipelineFactory('feature-extraction', this.config.model, this.buildPipelineOptions('webgpu', 'fp16'));
      this.activeBackend = 'webgpu';
      return extractor;
    } catch (err) {
      this.logger.warn(`WebGPU unavailable for ${this.config.model}, falling back to CPU`, err instanceof Error ? err : new Error(String(err)));
      const extractor = await pipelineFactory('feature-extraction', this.config.model, this.buildPipelineOptions('cpu', 'q8'));
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

  async prepare(): Promise<void> {
    await this.getExtractor();
  }

  async isInstalled(): Promise<boolean> {
    try {
      await this.prepare();
      return true;
    } catch (err) {
      if (LocalTransformersEmbeddingProvider.isMissingLocalModelError(err)) {
        return false;
      }
      throw err;
    }
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
