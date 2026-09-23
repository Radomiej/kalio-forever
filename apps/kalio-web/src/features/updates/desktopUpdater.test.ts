import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DownloadEvent, Update } from '@tauri-apps/plugin-updater';
import { check } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';
import {
  checkForDesktopUpdate,
  installDesktopUpdate,
  isTauriDesktopRuntime,
  useDesktopUpdater,
} from './desktopUpdater';

vi.mock('@tauri-apps/plugin-updater', () => ({
  check: vi.fn(),
}));

vi.mock('@tauri-apps/plugin-process', () => ({
  relaunch: vi.fn(),
}));

const mockedCheck = vi.mocked(check);
const mockedRelaunch = vi.mocked(relaunch);

function createUpdate(downloadAndInstall?: Update['downloadAndInstall']): Update {
  return {
    version: '1.1.0',
    body: 'Bug fixes',
    downloadAndInstall: downloadAndInstall ?? vi.fn().mockResolvedValue(undefined),
  } as unknown as Update;
}

function useWindowLocation(protocol: string, hostname: string): void {
  const originalWindow = window;
  const tauriWindow = Object.create(originalWindow) as Window;
  Object.defineProperty(tauriWindow, 'location', {
    configurable: true,
    value: { protocol, hostname },
  });
  vi.stubGlobal('window', tauriWindow);
}

function useDesktopWindow(): void {
  useWindowLocation('tauri:', 'tauri.localhost');
}

