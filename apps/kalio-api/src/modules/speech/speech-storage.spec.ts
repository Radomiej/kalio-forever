import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConfigService } from '@nestjs/config';
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import * as fsPromises from 'node:fs/promises';
import { SpeechRuntimeStorageService } from '../vfs/speech-runtime-storage.service';
import { SPEECH_MODEL_FILES } from './speech-catalog';

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return { ...actual, rename: vi.fn(actual.rename), rm: vi.fn(actual.rm) };
});

const wrapperNames = ['addon-static-import.js', 'addon.js', 'audio-tagg.js', 'keyword-spotter.js',
  'non-streaming-asr.js', 'non-streaming-speaker-diarization.js', 'non-streaming-speech-denoiser.js',
  'non-streaming-tts.js', 'online-speech-denoiser.js', 'punctuation.js', 'resampler.js', 'sherpa-onnx.js',
  'speaker-identification.js', 'spoken-language-identification.js', 'streaming-asr.js', 'types.js',
  'vad.js', 'package.json', 'README.md'];
const nativeNames = ['onnxruntime_providers_shared.dll', 'onnxruntime.dll', 'sherpa-onnx-c-api.dll',
  'sherpa-onnx-cxx-api.dll', 'index.js', 'package.json', 'README.md', 'sherpa-onnx.node'];
const digest = (content: Buffer, algorithm = 'sha256', encoding: 'hex' | 'base64' = 'hex') => createHash(algorithm).update(content).digest(encoding);

function tar(files: string[], type = 48): Buffer {
  const entries = files.flatMap((name) => {
    const header = Buffer.alloc(512); header.write(`package/${name}`);
    header.write('00000000001\0', 124); header[156] = type;
    header.fill(32, 148, 156);
    header.write(header.reduce((sum, byte) => sum + byte, 0).toString(8).padStart(6, '0') + '\0 ', 148);
    const content = Buffer.alloc(512); content[0] = 120;
    return [header, content];
  });
  return gzipSync(Buffer.concat([...entries, Buffer.alloc(1024)]));
}

