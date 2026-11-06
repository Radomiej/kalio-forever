import { afterEach, describe, expect, it, vi } from 'vitest';
import { SpeechInstallService } from './speech-install.service';
import type { SpeechRuntimeStorageService } from '../vfs/speech-runtime-storage.service';

describe.skipIf(process.platform !== 'win32' || process.arch !== 'x64')('speech Windows explicit install lifecycle (fixture storage)', () => {
  afterEach(() => vi.restoreAllMocks());
  const fixture = () => {
    const storage = { installedRoot: vi.fn(async (): Promise<string | null> => null), install: vi.fn() };
    const service = new SpeechInstallService(storage as unknown as SpeechRuntimeStorageService);
    return { storage, service };
  };
  it('reports full pinned size before Install and never starts network/install from status', async () => {
    const { storage, service } = fixture();
    expect(await service.status()).toMatchObject({ status: 'missing', installed: false, totalBytes: 679385601, downloadedBytes: 0 });
    await service.status(); expect(storage.install).not.toHaveBeenCalled();
  });
  it('deduplicates explicit installs, projects progress/verification and makes ready only on verified root', async () => {
    const { storage, service } = fixture();
    let done!: (root: string) => void;
    storage.install.mockImplementation((_models, _packages, _signal, progress) => {
      progress('runtime', 11954); progress('model', 100); progress('verifying', 0);
      return new Promise<string>((resolve) => { done = resolve; });
    });
    expect((await service.install()).status).toBe('verifying');
    expect(await service.status()).toMatchObject({ installed: false, downloadedBytes: 12054 });
    await service.install(); expect(storage.install).toHaveBeenCalledTimes(1);
    done('/verified-private-root');
    await vi.waitFor(async () => expect((await service.status()).status).toBe('ready'));
    expect(await service.installedRoot()).toBe('/verified-private-root');
  });
  it('cancellation awaits cleanup, returns typed recoverable error and permits explicit retry', async () => {
    const { storage, service } = fixture();
    storage.install.mockImplementation((_models, _packages, signal: AbortSignal) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(new Error('ABORTED')), { once: true });
    }));
    await service.install();
    expect(await service.cancel()).toMatchObject({ status: 'error', installed: false, errorCode: 'SPEECH_INSTALL_CANCELLED' });
    storage.install.mockResolvedValue('/verified'); await service.install();
    await vi.waitFor(async () => expect((await service.status()).status).toBe('ready'));
  });
  it('discovers an externally verified import after missing status without Install or restart', async () => {
    const { storage, service } = fixture();
    expect((await service.status()).status).toBe('missing');
    storage.installedRoot.mockResolvedValue('/externally-verified-import');
    expect(await service.status()).toMatchObject({ status: 'ready', installed: true, errorCode: null });
    expect(storage.install).not.toHaveBeenCalled();
  });
});
