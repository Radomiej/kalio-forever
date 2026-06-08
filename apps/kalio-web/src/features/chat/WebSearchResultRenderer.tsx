import type { WebSearchResultData } from './ToolCallBubble.parsers';

function formatResultCount(count: number): string {
  return `${count} result${count === 1 ? '' : 's'}`;
}

export function WebSearchResultRenderer({ data }: { data: WebSearchResultData }) {
  return (
    <div data-testid="web-search-result-renderer" className="mt-2 space-y-2">
      <div className="flex flex-wrap items-center gap-2 text-[10px] font-mono text-base-content/40">
        <span className="rounded bg-base-200/70 px-1.5 py-0.5 text-base-content/65">
          {data.offline ? 'offline memory' : 'web results'}
        </span>
        <span>{formatResultCount(data.results.length)}</span>
      </div>

      <div className="space-y-2">
        {data.results.map((result) => (
          <div key={`${result.webResultId}:${result.blockIndex}`} className="rounded border border-base-300/60 bg-base-200/40 px-3 py-2">
            <div className="mb-1 flex flex-wrap items-center gap-1.5 text-[10px] font-mono text-base-content/40">
              <span className="rounded bg-base-300/40 px-1.5 py-0.5 text-base-content/55">{result.blockType}</span>
              <span className="rounded bg-base-300/25 px-1.5 py-0.5">{result.provider}</span>
              <span className="rounded bg-base-300/25 px-1.5 py-0.5">{result.model}</span>
              {result.headingPath.length > 0 && (
                <span className="rounded bg-base-300/25 px-1.5 py-0.5">
                  {result.headingPath.join(' > ')}
                </span>
              )}
            </div>
            <div className="whitespace-pre-wrap text-sm text-base-content/80">
              {result.content}
            </div>
            {result.citationUrls.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5 text-[11px] text-sky-600">
                {result.citationUrls.map((url) => (
                  <a
                    key={url}
                    href={url}
                    target="_blank"
                    rel="noreferrer"
                    className="underline underline-offset-2"
                  >
                    {url}
                  </a>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
