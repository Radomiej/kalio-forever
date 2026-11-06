import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { lstat, mkdir, mkdtemp, open, readFile, realpath, rename, rm, writeFile, type FileHandle } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { gunzipSync } from 'node:zlib';

interface SpeechAsset { name: string; bytes: number; sha256: string; url: string }
interface SpeechPackage { name: string; bytes: number; integrity: string; url: string }
interface ReceiptEntry { path: string; bytes: number; sha256: string }
const WRAPPER_FILES = ['addon-static-import.js', 'addon.js', 'audio-tagg.js', 'keyword-spotter.js',
  'non-streaming-asr.js', 'non-streaming-speaker-diarization.js', 'non-streaming-speech-denoiser.js',
  'non-streaming-tts.js', 'online-speech-denoiser.js', 'punctuation.js', 'resampler.js', 'sherpa-onnx.js',
  'speaker-identification.js', 'spoken-language-identification.js', 'streaming-asr.js', 'types.js',
  'vad.js', 'package.json', 'README.md'];
const NATIVE_FILES = ['onnxruntime_providers_shared.dll', 'onnxruntime.dll', 'sherpa-onnx-c-api.dll',
  'sherpa-onnx-cxx-api.dll', 'index.js', 'package.json', 'README.md', 'sherpa-onnx.node'];
const MODEL_NAMES = ['encoder.int8.onnx', 'decoder.int8.onnx', 'joiner.int8.onnx', 'tokens.txt'];
const MAX_TARBALL = 32 * 1024 * 1024;

/** Private optional install storage. No audio or caller-provided filesystem paths. */
@Injectable()
export class SpeechRuntimeStorageService {
  private readonly logger = new Logger(SpeechRuntimeStorageService.name);
  private readonly base: string;
  private readonly readyRoot: string;

  constructor(config: ConfigService) {
    this.base = resolve(config.get<string>('WORKSPACE_ROOT', './data/workspaces'), '.speech-runtime');
    this.readyRoot = join(this.base, 'parakeet-v3-sherpa-1.13.8');
  }

