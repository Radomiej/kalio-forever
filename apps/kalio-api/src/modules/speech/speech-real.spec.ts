import { describe, expect, it, vi } from 'vitest';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { createReadStream } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { SpeechRuntimeStorageService } from '../vfs/speech-runtime-storage.service';
import { SpeechInstallService } from './speech-install.service';
import { SpeechInferenceService } from './speech-inference.service';
import { parseSpeechAudio } from './speech-audio';

/** Explicit opt-in only: downloads pinned runtime/model; never part of normal tests. */
describe.skipIf(process.env['SPEECH_REAL_TEST'] !== '1')('real Windows CPU speech (official English sample, no microphone)', () => {
  it('explicitly installs, then decodes/cancels without JavaScript networking', async () => {
    const storage = new SpeechRuntimeStorageService(new ConfigService({
      WORKSPACE_ROOT: resolve(process.env['SPEECH_REAL_WORKSPACE_ROOT'] ?? '../../data/workspaces'),
    }));
    const install = new SpeechInstallService(storage);
    const inference = new SpeechInferenceService();
    const cache = process.env['SPEECH_REAL_MODEL_CACHE'];
    if (cache) {
      const networkFetch = globalThis.fetch;
      vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
        const url = new URL(String(input));
        const asset = (await import('./speech-catalog')).SPEECH_MODEL_FILES.find((model) => model.url === url.href);
        if (!asset) return networkFetch(input, init);
        console.info('speech-model-source', 'official-pinned-local-cache', asset.name, asset.bytes);
        const stream = Readable.toWeb(createReadStream(resolve(cache, asset.name)));
        return new Response(stream as ReadableStream<Uint8Array>);
      });
    }
    const storageInstall = storage.install.bind(storage);
    vi.spyOn(storage, 'install').mockImplementation(async (...args) => {
      try { return await storageInstall(...args); }
      catch (error) {
        const cause = error instanceof Error ? error.cause : undefined;
        console.info('speech-install-error-category', {
          name: error instanceof Error ? error.name : 'unknown',
          code: error && typeof error === 'object' && 'code' in error ? String(error.code) : null,
          causeCode: cause && typeof cause === 'object' && 'code' in cause ? String(cause.code) : null,
        });
        throw error;
      }
    });
    try {
      expect((await install.status()).totalBytes).toBe(679385601);
      await install.install(); // This opt-in test is the explicit Install action.
      let lastDecile = -1;
      const deadline = Date.now() + 1800000;
      while (true) {
        const status = await install.status();
        const decile = Math.floor(status.downloadedBytes / status.totalBytes * 10);
        if (decile !== lastDecile) { console.info('speech-install-progress', status.status, status.downloadedBytes, status.totalBytes); lastDecile = decile; }
        if (status.status === 'error') throw new Error(status.errorCode ?? 'INSTALL_FAILED');
        if (status.status === 'ready') break;
        if (Date.now() > deadline) throw new Error('INSTALL_TIMEOUT');
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
      const root = await install.installedRoot();
      expect(root).toBeTruthy();
      const receiptBuffer = await readFile(resolve(root!, 'receipt.json'));
      const receipt = JSON.parse(receiptBuffer.toString('utf8')) as Array<{ bytes: number }>;
      const installedBytes = receipt.reduce((sum, entry) => sum + entry.bytes, receiptBuffer.length);
      const response = await fetch('https://huggingface.co/csukuangfj/sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8/resolve/2bda32ec70b097a55adaa07d9a7173915b43cc78/test_wavs/en.wav');
      expect(response.ok).toBe(true);
      const sample = Buffer.from(await response.arrayBuffer());
      expect(createHash('sha256').update(sample).digest('hex')).toBe('148b936b43ce7c546a866e64da059f0458aee2d65e617f16e9d94f06e8d99ed6');
      // Official sample is 24kHz PCM16; deterministic linear resampling for this fixture only.
      expect(sample.readUInt32LE(24)).toBe(24000);
      const count = Math.floor(sample.readUInt32LE(40) / 2 * 16000 / 24000);
      const canonical = Buffer.alloc(44 + count * 2); sample.copy(canonical, 0, 0, 44);
      canonical.writeUInt32LE(canonical.length - 8, 4); canonical.writeUInt32LE(16000, 24);
      canonical.writeUInt32LE(32000, 28); canonical.writeUInt32LE(count * 2, 40);
      for (let i = 0; i < count; i++) {
        const position = i * 1.5; const low = Math.floor(position); const fraction = position - low;
        const a = sample.readInt16LE(44 + low * 2); const b = sample.readInt16LE(44 + Math.min(low + 1, sample.readUInt32LE(40) / 2 - 1) * 2);
        canonical.writeInt16LE(Math.round(a + (b - a) * fraction), 44 + i * 2);
      }
      const { pcm, durationMs } = parseSpeechAudio(canonical);
      const network = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('OFFLINE_TEST'));
      network.mockClear();
      const started = performance.now();
      const text = await inference.transcribe(root!, 'real-offline', pcm);
      const elapsedMs = Math.round(performance.now() - started);
      expect(text.trim().length).toBeGreaterThan(0);
      expect(network).not.toHaveBeenCalled();
      console.info('speech-real-cpu', JSON.stringify({ durationMs, coldLatencyMs: elapsedMs, installedBytes,
        nonEmpty: true, transcriptCharacters: text.length, threads: 4, sampleRate: 16000,
        model: 'parakeet-tdt-v3-int8', runtime: 'sherpa-onnx-node-1.13.8-cpu',
        modelSource: cache ? 'hash-verified-official-local-cache' : 'official-network',
        offlineGuard: 'worker-JavaScript-network-disabled;parent-fetch-denied;OS-egress-unmeasured', peakWorkerRam: 'unmeasured' }));
      const pending = inference.transcribe(root!, 'real-cancel', pcm);
      expect(inference.cancel('different-request')).toBe(false);
      expect(inference.cancel('real-cancel')).toBe(true);
      await expect(pending).rejects.toThrow();
      const retry = await inference.transcribe(root!, 'real-retry', pcm);
      expect(retry === text).toBe(true);
      console.info('speech-real-cancellation', JSON.stringify({ correctRequestCancelled: true, otherRequestUnaffected: true, retryIdentical: true }));
      network.mockRestore();
      pcm.fill(0); canonical.fill(0); sample.fill(0);
      expect(await storage.installedRoot((await import('./speech-catalog')).SPEECH_MODEL_FILES)).toBe(root);
    } finally {
      vi.restoreAllMocks(); inference.onModuleDestroy(); await install.onModuleDestroy();
    }
  }, 1860000);
});
