import { useEffect, useRef, useState, useCallback } from 'react';
import { Download } from 'lucide-react';
import { nanoid } from 'nanoid';
import { useSessionStore } from '../../store/sessionStore';
import { eventBus } from '../../services/eventBus';
import type { ChatMessage } from '@kalio/types';

interface HtmlIframeRendererProps {
  html: string;
  title?: string;
  minHeight?: number;
}

export function HtmlIframeRenderer({ html, title = 'App', minHeight = 200 }: HtmlIframeRendererProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(minHeight);

  const handleMessage = useCallback(
    (event: MessageEvent) => {
      if (!iframeRef.current || event.source !== iframeRef.current.contentWindow) return;
      const data = event.data;

      if (data?.type === 'raapp_resize' && typeof data.height === 'number') {
        setHeight(Math.max(minHeight, data.height + 16));
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
    [minHeight],
  );

  useEffect(() => {
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [handleMessage]);

  const handleLoad = () => {
    // Ask iframe to report its scroll height via postMessage
    iframeRef.current?.contentWindow?.postMessage({ type: 'raapp_query_height' }, '*');
    // Fallback: try to read scrollHeight directly (works when sandbox allows same-origin)
    try {
      const doc = iframeRef.current?.contentDocument;
      if (doc) {
        const h = doc.documentElement.scrollHeight || doc.body?.scrollHeight;
        if (h && h > minHeight) setHeight(h + 16);
      }
    } catch {
      // cross-origin sandbox — ignore
    }
  };

  const downloadHtml = () => {
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
      <button
        onClick={downloadHtml}
        className="absolute top-2 right-2 z-10 btn btn-xs btn-ghost opacity-0 group-hover:opacity-100 transition-opacity bg-base-100/80"
        title="Download HTML"
        aria-label="Download HTML"
      >
        <Download size={12} />
      </button>
      <iframe
        ref={iframeRef}
        data-testid="raapp-iframe"
        srcDoc={html}
        className="w-full rounded border border-base-300 block"
        style={{ height: `${height}px`, minHeight: `${minHeight}px` }}
        sandbox="allow-scripts allow-same-origin"
        title={title}
        onLoad={handleLoad}
      />
    </div>
  );
}
