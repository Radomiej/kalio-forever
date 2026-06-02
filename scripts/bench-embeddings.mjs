import { performance } from 'node:perf_hooks';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const apiRequire = createRequire(new URL('../apps/kalio-api/package.json', import.meta.url));
const { env, pipeline } = await import(pathToFileURL(apiRequire.resolve('@huggingface/transformers')).href);

const DEFAULT_MODELS = [
  'Xenova/multilingual-e5-small',
  'Xenova/paraphrase-multilingual-MiniLM-L12-v2',
  'Xenova/multilingual-e5-base',
  'Xenova/distiluse-base-multilingual-cased-v2',
];

const DEFAULT_BACKENDS = [
  ['cpu', 'q8'],
  ['webgpu', 'fp16'],
];

const texts = [
  'query: jak dziala pamiec agentow w Kalio?',
  'query: how does delegated architecture routing work?',
  'passage: Kalio stores memories as chunks and searches them with embeddings.',
  'passage: Agent orchestration needs multilingual semantic recall.',
];

function parseList(value, fallback) {
  return value ? value.split(',').map((item) => item.trim()).filter(Boolean) : fallback;
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

async function bench(model, device, dtype, runs) {
  const normalizedDevice = device;
  const loadStarted = performance.now();
  const extractor = await pipeline('feature-extraction', model, { device: normalizedDevice, dtype });
  const loaded = performance.now();

  const warm = await extractor(texts, { pooling: 'mean', normalize: true });
  const timings = [];
  let dim = warm.dims?.at(-1) ?? Math.round(warm.data.length / texts.length);

  for (let i = 0; i < runs; i++) {
    const started = performance.now();
    const output = await extractor(texts, { pooling: 'mean', normalize: true });
    const ended = performance.now();
    timings.push(ended - started);
    dim = output.dims?.at(-1) ?? Math.round(output.data.length / texts.length);
  }

  return {
    ok: true,
    model,
    device: normalizedDevice,
    requestedDevice: device,
    dtype,
    dim,
    loadMs: +(loaded - loadStarted).toFixed(1),
    medianBatchMs: +median(timings).toFixed(1),
    medianPerTextMs: +(median(timings) / texts.length).toFixed(1),
    runs,
    texts: texts.length,
  };
}

async function main() {
  env.cacheDir = process.env.EMBEDDING_CACHE_DIR || './data/embeddings-cache';
  const runs = Number.parseInt(process.env.RUNS || '5', 10);
  const models = parseList(process.env.MODELS, DEFAULT_MODELS);
  const backends = parseList(process.env.BACKENDS, DEFAULT_BACKENDS.map(([device, dtype]) => `${device}:${dtype}`))
    .map((item) => item.split(':'))
    .filter((item) => item.length === 2);

  const results = [];
  for (const model of models) {
    for (const [device, dtype] of backends) {
      try {
        results.push(await bench(model, device, dtype, runs));
      } catch (error) {
        results.push({
          ok: false,
          model,
          device,
          dtype,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  console.log(JSON.stringify({
    cacheDir: env.cacheDir,
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    results,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