  /** Reject all symlink/junction ancestors, including an install-root redirect. */
  private async safe(path: string): Promise<void> {
    let current = resolve(path);
    while (true) {
      try {
        const info = await lstat(current);
        if (info.isSymbolicLink()) throw new Error('SPEECH_STORAGE_REDIRECT');
        const actual = await realpath(current);
        const normalize = (value: string) => process.platform === 'win32' ? value.toLowerCase() : value;
        if (normalize(actual) !== normalize(current)) throw new Error('SPEECH_STORAGE_REDIRECT');
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
      const parent = dirname(current);
      if (parent === current) break;
      current = parent;
    }
  }

  private async digest(path: string): Promise<{ bytes: number; sha256: string }> {
    await this.safe(path);
    const hash = createHash('sha256');
    let bytes = 0;
    for await (const chunk of createReadStream(path)) { bytes += chunk.length; hash.update(chunk); }
    return { bytes, sha256: hash.digest('hex') };
  }

  async installedRoot(models: SpeechAsset[]): Promise<string | null> {
    return await this.verifiedReceipt(models) ? this.readyRoot : null;
  }

  private async verifiedReceipt(models: SpeechAsset[]): Promise<ReceiptEntry[] | null> {
    await this.safe(this.readyRoot);
    let raw: Buffer;
    try {
      const receiptPath = join(this.readyRoot, 'receipt.json');
      await this.safe(receiptPath);
      if ((await lstat(receiptPath)).size > 32768) throw new Error('SPEECH_RECEIPT_INVALID');
      raw = await readFile(receiptPath);
    }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
    if (raw.length > 32768) throw new Error('SPEECH_RECEIPT_INVALID');
    let receipt: unknown;
    try { receipt = JSON.parse(raw.toString('utf8')); }
    catch (error) { if (error instanceof SyntaxError) return null; throw error; }
    if (!Array.isArray(receipt) || receipt.length !== WRAPPER_FILES.length + NATIVE_FILES.length + 4) return null;
    const expectedPaths = new Set([
      ...WRAPPER_FILES.map((file) => `node_modules/sherpa-onnx-node/${file}`),
      ...NATIVE_FILES.map((file) => `node_modules/sherpa-onnx-win-x64/${file}`),
      ...MODEL_NAMES.map((file) => `model/${file}`),
    ]);
    for (const entry of receipt as ReceiptEntry[]) {
      if (!entry || typeof entry.path !== 'string' || !expectedPaths.delete(entry.path)) return null;
      const expected = models.find((model) => entry.path === `model/${model.name}`);
      if (expected && (entry.bytes !== expected.bytes || entry.sha256 !== expected.sha256)) return null;
      let actual: { bytes: number; sha256: string };
      try { actual = await this.digest(join(this.readyRoot, entry.path)); }
      catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
      if (actual.bytes !== entry.bytes || actual.sha256 !== entry.sha256) return null;
    }
    return expectedPaths.size === 0 ? receipt as ReceiptEntry[] : null;
  }

  private async transfer(url: string, path: string, maxBytes: number, signal: AbortSignal,
    onBytes: (count: number) => void): Promise<void> {
    const source = new URL(url);
    if (source.protocol !== 'https:' || !['registry.npmjs.org', 'huggingface.co'].includes(source.hostname)) {
      throw new Error('SPEECH_SOURCE_DENIED');
    }
    await this.safe(path);
    const allowedHosts = ['registry.npmjs.org', 'huggingface.co', 'cdn-lfs.huggingface.co', 'cdn-lfs.hf.co',
      'cas-bridge.xethub.hf.co', 'us.aws.cdn.hf.co'];
    let current = source;
    let response: globalThis.Response;
    for (let redirects = 0; ; redirects++) {
      if (current.protocol !== 'https:' || !allowedHosts.includes(current.hostname) || current.username || current.password
        || (current.port && current.port !== '443')) throw new Error('SPEECH_SOURCE_DENIED');
      response = await fetch(current, { signal, redirect: 'manual' });
      if (![301, 302, 303, 307, 308].includes(response.status)) break;
      await response.body?.cancel();
      const location = response.headers.get('location');
      if (!location || redirects >= 5) throw new Error('SPEECH_SOURCE_DENIED');
      current = new URL(location, current);
    }
    if (!response.ok || !response.body) throw new Error('SPEECH_DOWNLOAD_FAILED');
    let count = 0;
    const limiter = new Transform({ transform(chunk: Buffer, _encoding, callback) {
      count += chunk.length;
      if (count > maxBytes) return callback(new Error('SPEECH_DOWNLOAD_OVERSIZED'));
      onBytes(chunk.length);
      callback(null, chunk);
    } });
    await pipeline(Readable.fromWeb(response.body as import('node:stream/web').ReadableStream), limiter,
      createWriteStream(path, { flags: 'wx' }), { signal });
  }

  private async unpack(archive: string, stage: string, pkg: SpeechPackage): Promise<ReceiptEntry[]> {
    const compressed = await readFile(archive);
    if (createHash('sha512').update(compressed).digest('base64') !== pkg.integrity) throw new Error('SPEECH_RUNTIME_HASH');
    const tar = gunzipSync(compressed, { maxOutputLength: MAX_TARBALL });
    const allowed = new Set(pkg.name === 'sherpa-onnx-node' ? WRAPPER_FILES : NATIVE_FILES);
    const receipt: ReceiptEntry[] = [];
    for (let offset = 0; offset + 512 <= tar.length;) {
      const header = tar.subarray(offset, offset + 512);
      if (header.every((byte) => byte === 0)) break;
      const string = (start: number, end: number) => header.subarray(start, end).toString('utf8').split('\0')[0];
      const name = string(0, 100);
      const sizeText = string(124, 136).trim();
      if (!/^[0-7]+$/.test(sizeText)) throw new Error('SPEECH_TAR_INVALID');
      const size = parseInt(sizeText, 8);
      const file = name.slice('package/'.length);
      const type = header[156];
      const checksum = parseInt(string(148, 156).trim(), 8);
      const actualChecksum = header.reduce((sum, byte, index) => sum + (index >= 148 && index < 156 ? 32 : byte), 0);
      if (checksum !== actualChecksum || !name.startsWith('package/') || !allowed.delete(file)
        || (type !== 0 && type !== 48) || string(157, 257) || string(345, 500)
        || offset + 512 + size > tar.length) throw new Error('SPEECH_TAR_DENIED');
      const content = tar.subarray(offset + 512, offset + 512 + size);
      const path = `node_modules/${pkg.name}/${file}`;
      const target = join(stage, path);
      await this.safe(target);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, content, { flag: 'wx' });
      receipt.push({ path, bytes: size, sha256: createHash('sha256').update(content).digest('hex') });
      offset += 512 + Math.ceil(size / 512) * 512;
    }
    if (allowed.size) throw new Error('SPEECH_TAR_INCOMPLETE');
    return receipt;
  }

  async install(models: SpeechAsset[], packages: SpeechPackage[], signal: AbortSignal,
    progress: (phase: 'runtime' | 'model' | 'verifying', bytes: number) => void): Promise<string> {
    return this.performInstall(models, packages, signal, progress);
  }

  /** Operator-only in-process import. No HTTP route, caller paths or environment mutation. */
  async importVerifiedInstall(source: SpeechRuntimeStorageService, models: SpeechAsset[], signal: AbortSignal,
    progress: (phase: 'runtime' | 'model' | 'verifying', bytes: number) => void): Promise<string> {
    const receipt = await source.verifiedReceipt(models);
    if (!receipt) throw new Error('SPEECH_IMPORT_INVALID');
    return this.performInstall(models, [], signal, progress, { storage: source, receipt });
  }