describe('speech VFS install boundary (synthetic packages/models)', () => {
  let root: string;
  let storage: SpeechRuntimeStorageService;
  let archives: Map<string, Buffer>;
  const models = SPEECH_MODEL_FILES.map((asset) => ({ ...asset, bytes: 1, sha256: digest(Buffer.from('x')) }));
  const packages = [
    { name: 'sherpa-onnx-node', bytes: tar(wrapperNames).length, url: 'https://registry.npmjs.org/wrapper', integrity: digest(tar(wrapperNames), 'sha512', 'base64') },
    { name: 'sherpa-onnx-win-x64', bytes: tar(nativeNames).length, url: 'https://registry.npmjs.org/native', integrity: digest(tar(nativeNames), 'sha512', 'base64') },
  ];
  beforeEach(async () => {
    vi.mocked(fsPromises.rename).mockReset().mockImplementation((await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises')).rename);
    vi.mocked(fsPromises.rm).mockReset().mockImplementation((await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises')).rm);
    root = await mkdtemp(join(tmpdir(), 'kalio-speech-storage-'));
    storage = new SpeechRuntimeStorageService(new ConfigService({ WORKSPACE_ROOT: root }));
    archives = new Map([['https://registry.npmjs.org/wrapper', tar(wrapperNames)], ['https://registry.npmjs.org/native', tar(nativeNames)],
      ...models.map((model): [string, Buffer] => [model.url, Buffer.from('x')])]);
    vi.stubGlobal('fetch', vi.fn(async (url: URL | string) => new Response(new Uint8Array(archives.get(String(url)) ?? Buffer.alloc(0)))));
  });
  afterEach(async () => {
    vi.restoreAllMocks(); vi.unstubAllGlobals();
    await (await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises')).rm(root, { recursive: true, force: true });
  });

  it('publishes only a complete verified install and detects corruption after restart', async () => {
    expect(await storage.installedRoot(models)).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
    const installed = await storage.install(models, packages, new AbortController().signal, vi.fn());
    expect(await storage.installedRoot(models)).toBe(installed);
    await writeFile(join(installed, 'model', models[0].name), 'y');
    const restarted = new SpeechRuntimeStorageService(new ConfigService({ WORKSPACE_ROOT: root }));
    expect(await restarted.installedRoot(models)).toBeNull();
    expect(await readdir(join(root, '.speech-runtime'))).toEqual(['parakeet-v3-sherpa-1.13.8']);
  });
  it.each(['hash', 'size', 'runtime-hash'])('cleans partials without publishing on %s mismatch', async (failure) => {
    const changed = models.map((model) => ({ ...model }));
    if (failure === 'hash') changed[0].sha256 = '0'.repeat(64);
    if (failure === 'size') archives.set(changed[0].url, Buffer.from('xx'));
    if (failure === 'runtime-hash') archives.set(packages[0].url, Buffer.from('invalid'));
    await expect(storage.install(changed, packages, new AbortController().signal, vi.fn())).rejects.toThrow();
    expect(await readdir(join(root, '.speech-runtime'))).toEqual([]);
  });
  it.each([['../escape', 48], ['/escape', 48], ['addon.js', 50], ['addon.js', 49], ['install.js', 48]])(
    'rejects nonallowlisted archive entry %s/type %i', async (file, type) => {
      const malicious = tar([file], type);
      archives.set(packages[0].url, malicious);
      const changed = [{ ...packages[0], bytes: malicious.length, integrity: digest(malicious, 'sha512', 'base64') }];
      await expect(storage.install(models, changed, new AbortController().signal, vi.fn())).rejects.toThrow();
      expect(await readdir(join(root, '.speech-runtime'))).toEqual([]);
    });
  it('cleans cancellation after a completed download, never publishes', async () => {
    const controller = new AbortController();
    await expect(storage.install(models, packages, controller.signal, () => controller.abort())).rejects.toThrow();
    expect(await readdir(join(root, '.speech-runtime'))).toEqual([]);
  });
  it('rejects redirect to loopback before requesting it', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 302, headers: { location: 'https://127.0.0.1/private' } })));
    await expect(storage.install(models, packages, new AbortController().signal, vi.fn())).rejects.toThrow('SPEECH_SOURCE_DENIED');
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('rejects a junction/symlink install root without writing through it', async () => {
    const outside = join(root, 'outside'); await mkdir(outside);
    await symlink(outside, join(root, '.speech-runtime'), process.platform === 'win32' ? 'junction' : 'dir');
    await expect(storage.install(models, packages, new AbortController().signal, vi.fn())).rejects.toThrow('SPEECH_STORAGE_REDIRECT');
    expect(await readdir(outside)).toEqual([]);
  });
  it('rejects a competing installer without touching its lock/staging or the ready model', async () => {
    const privateRoot = join(root, '.speech-runtime'); await mkdir(privateRoot);
    const owner = JSON.stringify({ pid: process.pid });
    await writeFile(join(privateRoot, '.install.lock'), owner);
    const staging = join(privateRoot, '.install-ABC123'); await mkdir(staging);
    await writeFile(join(staging, 'active.bin'), 'owned');
    await expect(storage.install(models, packages, new AbortController().signal, vi.fn())).rejects.toMatchObject({
      message: 'SPEECH_INSTALL_BUSY', cause: { code: 'EEXIST' },
    });
    expect(await readFile(join(privateRoot, '.install.lock'), 'utf8')).toBe(owner);
    expect(await readFile(join(staging, 'active.bin'), 'utf8')).toBe('owned');
    expect(fetch).not.toHaveBeenCalled();
  });
  it('reuses a fully verified healthy ready model under lock without downloading or displacing it', async () => {
    const ready = await storage.install(models, packages, new AbortController().signal, vi.fn());
    vi.mocked(fetch).mockClear();
    expect(await storage.install(models, packages, new AbortController().signal, vi.fn())).toBe(ready);
    expect(fetch).not.toHaveBeenCalled();
    expect(await storage.installedRoot(models)).toBe(ready);
  });
  it.each(['abort', 'rename-failure'])('restores previous corrupt install on %s during repair promotion', async (mode) => {
    const ready = await storage.install(models, packages, new AbortController().signal, vi.fn());
    await writeFile(join(ready, 'model', models[0].name), 'previous-preserved');
    const receipt = await readFile(join(ready, 'receipt.json'));
    const abort = new AbortController(); const actualRename = (await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises')).rename;
    vi.mocked(fsPromises.rename).mockImplementation(async (source, destination) => {
      if (mode === 'rename-failure' && String(destination) === ready && !String(source).endsWith('.previous')) {
        throw new Error('TEST_PUBLISH_FAILURE');
      }
      await actualRename(source, destination);
      if (mode === 'abort' && String(destination).endsWith('.previous')) abort.abort();
    });
    await expect(storage.install(models, packages, abort.signal, vi.fn())).rejects.toThrow();
    expect(await readFile(join(ready, 'model', models[0].name), 'utf8')).toBe('previous-preserved');
    expect(await readFile(join(ready, 'receipt.json'))).toEqual(receipt);
    expect(await readdir(join(root, '.speech-runtime'))).toEqual(['parakeet-v3-sherpa-1.13.8']);
  });
  it('imports only verified fixed entries without network and preserves source bytes', async () => {
    const sourceRoot = await storage.install(models, packages, new AbortController().signal, vi.fn());
    const sourceReceipt = await readFile(join(sourceRoot, 'receipt.json'));
    const target = new SpeechRuntimeStorageService(new ConfigService({ WORKSPACE_ROOT: join(root, 'target') }));
    vi.mocked(fetch).mockClear();
    const targetRoot = await target.importVerifiedInstall(storage, models, new AbortController().signal, vi.fn());
    expect(await target.installedRoot(models)).toBe(targetRoot);
    expect(await readFile(join(targetRoot, 'receipt.json'))).toEqual(sourceReceipt);
    expect(await readFile(join(sourceRoot, 'receipt.json'))).toEqual(sourceReceipt);
    expect(await storage.installedRoot(models)).toBe(sourceRoot);
    expect(fetch).not.toHaveBeenCalled();
  });
  it.each(['model/encoder.int8.onnx', 'node_modules/sherpa-onnx-node/addon.js'])('rejects corrupt import source %s', async (path) => {
    const sourceRoot = await storage.install(models, packages, new AbortController().signal, vi.fn());
    await writeFile(join(sourceRoot, path), 'corrupt');
    const target = new SpeechRuntimeStorageService(new ConfigService({ WORKSPACE_ROOT: join(root, 'target') }));
    vi.mocked(fetch).mockClear();
    await expect(target.importVerifiedInstall(storage, models, new AbortController().signal, vi.fn())).rejects.toThrow('SPEECH_IMPORT_INVALID');
    expect(fetch).not.toHaveBeenCalled();
  });
  it('cleans cancelled import and rejects redirected target without touching source', async () => {
    const sourceRoot = await storage.install(models, packages, new AbortController().signal, vi.fn());
    const targetBase = join(root, 'target');
    const target = new SpeechRuntimeStorageService(new ConfigService({ WORKSPACE_ROOT: targetBase }));
    const abort = new AbortController();
    await expect(target.importVerifiedInstall(storage, models, abort.signal, () => abort.abort())).rejects.toThrow();
    expect(await readdir(join(targetBase, '.speech-runtime'))).toEqual([]);
    const outside = join(root, 'outside'); await mkdir(outside);
    await rm(join(targetBase, '.speech-runtime'), { recursive: true });
    await symlink(outside, join(targetBase, '.speech-runtime'), process.platform === 'win32' ? 'junction' : 'dir');
    await expect(target.importVerifiedInstall(storage, models, new AbortController().signal, vi.fn())).rejects.toThrow('SPEECH_STORAGE_REDIRECT');
    expect(await readdir(outside)).toEqual([]);
    expect(await storage.installedRoot(models)).toBe(sourceRoot);
  });
  it('preserves the primary failure when stage cleanup fails and still releases its lock', async () => {
    const primary = new Error('TEST_DOWNLOAD_FAILURE');
    vi.mocked(fetch).mockRejectedValueOnce(primary);
    const actualRm = (await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises')).rm;
    vi.mocked(fsPromises.rm).mockImplementation(async (path, options) => {
      if (/\.install-[A-Za-z0-9]{6}$/.test(String(path))) throw new Error('TEST_CLEANUP_FAILURE');
      await actualRm(path, options);
    });
    await expect(storage.install(models, packages, new AbortController().signal, vi.fn())).rejects.toBe(primary);
    const remaining = await readdir(join(root, '.speech-runtime'));
    expect(remaining).toHaveLength(1);
    expect(remaining[0]).toMatch(/^\.install-[A-Za-z0-9]{6}$/);
    expect(remaining).not.toContain('.install.lock');
  });
});
