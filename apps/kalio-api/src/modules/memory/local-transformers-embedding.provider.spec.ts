import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_LOCAL_EMBEDDING_BACKEND,
  DEFAULT_LOCAL_EMBEDDING_DIMENSIONS,
  DEFAULT_LOCAL_EMBEDDING_MODEL,
  GEMMA2_LOCAL_EMBEDDING_MODEL,
  GEMMA2_LOCAL_EMBEDDING_REVISION,
  LocalTransformersEmbeddingProvider,
} from './local-transformers-embedding.provider';

const mockedHuggingFaceEnv = {
  cacheDir: '',
  allowRemoteModels: false,
  allowLocalModels: true,
  localModelPath: './models/',
};

const { pipelineMock, autoConfigMock, autoModelMock, tokenizerMock, gemmaConfig } = vi.hoisted(() => ({
  pipelineMock: vi.fn(),
  autoConfigMock: vi.fn(),
  autoModelMock: vi.fn(),
  tokenizerMock: vi.fn(),
  gemmaConfig: { vision_config: { enabled: true } as unknown, audio_config: { enabled: true } as unknown },
}));

vi.mock('@huggingface/transformers', () => ({
  env: mockedHuggingFaceEnv,
  pipeline: pipelineMock,
  AutoConfig: { from_pretrained: autoConfigMock },
  AutoTokenizer: { from_pretrained: tokenizerMock },
  AutoModel: { from_pretrained: autoModelMock },
  FeatureExtractionPipeline: function (args: { task: string; model: { model: string; options: unknown } }) {
    return pipelineMock(args.task, args.model.model, args.model.options);
  },
}));

function makeProvider(backend: 'auto' | 'webgpu' | 'cpu' = DEFAULT_LOCAL_EMBEDDING_BACKEND) {
  return new LocalTransformersEmbeddingProvider({
    model: DEFAULT_LOCAL_EMBEDDING_MODEL,
    dimensions: DEFAULT_LOCAL_EMBEDDING_DIMENSIONS,
    cacheDir: './data/embeddings-cache',
    backend,
  });
}

beforeEach(() => {
  pipelineMock.mockReset();
  autoConfigMock.mockReset().mockResolvedValue(gemmaConfig);
  autoModelMock.mockReset().mockImplementation(async (model: string, options: unknown) => ({ dispose: vi.fn(), model, options }));
  tokenizerMock.mockReset().mockResolvedValue({});
  gemmaConfig.vision_config = { enabled: true };
  gemmaConfig.audio_config = { enabled: true };
  mockedHuggingFaceEnv.allowRemoteModels = false;
  mockedHuggingFaceEnv.cacheDir = '';
});