  private async copyVerifiedSource(stage: string, source: { storage: SpeechRuntimeStorageService; receipt: ReceiptEntry[] },
    signal: AbortSignal, progress: (phase: 'runtime' | 'model' | 'verifying', bytes: number) => void): Promise<ReceiptEntry[]> {
    for (const entry of source.receipt) {
      signal.throwIfAborted();
      const from = join(source.storage.readyRoot, entry.path);
      const target = join(stage, entry.path);
      await source.storage.safe(from); await this.safe(target);
      await mkdir(dirname(target), { recursive: true });
      let copied = 0;
      const limiter = new Transform({ transform(chunk: Buffer, _encoding, callback) {
        copied += chunk.length;
        if (copied > entry.bytes) return callback(new Error('SPEECH_IMPORT_OVERSIZED'));
        progress(entry.path.startsWith('model/') ? 'model' : 'runtime', chunk.length);
        callback(null, chunk);
      } });
      await pipeline(createReadStream(from), limiter, createWriteStream(target, { flags: 'wx' }), { signal });
      progress('verifying', 0);
      const actual = await this.digest(target);
      if (actual.bytes !== entry.bytes || actual.sha256 !== entry.sha256) throw new Error('SPEECH_IMPORT_HASH');
    }
    return source.receipt;
  }

  private async performInstall(models: SpeechAsset[], packages: SpeechPackage[], signal: AbortSignal,
    progress: (phase: 'runtime' | 'model' | 'verifying', bytes: number) => void,
    importSource?: { storage: SpeechRuntimeStorageService; receipt: ReceiptEntry[] }): Promise<string> {
    await this.safe(this.base);
    await mkdir(this.base, { recursive: true });
    const lockPath = join(this.base, '.install.lock');
    await this.safe(lockPath);
    let lock;
    try { lock = await open(lockPath, 'wx'); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new Error('SPEECH_INSTALL_BUSY', { cause: error });
      throw error;
    }
    let stage: string | undefined;
    let failed = false;
    const receipt: ReceiptEntry[] = [];
    try {
      await lock.writeFile(JSON.stringify({ pid: process.pid }));
      signal.throwIfAborted();
      const installed = await this.installedRoot(models);
      if (installed) return installed;
      stage = await mkdtemp(join(this.base, '.install-'));
      if (importSource) receipt.push(...await this.copyVerifiedSource(stage, importSource, signal, progress));
      else {
      for (const pkg of packages) {
        if (!['sherpa-onnx-node', 'sherpa-onnx-win-x64'].includes(pkg.name)) throw new Error('SPEECH_RUNTIME_DENIED');
        const archive = join(stage, `${pkg.name}.tgz`);
        await this.transfer(pkg.url, archive, Math.min(pkg.bytes, MAX_TARBALL), signal, (bytes) => progress('runtime', bytes));
        signal.throwIfAborted();
        receipt.push(...await this.unpack(archive, stage, pkg));
        await rm(archive);
      }
      await mkdir(join(stage, 'model'));
      for (const model of models) {
        if (!MODEL_NAMES.includes(model.name)) throw new Error('SPEECH_MODEL_DENIED');
        const path = join(stage, 'model', model.name);
        await this.transfer(model.url, path, model.bytes, signal, (bytes) => progress('model', bytes));
        progress('verifying', 0);
        const actual = await this.digest(path);
        if (actual.bytes !== model.bytes || actual.sha256 !== model.sha256) throw new Error('SPEECH_MODEL_HASH');
        receipt.push({ path: `model/${model.name}`, ...actual });
      }
      }
      signal.throwIfAborted();
      await writeFile(join(stage, 'receipt.json'), JSON.stringify(receipt), { flag: 'wx' });
      await this.safe(this.readyRoot);
      const backup = `${stage}.previous`;
      let previousMoved = false;
      let published = false;
      try {
        signal.throwIfAborted();
        try { await rename(this.readyRoot, backup); previousMoved = true; }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
        signal.throwIfAborted();
        await rename(stage, this.readyRoot);
        published = true;
      } catch (error) {
        if (previousMoved) { await this.safe(backup); await rename(backup, this.readyRoot); }
        throw error;
      } finally {
        if (published && previousMoved) { await this.safe(backup); await rm(backup, { recursive: true }); }
      }
      return this.readyRoot;
    } catch (error) {
      failed = true;
      throw error;
    } finally {
      await this.cleanupInstall(stage, lockPath, lock, failed);
    }
  }

  private async cleanupInstall(stage: string | undefined, lockPath: string, lock: FileHandle, failed: boolean): Promise<void> {
    let cleanupError: unknown;
    try {
      if (stage) {
        const offset = relative(this.base, stage);
        if (!/^\.install-[A-Za-z0-9]{6}$/.test(offset) || isAbsolute(offset)) throw new Error('SPEECH_STORAGE_ESCAPE');
        await this.safe(stage);
        await rm(stage, { recursive: true, force: true });
      }
    } catch (error) { cleanupError = error; }
    try {
      await lock.close();
      await this.safe(lockPath);
      await rm(lockPath);
    } catch (error) { cleanupError ??= error; }
    if (cleanupError !== undefined) {
      this.logger.warn('SPEECH_INSTALL_CLEANUP_FAILED');
      if (!failed) throw cleanupError;
    }
  }
}
