import { performance } from 'node:perf_hooks';
import { env, pipeline } from '@huggingface/transformers';

const MODEL = 'Xenova/multilingual-e5-small';
env.cacheDir = './data/embeddings-cache';

const sample = 'query: jak działa routing agentów i tool calli w Kalio?';

async function bench(device, dtype) {
  const started = performance.now();
  try {
    const extractor = await pipeline('feature-extraction', MODEL, { device, dtype });
    const loaded = performance.now();

    const out1 = await extractor(sample, { pooling: 'mean', normalize: true });
    const first = performance.now();

    const out2 = await extractor(sample, { pooling: 'mean', normalize: true });
    const second = performance.now();

    return {
      ok: true,
      device,
      dtype,
      dim: out1.data.length,
      loadMs: +(loaded - started).toFixed(1),
      firstEmbedMs: +(first - loaded).toFixed(1),
      warmEmbedMs: +(second - first).toFixed(1),
      totalMs: +(second - started).toFixed(1),
      warmDelta: +(Math.abs(out1.data[0] - out2.data[0])).toFixed(8),
    };
  } catch (error) {
    const failed = performance.now();
    return {
      ok: false,
      device,
      dtype,
      failMs: +(failed - started).toFixed(1),
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function run() {
  const results = [];
  results.push(await bench('webgpu', 'fp16'));
  results.push(await bench('wasm', 'q8'));

  const autoStarted = performance.now();
  let autoResult;
  try {
    try {
      const extractor = await pipeline('feature-extraction', MODEL, { device: 'webgpu', dtype: 'fp16' });
      const loaded = performance.now();
      const out = await extractor(sample, { pooling: 'mean', normalize: true });
      const end = performance.now();
      autoResult = {
        ok: true,
        mode: 'auto',
        activeBackend: 'webgpu',
        dim: out.data.length,
        loadMs: +(loaded - autoStarted).toFixed(1),
        embedMs: +(end - loaded).toFixed(1),
        totalMs: +(end - autoStarted).toFixed(1),
      };
    } catch {
      const extractor = await pipeline('feature-extraction', MODEL, { device: 'wasm', dtype: 'q8' });
      const loaded = performance.now();
      const out = await extractor(sample, { pooling: 'mean', normalize: true });
      const end = performance.now();
      autoResult = {
        ok: true,
        mode: 'auto',
        activeBackend: 'wasm',
        dim: out.data.length,
        loadMs: +(loaded - autoStarted).toFixed(1),
        embedMs: +(end - loaded).toFixed(1),
        totalMs: +(end - autoStarted).toFixed(1),
      };
    }
  } catch (error) {
    autoResult = {
      ok: false,
      mode: 'auto',
      failMs: +(performance.now() - autoStarted).toFixed(1),
      error: error instanceof Error ? error.message : String(error),
    };
  }

  console.log(JSON.stringify({
    model: MODEL,
    cacheDir: env.cacheDir,
    allowRemoteModels: env.allowRemoteModels,
    results,
    autoResult,
  }, null, 2));
}

run().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
