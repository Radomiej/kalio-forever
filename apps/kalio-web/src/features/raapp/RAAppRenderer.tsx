import type { RAAppBlock, RAAppResult } from '@kalio/types';

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

  if (block.type === 'html') {
    const htmlContent = result?.renderedContent ?? block.content;
    return (
      <iframe
        data-testid="raapp-iframe"
        srcDoc={htmlContent}
        className="w-full rounded border border-base-300"
        style={{ minHeight: '200px' }}
        sandbox="allow-scripts allow-same-origin"
        title="RA-App"
      />
    );
  }

  return (
    <div data-testid="raapp-gui" className="rounded border border-base-300 p-3 text-xs">
      {result?.renderedContent ?? block.content}
    </div>
  );
}
