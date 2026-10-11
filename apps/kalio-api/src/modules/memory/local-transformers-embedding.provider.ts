import { Logger } from '@nestjs/common';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

import type { IEmbeddingProvider } from './embedding-provider.types';

export const DEFAULT_LOCAL_EMBEDDING_MODEL = 'Xenova/multilingual-e5-small';
// Verified public HF commit. Catalog updates create a different embedding space.
const DEFAULT_LOCAL_MODEL_REVISION = '761b726dd34fb83930e26aab4e9ac3899aa1fa78';
export const DEFAULT_LOCAL_EMBEDDING_DIMENSIONS = 384;
export const DEFAULT_LOCAL_EMBEDDING_BACKEND = 'cpu';
export const GEMMA2_LOCAL_EMBEDDING_MODEL = 'onnx-community/embeddinggemma-2-ONNX';
export const GEMMA2_LOCAL_EMBEDDING_REVISION = 'daa72c51243991dfcaf9f9137d2c573d8f7790c0';
export const GEMMA2_LOCAL_EMBEDDING_DIMENSIONS = 768;
export const GEMMA2_LOCAL_EMBEDDING_MAX_TOKENS = 8192;
export const LOCAL_EMBEDDING_MODEL_PARAMETERS: Record<string, string> = {
  'Xenova/multilingual-e5-small': '118M',
  'Xenova/paraphrase-multilingual-MiniLM-L12-v2': '118M',
  'Xenova/multilingual-e5-base': '278M',
  'Xenova/distiluse-base-multilingual-cased-v2': '135M',
  [GEMMA2_LOCAL_EMBEDDING_MODEL]: '270M · 175 MB q4 text model',
};

export type LocalEmbeddingBackend = 'auto' | 'webgpu' | 'cpu';
export type ActiveLocalEmbeddingBackend = 'webgpu' | 'cpu';

type FeatureExtractionOutput = { data: ArrayLike<number> };
type FeatureExtractor = ((
  text: string,
  options?: { pooling: 'mean'; normalize: true }
) => Promise<FeatureExtractionOutput>) & {
  dispose?: () => Promise<void> | void;
  tokenizer?: (text: string, options: { padding: false; truncation: false }) => { input_ids: { size: number } };
};

interface FeatureExtractionPipelineOptions {
  revision?: string;
  cache_dir?: string;
  device?: 'webgpu' | 'cpu';
  dtype?: 'fp16' | 'q8' | 'q4';
  local_files_only?: boolean;
  progress_callback?: (progress: unknown) => void;
  config?: TransformersModelConfig;
}

interface TransformersModelConfig {
  audio_config?: unknown | null;
  vision_config?: unknown | null;
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
    allowLocalModels?: boolean;
    localModelPath?: string;
    remotePathTemplate?: string;
  };
  pipeline: FeatureExtractionPipelineFactory;
  AutoConfig: { from_pretrained(model: string, options: FeatureExtractionPipelineOptions): Promise<TransformersModelConfig> };
  AutoTokenizer: { from_pretrained(model: string, options: FeatureExtractionPipelineOptions): Promise<unknown> };
  AutoModel: { from_pretrained(model: string, options: FeatureExtractionPipelineOptions): Promise<{ dispose(): Promise<void> }> };
  FeatureExtractionPipeline: new (args: { task: string; model: unknown; tokenizer: unknown }) => FeatureExtractor;
};

