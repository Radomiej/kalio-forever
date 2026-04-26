import type { RAAppBlock, RAAppResult } from '@kalio/types';
import { HtmlIframeRenderer } from './HtmlIframeRenderer';
import { isHtmlString, findHtmlInData, injectEngineCDN } from './raappRendererUtils';
import { GuiDslRenderer, type GuiDslPayload } from './GuiDslRenderer';

interface RAAppRendererProps {
  block: RAAppBlock;
  result?: RAAppResult;
}

export function RAAppRenderer({ block, result }: RAAppRendererProps) {
  if (result?.status === 'error') {
    return (
      <div data-testid="raapp-error" className="alert alert-error py-2 text-xs">
        <span>{result.error?.code}: </span>
        <span>{result.error?.message}</span>
        {result.error?.line !== undefined && <span> (line {result.error.line})</span>}
      </div>
    );
  }

  const content = result?.renderedContent ?? block.content;

  if (block.type === 'html') {
    const html = injectEngineCDN(content, (block as { engine?: string }).engine);
    return <HtmlIframeRenderer html={html} title="RA-App" />;
  }

  if (block.type === 'gui') {
    // Try to parse as GUI DSL payload {nodes, data}
    try {
      const parsed: unknown = typeof content === 'string' ? JSON.parse(content) : content;
      if (
        parsed !== null &&
        typeof parsed === 'object' &&
        'nodes' in parsed &&
        Array.isArray((parsed as GuiDslPayload).nodes)
      ) {
        return <GuiDslRenderer payload={parsed as GuiDslPayload} />;
      }
    } catch {
      // not JSON — fall through
    }

    // Fallback: sniff raw HTML in content
    if (isHtmlString(content)) {
      return <HtmlIframeRenderer html={content} title="RA-App" />;
    }
    try {
      const parsed: unknown = typeof content === 'string' ? JSON.parse(content) : content;
      const sniffed = findHtmlInData(parsed);
      if (sniffed) {
        return <HtmlIframeRenderer html={sniffed} title="RA-App" />;
      }
    } catch {
      // not JSON
    }
  }

  return (
    <div data-testid="raapp-gui" className="rounded border border-base-300 p-3 text-xs whitespace-pre-wrap font-mono">
      {content}
    </div>
  );
}
