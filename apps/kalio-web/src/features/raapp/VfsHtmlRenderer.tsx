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

  useEffect(() => {
    const controller = new AbortController();
    setStatus('checking');

    fetch(src, { signal: controller.signal, credentials: 'include' })
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
  }, [src]);

  if (status === 'unavailable') {
    return (
      <div
        data-testid="raapp-preview-unavailable"
        className="rounded border border-warning/30 bg-warning/10 px-4 py-3 text-sm text-warning-content"
      >
        Preview unavailable. The file is missing or the session expired.
      </div>
    );
  }

  if (status !== 'ready') {
    return (
      <div
        data-testid="raapp-preview-loading"
        className="rounded border border-base-300 bg-base-200/40 px-4 py-3 text-sm text-base-content/70"
      >
        Loading preview...
      </div>
    );
  }

  return <HtmlIframeRenderer src={src} title={title} minHeight={minHeight} />;
}