let transformersRuntime: Promise<TransformersDependency> | null = null;
// Transformers 4.2 file-load deduplication omits revision/cache from its key.
// Hold the global environment through the whole load, including CPU fallback.
let pipelineLoadQueue: Promise<void> = Promise.resolve();

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
  private disposed = false;
  private disposal: Promise<void> | null = null;
  private readonly activeInference = new Set<Promise<number[][]>>();
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

  private getModelRevision(): string | undefined {
    if (this.config.model === DEFAULT_LOCAL_EMBEDDING_MODEL) return DEFAULT_LOCAL_MODEL_REVISION;
    if (this.config.model === GEMMA2_LOCAL_EMBEDDING_MODEL) return GEMMA2_LOCAL_EMBEDDING_REVISION;
    return undefined;
  }

  private buildPipelineOptions(device: 'webgpu' | 'cpu', fallbackDtype: 'fp16' | 'q8'): FeatureExtractionPipelineOptions {
    return {
      revision: this.getModelRevision(),
      cache_dir: this.cacheDir,
      device,
      dtype: this.config.model === GEMMA2_LOCAL_EMBEDDING_MODEL ? 'q4' : fallbackDtype,
      local_files_only: !(this.config.allowRemoteModels ?? false),
      progress_callback: this.config.progressCallback,
    };
  }

  private async createExtractor(): Promise<FeatureExtractor> {
    const previous = pipelineLoadQueue;
    let release!: () => void;
    pipelineLoadQueue = new Promise<void>(resolve => { release = resolve; });
    await previous;
    try {
      const runtime = await loadTransformersRuntime();
      const saved = { cacheDir: runtime.env.cacheDir, allowRemoteModels: runtime.env.allowRemoteModels,
        allowLocalModels: runtime.env.allowLocalModels, localModelPath: runtime.env.localModelPath,
        remotePathTemplate: runtime.env.remotePathTemplate };
      try {
        runtime.env.cacheDir = this.cacheDir;
        runtime.env.allowRemoteModels = this.config.allowRemoteModels ?? false;
        runtime.env.allowLocalModels = true;
        const revision = this.getModelRevision();
        if (revision) {
          runtime.env.localModelPath = path.join(this.cacheDir, '.pinned-local', revision);
          // Tokenizer discovery does not forward revision. Even its metadata
          // request must target the catalog commit, never mutable main.
          runtime.env.remotePathTemplate = `{model}/resolve/${revision}/`;
        }
        return await this.createExtractorInRuntime(async (task, model, options = {}) => {
          // Do not use pipeline(): v4 discovery omits revision/cache/offline options.
          // Offline discovery must inspect the exact revision directory, not
          // the legacy unversioned cache. Library owns all file reads.
          const tokenizerSource = revision && !this.config.allowRemoteModels
            ? path.join(this.cacheDir, model, revision) : model;
          const tokenizer = await runtime.AutoTokenizer.from_pretrained(tokenizerSource, options);
          const modelConfig = model === GEMMA2_LOCAL_EMBEDDING_MODEL
            ? await runtime.AutoConfig.from_pretrained(model, options)
            : undefined;
          if (modelConfig) {
            modelConfig.vision_config = null;
            modelConfig.audio_config = null;
          }
          const loaded = await runtime.AutoModel.from_pretrained(model, modelConfig ? { ...options, config: modelConfig } : options);
          try { return new runtime.FeatureExtractionPipeline({ task, model: loaded, tokenizer }); }
          catch (error) { await loaded.dispose(); throw error; }
        });
      } finally { Object.assign(runtime.env, saved); }
    } finally { release(); }
  }

  getModelIdentity(): { modelRevision: string; providerScope: string } | undefined {
    const effectiveBackend = this.config.backend === 'auto' && process.platform === 'win32' ? 'cpu' : this.config.backend;
    const modelRevision = this.config.model === DEFAULT_LOCAL_EMBEDDING_MODEL && this.config.backend === 'cpu'
      ? DEFAULT_LOCAL_MODEL_REVISION
      : this.config.model === GEMMA2_LOCAL_EMBEDDING_MODEL && effectiveBackend === 'cpu'
        ? GEMMA2_LOCAL_EMBEDDING_REVISION
        : undefined;
    if (!modelRevision || effectiveBackend !== 'cpu') return undefined;
    return { modelRevision,
      providerScope: `scope-${createHash('sha256').update(JSON.stringify([
        'hf-pinned-cache-v1', this.cacheDir, effectiveBackend,
      ])).digest('hex')}` };
  }

  private async createExtractorInRuntime(pipelineFactory: FeatureExtractionPipelineFactory): Promise<FeatureExtractor> {

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
    if (this.disposed) throw new Error('LOCAL_EMBEDDING_PROVIDER_DISPOSED');
    if (!this.extractor) {
      this.extractor = this.createExtractor().catch((err: unknown) => {
        this.extractor = null;
        throw err;
      });
    }

    return this.extractor;
  }

  async embed(texts: string[]): Promise<number[][]> {
    if (this.disposed) throw new Error('LOCAL_EMBEDDING_PROVIDER_DISPOSED');
    const task = this.embedTexts(texts);
    this.activeInference.add(task);
    try { return await task; } finally { this.activeInference.delete(task); }
  }

  private async embedTexts(texts: string[]): Promise<number[][]> {
    const extractor = await this.getExtractor();

    try {
      // Bound native inference memory and never leave sibling calls running on rejection.
      const outputs: number[][] = [];
      for (const text of texts) outputs.push(toVector(await extractor(text, { pooling: 'mean', normalize: true })));

      return outputs;
    } catch (err) {
      this.logger.error(`Failed to embed texts with local model ${this.config.model}`, err instanceof Error ? err : new Error(String(err)));
      throw err;
    }
  }

  getDimensions(): number {
    return this.config.dimensions;
  }

  async getInputSizer(): Promise<((text: string) => boolean) | undefined> {
    if (!this.getModelIdentity()) return undefined;
    const extractor = await this.getExtractor();
    if (this.disposed) throw new Error('LOCAL_EMBEDDING_PROVIDER_DISPOSED');
    if (typeof extractor.tokenizer !== 'function') throw new Error('EMBEDDING_TOKENIZER_UNAVAILABLE');
    return (text: string) => {
      if (this.disposed) throw new Error('LOCAL_EMBEDDING_PROVIDER_DISPOSED');
      const tokens = extractor.tokenizer!(text, { padding: false, truncation: false }).input_ids.size;
      if (!Number.isSafeInteger(tokens) || tokens < 1) throw new Error('EMBEDDING_TOKENIZER_INVALID');
      const maxTokens = this.config.model === GEMMA2_LOCAL_EMBEDDING_MODEL ? GEMMA2_LOCAL_EMBEDDING_MAX_TOKENS : 512;
      return tokens <= maxTokens;
    };
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
    this.disposed = true;
    if (!this.disposal) this.disposal = this.disposeOnce();
    await this.disposal;
  }

  private async disposeOnce(): Promise<void> {
    try {
      await Promise.allSettled([...this.activeInference]);
      let extractor: FeatureExtractor | null;
      try { extractor = await this.extractor; }
      catch (error) {
        this.logger.warn('Disposing a local model whose initialization failed', error instanceof Error ? error.message : String(error));
        return;
      }
      await extractor?.dispose?.();
    } finally { this.extractor = null; this.activeBackend = null; }
  }
}
