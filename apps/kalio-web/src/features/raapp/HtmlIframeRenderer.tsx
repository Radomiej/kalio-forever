import { useEffect, useRef, useState, useCallback } from 'react';
import { Download, Expand, X } from 'lucide-react';
import { nanoid } from 'nanoid';
import { useSessionStore } from '../../store/sessionStore';
import { eventBus } from '../../services/eventBus';
import type { ChatMessage } from '@kalio/types';
import { injectRaAppResizeBridge } from './raapp-preview-bridge';

interface HtmlIframeRendererProps {
  html?: string;
  src?: string;
  title?: string;
  minHeight?: number;
}

const SANDBOX_ATTR = 'allow-scripts allow-modals';
const MAX_INLINE_PREVIEW_HEIGHT = 1200;

export function HtmlIframeRenderer({ html, src, title = 'App', minHeight = 200 }: HtmlIframeRendererProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const fullscreenIframeRef = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(minHeight);
  const [expanded, setExpanded] = useState(false);
  const bridgedHtml = typeof html === 'string' ? injectRaAppResizeBridge(html) : undefined;

  const isKnownIframeSource = useCallback((source: MessageEvent['source']) => {
    if (!source) return false;
    const mainSource = iframeRef.current?.contentWindow;
    const fullSource = fullscreenIframeRef.current?.contentWindow;
    return source === mainSource || source === fullSource;
  }, []);

  const handleMessage = useCallback(
    (event: MessageEvent) => {
      if (!isKnownIframeSource(event.source)) return;
      const data = event.data;

      if (data?.type === 'raapp_resize' && typeof data.height === 'number') {
        const next = Math.min(Math.max(minHeight, MAX_INLINE_PREVIEW_HEIGHT), Math.max(minHeight, Math.ceil(data.height)));
        setHeight((prev) => {
          // Ignore tiny jitter to prevent feedback growth loops from postMessage+resize.
          if (Math.abs(prev - next) < 2) return prev;
          return next;
        });
        return;
      }

      // Interactive bridge: iframe sends user answer back to chat
      if (data?.type === 'kalio_send_message' && typeof data.content === 'string') {
        console.log('[RAApp:Bridge] received kalio_send_message', JSON.stringify(data.content).slice(0, 80));
        const { activeSessionId, sessions, addMessage } = useSessionStore.getState();
        if (!activeSessionId) return;
        const session = sessions.find((s) => s.id === activeSessionId);
        if (!session) return;
        const userMsg: ChatMessage = {
          id: nanoid(),
          sessionId: activeSessionId,
          role: 'user',
          content: data.content as string,
          createdAt: Date.now(),
        };
        addMessage(userMsg);
        eventBus.sendMessage({
          sessionId: activeSessionId,
          content: data.content as string,
          personaId: session.personaId,
        });
      }
    },
    [isKnownIframeSource, minHeight],
  );

  useEffect(() => {
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [handleMessage]);

  const handleLoad = () => {
    // Ask iframe to report its scroll height via postMessage bridge.
    iframeRef.current?.contentWindow?.postMessage({ type: 'raapp_query_height' }, '*');
  };

  const handleFullscreenLoad = () => {
    fullscreenIframeRef.current?.contentWindow?.postMessage({ type: 'raapp_query_height' }, '*');
  };

  const downloadHtml = () => {
    if (typeof html !== 'string') {
      return;
    }
    const blob = new Blob([html], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${title.replace(/\s+/g, '-').toLowerCase()}.html`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="relative group">
      {typeof html === 'string' && (
        <button
          onClick={downloadHtml}
          className="absolute top-2 right-10 z-10 btn btn-xs btn-ghost opacity-0 group-hover:opacity-100 transition-opacity bg-base-100/80"
          title="Download HTML"
          aria-label="Download HTML"
        >
          <Download size={12} />
        </button>
      )}
      <button
        onClick={() => setExpanded(true)}
        className="absolute top-2 right-2 z-10 btn btn-xs btn-ghost opacity-0 group-hover:opacity-100 transition-opacity bg-base-100/80"
        title="Open fullscreen"
        aria-label="Open fullscreen"
      >
        <Expand size={12} />
      </button>
      <iframe
        ref={iframeRef}
        data-testid="raapp-iframe"
        src={src}
        srcDoc={bridgedHtml}
        className="w-full rounded border border-base-300 block"
        style={{ height: `${height}px`, minHeight: `${minHeight}px` }}
        sandbox={SANDBOX_ATTR}
        title={title}
        onLoad={handleLoad}
      />

      {expanded && (
        <dialog className="modal modal-open" aria-label="RA-App fullscreen modal" onClick={() => setExpanded(false)}>
          <div className="modal-box w-[96vw] max-w-none h-[92vh] p-2 bg-base-100" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-1 pb-2">
              <span className="text-sm font-medium">{title}</span>
              <button className="btn btn-xs btn-ghost" aria-label="Close fullscreen" onClick={() => setExpanded(false)}>
                <X size={12} />
              </button>
            </div>
            <iframe
              ref={fullscreenIframeRef}
              data-testid="raapp-iframe-fullscreen"
              src={src}
              srcDoc={bridgedHtml}
              className="w-full h-[calc(92vh-3.5rem)] rounded border border-base-300 block"
              sandbox={SANDBOX_ATTR}
              title={`${title} fullscreen`}
              onLoad={handleFullscreenLoad}
            />
          </div>
          <div className="modal-backdrop" onClick={() => setExpanded(false)} />
        </dialog>
      )}
    </div>
  );
}