describe('LocalTransformersEmbeddingProvider', () => {
  it('sizes the complete input with the loaded tokenizer without truncation', async () => {
    const tokenizer = vi.fn((text: string) => ({ input_ids: { size: text.length } }));
    pipelineMock.mockResolvedValue(Object.assign(async () => ({ data: [] }), { tokenizer }));
    const provider = makeProvider('cpu');
    const fits = await provider.getInputSizer();
    expect(fits?.('a'.repeat(512))).toBe(true);
    expect(fits?.('a'.repeat(513))).toBe(false);
    expect(tokenizer).toHaveBeenLastCalledWith('a'.repeat(513), { padding: false, truncation: false });
    await provider.dispose();
    expect(() => fits?.('source')).toThrow('LOCAL_EMBEDDING_PROVIDER_DISPOSED');
  });
  it('fails closed when a pinned model does not expose its tokenizer', async () => {
    pipelineMock.mockResolvedValue(async () => ({ data: [] }));
    await expect(makeProvider('cpu').getInputSizer()).rejects.toThrow('EMBEDDING_TOKENIZER_UNAVAILABLE');
  });
  it('drains active inference and coalesces disposal before closing the model', async () => {
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    let entered!: () => void;
    const started = new Promise<void>(resolve => { entered = resolve; });
    const dispose = vi.fn();
    pipelineMock.mockResolvedValue(Object.assign(async () => {
      entered(); await gate; return { data: new Float32Array(384).fill(1) };
    }, { dispose }));
    const provider = makeProvider('cpu');
    const inference = provider.embed(['source']); await started;
    const closing = provider.dispose(); const closingAgain = provider.dispose();
    await Promise.resolve(); await Promise.resolve();
    expect(dispose).not.toHaveBeenCalled();
    release(); await Promise.all([inference, closing, closingAgain]);
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(provider.getActiveBackend()).toBeNull();
    await expect(provider.prepare()).rejects.toThrow('LOCAL_EMBEDDING_PROVIDER_DISPOSED');
  });
  it('pins the default model and keeps inference offline in a revision-specific cache', async () => {
    pipelineMock.mockImplementation(async () => {
      expect(mockedHuggingFaceEnv.localModelPath).toContain('761b726dd34fb83930e26aab4e9ac3899aa1fa78');
      expect(mockedHuggingFaceEnv.localModelPath).toContain('.pinned-local');
      expect(mockedHuggingFaceEnv.allowRemoteModels).toBe(false);
      return async () => ({ data: new Float32Array(384).fill(1) });
    });
    const provider = makeProvider('cpu');
    await provider.embed(['source code']);
    expect(pipelineMock.mock.calls[0]?.[2]).toMatchObject({
      revision: '761b726dd34fb83930e26aab4e9ac3899aa1fa78', local_files_only: true,
      cache_dir: expect.stringContaining('embeddings-cache'),
    });
    expect(mockedHuggingFaceEnv.localModelPath).toBe('./models/');
  });
  it('does not claim pinned identity for unknown models or automatic backend fallback', () => {
    expect(makeProvider('auto').getModelIdentity()).toBeUndefined();
    expect(new LocalTransformersEmbeddingProvider({ model: 'custom/model', dimensions: 384,
      cacheDir: './data/embeddings-cache', backend: 'cpu' }).getModelIdentity()).toBeUndefined();
  });
  it('serializes loading so another cache or download permission cannot leak into an offline load', async () => {
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    let entered!: () => void;
    const started = new Promise<void>(resolve => { entered = resolve; });
    pipelineMock.mockImplementationOnce(async () => {
      entered(); await gate;
      expect(mockedHuggingFaceEnv.allowRemoteModels).toBe(false);
      expect(mockedHuggingFaceEnv.cacheDir).toContain('embeddings-cache');
      return async () => ({ data: new Float32Array(384).fill(1) });
    }).mockImplementationOnce(async () => {
      expect(mockedHuggingFaceEnv.allowRemoteModels).toBe(true);
      expect(mockedHuggingFaceEnv.cacheDir).toContain('separate-cache');
      return async () => ({ data: new Float32Array(384).fill(1) });
    });
    const first = makeProvider('cpu').prepare(); await started;
    const second = new LocalTransformersEmbeddingProvider({ model: DEFAULT_LOCAL_EMBEDDING_MODEL,
      dimensions: 384, backend: 'cpu', cacheDir: './data/separate-cache', allowRemoteModels: true }).prepare();
    await Promise.resolve(); expect(pipelineMock).toHaveBeenCalledTimes(1);
    release(); await Promise.all([first, second]);
    expect(mockedHuggingFaceEnv.allowRemoteModels).toBe(false);
    expect(mockedHuggingFaceEnv.cacheDir).toBe('');
  });
  it('uses cpu in auto mode on Windows to avoid WebGPU shutdown crashes', async () => {
    pipelineMock.mockImplementation(async (_task: string, _model: string, options?: { device?: string }) => {
      expect(options).toMatchObject({ device: process.platform === 'win32' ? 'cpu' : 'webgpu' });
      expect(options).toMatchObject({ local_files_only: true });
      return async (text: string) => ({ data: new Float32Array(384).fill(text.length) });
    });

    const provider = makeProvider('auto');
    const vectors = await provider.embed(['hello']);

    expect(vectors).toHaveLength(1);
    expect(vectors[0]).toHaveLength(384);
    expect(pipelineMock).toHaveBeenCalledTimes(1);
    expect(provider.getActiveBackend()).toBe(process.platform === 'win32' ? 'cpu' : 'webgpu');
    expect(provider.isGpuAvailable()).toBe(process.platform === 'win32' ? false : true);
  });

  it('uses explicit webgpu backend without falling back', async () => {
    pipelineMock.mockImplementation(async (_task: string, _model: string, options?: { device?: string }) => {
      expect(options).toMatchObject({ device: 'webgpu', dtype: 'fp16' });
      expect(options).toMatchObject({ local_files_only: true });
      return async (text: string) => ({ data: new Float32Array(384).fill(text.length) });
    });

    const provider = makeProvider('webgpu');
    const vectors = await provider.embed(['hello', 'world']);

    expect(vectors).toHaveLength(2);
    expect(pipelineMock).toHaveBeenCalledTimes(1);
  });

  it('uses explicit cpu backend without attempting webgpu', async () => {
    pipelineMock.mockImplementation(async (_task: string, _model: string, options?: { device?: string }) => {
      expect(options).toMatchObject({ device: 'cpu', dtype: 'q8' });
      expect(options).toMatchObject({ local_files_only: true });
      return async (text: string) => ({ data: new Float32Array(384).fill(text.length) });
    });

    const provider = makeProvider('cpu');
    const vectors = await provider.embed(['hello']);

    expect(vectors).toHaveLength(1);
    expect(pipelineMock).toHaveBeenCalledTimes(1);
  });

  it('loads pinned Gemma 2 text-only q4 on CPU and uses its 8192-token limit', async () => {
    const tokenizer = vi.fn((text: string) => ({ input_ids: { size: text.length } }));
    tokenizerMock.mockResolvedValue(tokenizer);
    pipelineMock.mockResolvedValue(Object.assign(async () => ({ data: new Float32Array(768).fill(0.1) }), { tokenizer }));
    const provider = new LocalTransformersEmbeddingProvider({
      model: GEMMA2_LOCAL_EMBEDDING_MODEL,
      dimensions: 768,
      cacheDir: './data/embeddings-cache',
      backend: 'cpu',
    });

    const vectors = await provider.embed(['Kalio source context']);
    const fits = await provider.getInputSizer();

    expect(vectors[0]).toHaveLength(768);
    expect(fits?.('a'.repeat(8192))).toBe(true);
    expect(fits?.('a'.repeat(8193))).toBe(false);
    expect(autoConfigMock).toHaveBeenCalledWith(GEMMA2_LOCAL_EMBEDDING_MODEL, expect.objectContaining({
      revision: GEMMA2_LOCAL_EMBEDDING_REVISION,
      device: 'cpu',
      dtype: 'q4',
      local_files_only: true,
    }));
    expect(gemmaConfig).toMatchObject({ vision_config: null, audio_config: null });
    expect(autoModelMock).toHaveBeenCalledWith(GEMMA2_LOCAL_EMBEDDING_MODEL, expect.objectContaining({
      revision: GEMMA2_LOCAL_EMBEDDING_REVISION,
      device: 'cpu',
      dtype: 'q4',
      local_files_only: true,
      config: gemmaConfig,
    }));
    expect(provider.getModelIdentity()).toMatchObject({ modelRevision: GEMMA2_LOCAL_EMBEDDING_REVISION, providerScope: expect.stringMatching(/^scope-/) });
    await provider.dispose();
  });

  it('pins Gemma auto mode to CPU identity on Windows and refuses untested GPU identity', () => {
    const makeGemma = (backend: 'auto' | 'webgpu' | 'cpu') => new LocalTransformersEmbeddingProvider({
      model: GEMMA2_LOCAL_EMBEDDING_MODEL, dimensions: 768, cacheDir: './data/embeddings-cache', backend,
    });
    expect(makeGemma('cpu').getModelIdentity()?.modelRevision).toBe(GEMMA2_LOCAL_EMBEDDING_REVISION);
    expect(makeGemma('webgpu').getModelIdentity()).toBeUndefined();
    if (process.platform === 'win32') {
      expect(makeGemma('auto').getModelIdentity()).toMatchObject({ modelRevision: GEMMA2_LOCAL_EMBEDDING_REVISION });
    } else {
      expect(makeGemma('auto').getModelIdentity()).toBeUndefined();
    }
  });

  it('exposes configured dimensions', () => {
    expect(makeProvider('auto').getDimensions()).toBe(384);
  });

  it('reports GPU availability from the active backend after loading', async () => {
    pipelineMock.mockResolvedValue(async () => ({ data: new Float32Array(384).fill(1) }));

    const provider = makeProvider('auto');
    expect(provider.isGpuAvailable()).toBeUndefined();

    await provider.embed(['hello']);

    expect(provider.getActiveBackend()).toBe(process.platform === 'win32' ? 'cpu' : 'webgpu');
    expect(provider.isGpuAvailable()).toBe(process.platform === 'win32' ? false : true);
  });

  it('can be configured to allow remote model downloads for explicit install flows', async () => {
    pipelineMock.mockImplementation(async (_task: string, _model: string, options?: { local_files_only?: boolean }) => {
      expect(options?.local_files_only).toBe(false);
      return async () => ({ data: new Float32Array(384).fill(1) });
    });

    const provider = new LocalTransformersEmbeddingProvider({
      model: DEFAULT_LOCAL_EMBEDDING_MODEL,
      dimensions: DEFAULT_LOCAL_EMBEDDING_DIMENSIONS,
      cacheDir: './data/embeddings-cache',
      backend: 'cpu',
      allowRemoteModels: true,
    });

    await provider.prepare();

    expect(pipelineMock).toHaveBeenCalledTimes(1);
  });
});
