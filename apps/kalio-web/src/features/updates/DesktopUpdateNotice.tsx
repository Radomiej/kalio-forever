import { Download, X } from 'lucide-react';
import { useDesktopUpdater } from './desktopUpdater';

export function DesktopUpdateNotice(): React.ReactElement | null {
  const {
    update,
    status,
    progress,
    errorMessage,
    install,
    dismiss,
  } = useDesktopUpdater();

  if (!update) {
    return null;
  }

  const isInstalling = status === 'installing';

  return (
    <div
      className="fixed bottom-4 right-4 z-50 w-[min(28rem,calc(100vw-2rem))] rounded-lg border border-sky-400/40 bg-base-200/95 p-3 text-sm shadow-xl backdrop-blur"
      data-testid="desktop-update-notice"
      role="status"
      aria-live="polite"
      aria-busy={isInstalling}
    >
      <div className="flex items-start gap-3">
        <Download className="mt-0.5 shrink-0 text-sky-300" size={18} aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-base-content">Kalio update available</p>
          <p className="mt-1 text-xs text-base-content/70">
            Version {update.version} is ready to install and will restart Kalio.
          </p>
          {update.body && (
            <p className="mt-2 line-clamp-3 whitespace-pre-line text-xs text-base-content/60">{update.body}</p>
          )}
          {errorMessage && (
            <p className="mt-2 text-xs text-error" role="alert">{errorMessage}</p>
          )}
          {isInstalling && (
            <p className="mt-2 text-xs text-sky-300">
              Installing update{progress !== null ? ` — ${progress}%` : '…'}
            </p>
          )}
        </div>
        <button
          type="button"
          className="btn btn-ghost btn-xs h-7 min-h-0 w-7 shrink-0 p-0"
          onClick={dismiss}
          disabled={isInstalling}
          aria-label="Dismiss update notification"
          title="Later"
        >
          <X size={15} aria-hidden="true" />
        </button>
      </div>
      <div className="mt-3 flex justify-end gap-2">
        <button
          type="button"
          className="btn btn-ghost btn-xs"
          onClick={dismiss}
          disabled={isInstalling}
        >
          Later
        </button>
        <button
          type="button"
          className="btn btn-info btn-xs"
          onClick={() => { void install(); }}
          disabled={isInstalling}
        >
          {isInstalling ? 'Installing…' : 'Install and restart'}
        </button>
      </div>
    </div>
  );
}
