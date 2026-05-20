import { useEffect, useState } from 'react';
import { getSessionVfsServeUrl } from '../../services/apiClient';
import { HtmlIframeRenderer } from './HtmlIframeRenderer';

interface VfsHtmlRendererProps {
  sessionId: string;
  vfsPath: string;
  title?: string;
  minHeight?: number;
}

type PreviewStatus = 'checking' | 'ready' | 'unavailable';

export function VfsHtmlRenderer({ sessionId, vfsPath, title = 'App', minHeight = 200 }: VfsHtmlRendererProps) {
  const src = getSessionVfsServeUrl(sessionId, vfsPath);
  const [status, setStatus] = useState<PreviewStatus>('checking');
  const [checkVersion, setCheckVersion] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setStatus('checking');

    fetch(src, { signal: controller.signal })
      .then((response) => {
        if (controller.signal.aborted) {
          return;
        }
        setStatus(response.ok ? 'ready' : 'unavailable');
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) {
          return;
        }
        console.error(
          '[VfsHtmlRenderer] preview preflight failed',
          err instanceof Error ? err : new Error(String(err)),
        );
        setStatus('unavailable');
      });

    return () => controller.abort();
  }, [src, checkVersion]);

  const handleRetry = () => setCheckVersion((value) => value + 1);

  if (status === 'unavailable') {
    return (
      <div
        data-testid="raapp-preview-unavailable"
        className="rounded border border-warning/30 bg-warning/10 px-4 py-3 text-sm text-warning-content"
      >
        <p className="mb-2">
          Your preview is not available yet. If the app is still building, wait a moment and retry.
        </p>
        <button
          type="button"
          className="btn btn-outline btn-xs"
          onClick={handleRetry}
        >
          Retry preview
        </button>
      </div>
    );
  }

  if (status !== 'ready') {
    return (
      <div
        data-testid="raapp-preview-loading"
        className="rounded border border-base-300 bg-base-200/40 px-4 py-3 text-sm text-base-content/70"
      >
        Preparing your app preview...
      </div>
    );
  }

  return <HtmlIframeRenderer src={src} title={title} minHeight={minHeight} />;
}
