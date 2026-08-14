import { useCallback, useEffect, useRef, useState } from 'react';
import { check, type DownloadEvent, type Update } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';

const UPDATE_CHECK_TIMEOUT_MS = 15_000;
const UPDATE_DOWNLOAD_TIMEOUT_MS = 120_000;

export type DesktopUpdateStatus = 'idle' | 'checking' | 'available' | 'installing';

export function isTauriDesktopRuntime(): boolean {
  if (typeof window === 'undefined' || import.meta.env.DEV) {
    return false;
  }

  return window.location.protocol === 'tauri:' || window.location.hostname === 'tauri.localhost';
}

export async function checkForDesktopUpdate(): Promise<Update | null> {
  if (!isTauriDesktopRuntime()) {
    return null;
  }

  return check({ timeout: UPDATE_CHECK_TIMEOUT_MS });
}

export async function installDesktopUpdate(
  update: Update,
  onEvent: (event: DownloadEvent) => void,
): Promise<void> {
  await update.downloadAndInstall(onEvent, { timeout: UPDATE_DOWNLOAD_TIMEOUT_MS });
  await relaunch();
}

export function useDesktopUpdater() {
  const [update, setUpdate] = useState<Update | null>(null);
  const [status, setStatus] = useState<DesktopUpdateStatus>('idle');
  const [progress, setProgress] = useState<number | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const checkedRef = useRef(false);
  const dismissedRef = useRef(false);
  const downloadedBytesRef = useRef(0);
  const contentLengthRef = useRef(0);

  const checkNow = useCallback(async () => {
    if (dismissedRef.current) {
      return;
    }

    setStatus('checking');
    try {
      const candidate = await checkForDesktopUpdate();
      if (!candidate) {
        setUpdate(null);
        setStatus('idle');
        return;
      }

      setUpdate(candidate);
      setStatus('available');
    } catch (error: unknown) {
      console.warn('[DesktopUpdater] Update check failed', error);
      setStatus('idle');
    }
  }, []);

  useEffect(() => {
    if (checkedRef.current) {
      return;
    }
    checkedRef.current = true;
    void checkNow();
  }, [checkNow]);

  const install = useCallback(async () => {
    if (!update) {
      return;
    }

    setStatus('installing');
    setErrorMessage(null);
    setProgress(0);
    downloadedBytesRef.current = 0;
    contentLengthRef.current = 0;

    try {
      await installDesktopUpdate(update, (event) => {
        if (event.event === 'Started') {
          contentLengthRef.current = event.data.contentLength ?? 0;
          setProgress(0);
          return;
        }

        if (event.event === 'Progress') {
          downloadedBytesRef.current += event.data.chunkLength;
          if (contentLengthRef.current > 0) {
            setProgress(Math.min(100, Math.round(
              (downloadedBytesRef.current / contentLengthRef.current) * 100,
            )));
          }
          return;
        }

        setProgress(100);
      });
      setUpdate(null);
      setStatus('idle');
    } catch (error: unknown) {
      console.warn('[DesktopUpdater] Update installation failed', error);
      setErrorMessage('The update could not be installed. Try again later.');
      setStatus('available');
      setProgress(null);
    }
  }, [update]);

  const dismiss = useCallback(() => {
    dismissedRef.current = true;
    setUpdate(null);
    setErrorMessage(null);
    setProgress(null);
    setStatus('idle');
  }, []);

  return {
    update,
    status,
    progress,
    errorMessage,
    install,
    dismiss,
  };
}
