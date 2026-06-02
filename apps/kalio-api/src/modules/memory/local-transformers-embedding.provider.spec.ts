import { beforeEach, describe, expect, it, vi } from 'vitest';
import { env } from '@huggingface/transformers';
import {
  DEFAULT_LOCAL_EMBEDDING_BACKEND,
  DEFAULT_LOCAL_EMBEDDING_DIMENSIONS,
  DEFAULT_LOCAL_EMBEDDING_MODEL,
  LocalTransformersEmbeddingProvider,
} from './local-transformers-embedding.provider';

const { pipelineMock } = vi.hoisted(() => ({
  pipelineMock: vi.fn(),
}));

vi.mock('@huggingface/transformers', () => ({
  env: {
    cacheDir: '',
    allowRemoteModels: true,
  },
  pipeline: pipelineMock,
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
  env.allowRemoteModels = true;
  env.cacheDir = '';
});

describe('LocalTransformersEmbeddingProvider', () => {
  it('uses cpu in auto mode on Windows to avoid WebGPU shutdown crashes', async () => {
    pipelineMock.mockImplementation(async (_task: string, _model: string, options?: { device?: string }) => {
      expect(options).toMatchObject({ device: process.platform === 'win32' ? 'cpu' : 'webgpu' });
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
      return async (text: string) => ({ data: new Float32Array(384).fill(text.length) });
    });

    const provider = makeProvider('cpu');
    const vectors = await provider.embed(['hello']);

    expect(vectors).toHaveLength(1);
    expect(pipelineMock).toHaveBeenCalledTimes(1);
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
});
