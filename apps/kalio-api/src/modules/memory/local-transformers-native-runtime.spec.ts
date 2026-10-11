import { execFile } from 'node:child_process';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import { expect, it } from 'vitest';

const execFileAsync = promisify(execFile);
const apiRoot = resolve(__dirname, '../../..');

// A fresh process reproduces Windows DLL collisions hidden by mocked pipelines
// or by loading each native dependency in a separate Vitest worker.
it.each(['image-first', 'embedding-first'] as const)(
  'supports chat images and local embedding runtime together (%s)',
  async (order) => {
    const script = `
      let sharp;
      let transformers;
      if (${JSON.stringify(order)} === 'image-first') {
        sharp = (await import('sharp')).default;
        transformers = await import('@huggingface/transformers');
      } else {
        transformers = await import('@huggingface/transformers');
        sharp = (await import('sharp')).default;
      }
      const image = await sharp({ create: {
        width: 6, height: 4, channels: 3, background: '#0088cc'
      } }).resize(3, 2).png().toBuffer();
      const { width, height } = await sharp(image).metadata();
      console.log(JSON.stringify({ width, height,
        embeddingRuntimeReady: typeof transformers.AutoModel.from_pretrained === 'function'
          && typeof transformers.FeatureExtractionPipeline === 'function'
      }));
    `;
    const { stdout } = await execFileAsync(process.execPath,
      ['--input-type=module', '--eval', script],
      { cwd: apiRoot, windowsHide: true, timeout: 20_000 });

    expect(JSON.parse(stdout.trim())).toEqual({
      width: 3, height: 2, embeddingRuntimeReady: true,
    });
  },
);
