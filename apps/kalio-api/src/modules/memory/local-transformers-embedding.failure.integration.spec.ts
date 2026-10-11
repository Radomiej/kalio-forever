import { afterEach, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LocalTransformersEmbeddingProvider } from './local-transformers-embedding.provider';

const roots: string[] = [];
afterEach(() => { vi.unstubAllGlobals(); for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

it('holds model loading until both real tokenizer file requests drain after one fails', async () => {
  const cache = mkdtempSync(join(tmpdir(), 'kalio-tokenizer-drain-')); roots.push(cache);
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let started!: () => void;
  const pending = new Promise<void>(resolve => { started = resolve; });
  vi.stubGlobal('fetch', async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    expect(url).toContain('/resolve/761b726dd34fb83930e26aab4e9ac3899aa1fa78/');
    if (new Headers(init?.headers).has('Range')) return new Response('{}', { headers: { 'content-length': '2' } });
    if (url.endsWith('/tokenizer_config.json')) {
      started(); await gate;
      return new Response('{"tokenizer_class":"XLMRobertaTokenizer"}');
    }
    throw new Error('TOKENIZER_FILE_FAILURE');
  });
  const provider = new LocalTransformersEmbeddingProvider({ model: 'Xenova/multilingual-e5-small',
    dimensions: 384, backend: 'cpu', cacheDir: cache, allowRemoteModels: true });
  let settled = false;
  const loading = provider.prepare().then(() => { settled = true; return null; }, error => { settled = true; return error; });
  try {
    await pending;
    await new Promise<void>(resolve => setImmediate(resolve));
    await new Promise<void>(resolve => setImmediate(resolve));
    expect(settled).toBe(false);
  } finally { release(); await loading; await provider.dispose(); }
  expect(await loading).toMatchObject({ message: 'TOKENIZER_FILE_FAILURE' });
});
