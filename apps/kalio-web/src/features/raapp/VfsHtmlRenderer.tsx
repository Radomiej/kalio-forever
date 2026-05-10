import { getSessionVfsServeUrl } from '../../services/apiClient';
import { HtmlIframeRenderer } from './HtmlIframeRenderer';

interface VfsHtmlRendererProps {
  sessionId: string;
  vfsPath: string;
  title?: string;
  minHeight?: number;
}

export function VfsHtmlRenderer({ sessionId, vfsPath, title = 'App', minHeight = 200 }: VfsHtmlRendererProps) {
  return <HtmlIframeRenderer src={getSessionVfsServeUrl(sessionId, vfsPath)} title={title} minHeight={minHeight} />;
}