describe('desktopUpdater', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('DEV', false);
    useDesktopWindow();
    mockedRelaunch.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('recognizes the Tauri runtime and skips update checks in development', async () => {
    expect(isTauriDesktopRuntime()).toBe(true);

    vi.stubEnv('DEV', true);
    expect(isTauriDesktopRuntime()).toBe(false);
    await expect(checkForDesktopUpdate()).resolves.toBeNull();
    expect(mockedCheck).not.toHaveBeenCalled();
  });

  it('requires a Tauri protocol or hostname outside development', () => {
    useWindowLocation('http:', 'tauri.localhost');
    expect(isTauriDesktopRuntime()).toBe(true);

    useWindowLocation('tauri:', 'app.localhost');
    expect(isTauriDesktopRuntime()).toBe(true);

    useWindowLocation('http:', 'app.localhost');
    expect(isTauriDesktopRuntime()).toBe(false);
  });

  it('skips the runtime check when window is unavailable', () => {
    vi.stubGlobal('window', undefined);

    expect(isTauriDesktopRuntime()).toBe(false);
  });

  it('checks for an update with the bounded timeout', async () => {
    const update = createUpdate();
    mockedCheck.mockResolvedValue(update);

    await expect(checkForDesktopUpdate()).resolves.toBe(update);
    expect(mockedCheck).toHaveBeenCalledWith({ timeout: 15_000 });
  });

  it('downloads, forwards events, and relaunches after installation', async () => {
    const onEvent = vi.fn<(event: DownloadEvent) => void>();
    const downloadAndInstall = vi.fn().mockResolvedValue(undefined);
    const update = createUpdate(downloadAndInstall);

    await installDesktopUpdate(update, onEvent);

    expect(downloadAndInstall).toHaveBeenCalledWith(onEvent, { timeout: 120_000 });
    expect(mockedRelaunch).toHaveBeenCalledOnce();
  });

  it('does not relaunch when installation fails', async () => {
    const update = createUpdate(vi.fn().mockRejectedValue(new Error('download failed')));

    await expect(installDesktopUpdate(update, vi.fn())).rejects.toThrow('download failed');
    expect(mockedRelaunch).not.toHaveBeenCalled();
  });

  it('stays idle when no update is published and ignores install without a candidate', async () => {
    let resolveCheck!: (value: Update | null) => void;
    mockedCheck.mockReturnValue(new Promise<Update | null>((resolve) => {
      resolveCheck = resolve;
    }));

    const { result } = renderHook(() => useDesktopUpdater());
    await waitFor(() => expect(result.current.status).toBe('checking'));
    expect(result.current.status).toBe('checking');

    await act(async () => {
      resolveCheck(null);
    });
    await waitFor(() => expect(result.current.status).toBe('idle'));
    expect(result.current.update).toBeNull();
    expect(result.current.errorMessage).toBeNull();

    await act(async () => {
      await result.current.install();
    });

    expect(result.current.status).toBe('idle');
    expect(mockedRelaunch).not.toHaveBeenCalled();
  });

  it('clears an existing candidate when a retry finds no update', async () => {
    const update = createUpdate();
    mockedCheck.mockResolvedValueOnce(update).mockResolvedValueOnce(null);

    const { result } = renderHook(() => useDesktopUpdater());
    await waitFor(() => expect(result.current.status).toBe('available'));

    await act(async () => {
      await result.current.retry();
    });

    expect(result.current.status).toBe('idle');
    expect(result.current.update).toBeNull();
  });

  it('does not start duplicate checks under React strict mode', async () => {
    mockedCheck.mockResolvedValue(null);

    renderHook(() => useDesktopUpdater(), { reactStrictMode: true });

    await waitFor(() => expect(mockedCheck).toHaveBeenCalledOnce());
  });

  it('hydrates an available update, reports progress, and clears it after install', async () => {
    const update = createUpdate();
    const downloadAndInstall = vi.fn(async (onEvent: (event: DownloadEvent) => void) => {
      onEvent({ event: 'Started', data: { contentLength: 100 } });
      onEvent({ event: 'Progress', data: { chunkLength: 40 } });
      onEvent({ event: 'Progress', data: { chunkLength: 70 } });
      onEvent({ event: 'Finished' });
    });
    update.downloadAndInstall = downloadAndInstall;
    mockedCheck.mockResolvedValue(update);

    const { result } = renderHook(() => useDesktopUpdater());
    await waitFor(() => expect(result.current.status).toBe('available'));
    expect(result.current.update).toBe(update);

    await act(async () => {
      await result.current.install();
    });

    expect(result.current.update).toBeNull();
    expect(result.current.status).toBe('idle');
    expect(result.current.progress).toBe(100);
    expect(downloadAndInstall).toHaveBeenCalledOnce();
  });

  it('reports bounded progress and resets progress for an unknown content length', async () => {
    const update = createUpdate();
    let emitDownloadEvent: ((event: DownloadEvent) => void) | undefined;
    let releaseInstall!: () => void;
    const installationDone = new Promise<void>((resolve) => {
      releaseInstall = resolve;
    });
    const downloadAndInstall = vi.fn(async (onEvent: (event: DownloadEvent) => void) => {
      emitDownloadEvent = onEvent;
      await installationDone;
    });
    update.downloadAndInstall = downloadAndInstall;
    mockedCheck.mockResolvedValue(update);

    const { result } = renderHook(() => useDesktopUpdater());
    await waitFor(() => expect(result.current.status).toBe('available'));

    let installPromise!: Promise<void>;
    act(() => {
      installPromise = result.current.install();
    });
    await waitFor(() => expect(result.current.status).toBe('installing'));
    await waitFor(() => expect(emitDownloadEvent).toBeTypeOf('function'));

    act(() => {
      emitDownloadEvent?.({ event: 'Started', data: { contentLength: 100 } });
    });
    expect(result.current.progress).toBe(0);

    act(() => {
      emitDownloadEvent?.({ event: 'Progress', data: { chunkLength: 40 } });
    });
    expect(result.current.progress).toBe(40);

    act(() => {
      emitDownloadEvent?.({ event: 'Progress', data: { chunkLength: 70 } });
    });
    expect(result.current.progress).toBe(100);

    act(() => {
      emitDownloadEvent?.({ event: 'Started', data: {} });
    });
    expect(result.current.progress).toBe(0);

    act(() => {
      emitDownloadEvent?.({ event: 'Progress', data: { chunkLength: 40 } });
    });
    expect(result.current.progress).toBe(0);

    act(() => {
      emitDownloadEvent?.({ event: 'Finished' });
    });
    expect(result.current.progress).toBe(100);

    await act(async () => {
      releaseInstall();
      await installPromise;
    });
    expect(result.current.status).toBe('idle');
    expect(result.current.update).toBeNull();
  });

  it('shows a retryable error when checking fails and clears it on retry', async () => {
    const update = createUpdate();
    mockedCheck.mockRejectedValueOnce(new Error('network down')).mockResolvedValueOnce(update);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const { result } = renderHook(() => useDesktopUpdater());
    await waitFor(() => expect(result.current.errorMessage).toBe('Updates are temporarily unavailable. Try again.'));
    expect(result.current.update).toBeNull();
    expect(result.current.status).toBe('idle');
    expect(warn).toHaveBeenCalledWith('[DesktopUpdater] Update check failed', expect.any(Error));

    await act(async () => {
      await result.current.retry();
    });

    expect(result.current.update).toBe(update);
    expect(result.current.status).toBe('available');
    expect(result.current.errorMessage).toBeNull();
    warn.mockRestore();
  });

  it('keeps a failed installation retryable and dismiss clears all state', async () => {
    const update = createUpdate(vi.fn().mockRejectedValue(new Error('download failed')));
    mockedCheck.mockResolvedValue(update);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { result } = renderHook(() => useDesktopUpdater());
    await waitFor(() => expect(result.current.status).toBe('available'));

    await act(async () => {
      await result.current.install();
    });

    expect(result.current.status).toBe('available');
    expect(result.current.errorMessage).toBe('The update could not be installed. Try again later.');
    expect(result.current.progress).toBeNull();
    expect(warn).toHaveBeenCalledWith('[DesktopUpdater] Update installation failed', expect.any(Error));

    act(() => {
      result.current.dismiss();
    });

    expect(result.current.update).toBeNull();
    expect(result.current.status).toBe('idle');
    expect(result.current.errorMessage).toBeNull();
    expect(result.current.progress).toBeNull();

    await act(async () => {
      await result.current.retry();
    });
    expect(mockedCheck).toHaveBeenCalledOnce();
    warn.mockRestore();
  });

  it('clears the previous installation error and resets progress on retry', async () => {
    const update = createUpdate();
    let releaseRetry!: () => void;
    const retryInstallDone = new Promise<void>((resolve) => {
      releaseRetry = resolve;
    });
    const downloadAndInstall = vi.fn()
      .mockRejectedValueOnce(new Error('download failed'))
      .mockImplementationOnce(async () => {
        await retryInstallDone;
      });
    update.downloadAndInstall = downloadAndInstall;
    mockedCheck.mockResolvedValue(update);

    const { result } = renderHook(() => useDesktopUpdater());
    await waitFor(() => expect(result.current.status).toBe('available'));

    await act(async () => {
      await result.current.install();
    });
    expect(result.current.errorMessage).toBe('The update could not be installed. Try again later.');

    let retryPromise!: Promise<void>;
    act(() => {
      retryPromise = result.current.install();
    });
    await waitFor(() => expect(result.current.status).toBe('installing'));
    expect(result.current.errorMessage).toBeNull();
    expect(result.current.progress).toBe(0);

    await act(async () => {
      releaseRetry();
      await retryPromise;
    });
    expect(result.current.status).toBe('idle');
    expect(result.current.update).toBeNull();
  });

  it('clears download progress when dismissed during installation', async () => {
    const update = createUpdate();
    let emitDownloadEvent: ((event: DownloadEvent) => void) | undefined;
    let releaseInstall!: () => void;
    const installationDone = new Promise<void>((resolve) => {
      releaseInstall = resolve;
    });
    update.downloadAndInstall = vi.fn(async (onEvent: (event: DownloadEvent) => void) => {
      emitDownloadEvent = onEvent;
      await installationDone;
    });
    mockedCheck.mockResolvedValue(update);

    const { result } = renderHook(() => useDesktopUpdater());
    await waitFor(() => expect(result.current.status).toBe('available'));

    let installPromise!: Promise<void>;
    act(() => {
      installPromise = result.current.install();
    });
    await waitFor(() => expect(emitDownloadEvent).toBeTypeOf('function'));
    act(() => {
      emitDownloadEvent?.({ event: 'Started', data: { contentLength: 100 } });
      emitDownloadEvent?.({ event: 'Progress', data: { chunkLength: 40 } });
    });
    expect(result.current.progress).toBe(40);

    act(() => {
      result.current.dismiss();
    });
    expect(result.current.progress).toBeNull();

    await act(async () => {
      releaseInstall();
      await installPromise;
    });
  });
});
