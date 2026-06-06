import type { RAAppBlock, RaAppNativeResult, RaAppPendingApproval } from '@kalio/types';
import { RAAppRenderer } from '../../raapp/RAAppRenderer';
import { extractImageResult, extractRAAppBlock } from '../ToolCallBubble.parsers';
import type { ExecutionGraphNode } from './executionGraphModel';

type GraphNodePreview =
  | {
      kind: 'raapp';
      block: RAAppBlock;
      sessionId?: string;
      summary: string;
    }
  | {
      kind: 'image';
      src: string;
      alt: string;
    };

function previewSummary(value: string): string {
  const stripped = value.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  if (stripped.length > 0) {
    return stripped.slice(0, 72);
  }
  return 'Interactive preview';
}

function normalizeRAAppBlock(data: unknown): RAAppBlock | null {
  const extracted = extractRAAppBlock(data);
  if (extracted) {
    return extracted;
  }

  if (!data || typeof data !== 'object') {
    return null;
  }

  const candidate = data as Record<string, unknown>;
  const type = candidate['type'];
  const vfsPath = typeof candidate['vfsPath'] === 'string' ? candidate['vfsPath'] : undefined;

  if ((type !== 'html' && type !== 'gui') || !vfsPath) {
    return null;
  }

  return {
    type,
    mode: (candidate['mode'] as 'display' | 'interactive') ?? 'display',
    content: typeof candidate['renderedContent'] === 'string'
      ? candidate['renderedContent']
      : typeof candidate['content'] === 'string'
        ? candidate['content']
        : '',
    vfsPath,
    pendingApprovals: Array.isArray(candidate['pendingApprovals'])
      ? candidate['pendingApprovals'] as RaAppPendingApproval[]
      : [],
    nativeResults: Array.isArray(candidate['nativeResults'])
      ? candidate['nativeResults'] as RaAppNativeResult[]
      : [],
  } satisfies RAAppBlock;
}

export function extractGraphNodePreview(node: ExecutionGraphNode): GraphNodePreview | null {
  const data = node.payload.kind === 'tool'
    ? node.payload.result
    : node.payload.kind === 'artifact'
      ? node.payload.artifact.payload
      : null;

  if (data == null) {
    return null;
  }

  const raapp = normalizeRAAppBlock(data);
  if (raapp) {
    return {
      kind: 'raapp',
      block: raapp,
      sessionId: node.sessionId,
      summary: previewSummary(raapp.content || raapp.vfsPath || node.title),
    };
  }

  const image = extractImageResult(data);
  if (image) {
    return {
      kind: 'image',
      src: image.image_url,
      alt: node.title,
    };
  }

  return null;
}

export function GraphNodePreviewThumbnail({ node }: { node: ExecutionGraphNode }) {
  const preview = extractGraphNodePreview(node);
  if (!preview) {
    return null;
  }

  if (preview.kind === 'image') {
    return (
      <div data-testid={`graph-node-preview-${node.id}`} className="mt-2 flex items-center gap-2 rounded border border-white/10 bg-black/18 px-2 py-1.5">
        <span className="h-7 w-9 shrink-0 overflow-hidden rounded border border-white/10 bg-black/25">
          <img src={preview.src} alt={preview.alt} className="h-full w-full object-cover" />
        </span>
        <span className="min-w-0 text-[10px] font-medium leading-3 text-white/70 line-clamp-2">Image preview available</span>
      </div>
    );
  }

  return (
    <div data-testid={`graph-node-preview-${node.id}`} className="mt-2 rounded border border-sky-200/15 bg-sky-400/10 px-2 py-1.5">
      <div className="flex items-center justify-between gap-2 text-[9px] font-semibold uppercase tracking-[0.12em] text-sky-100/70">
        <span>Preview</span>
        <span className="rounded bg-sky-300/15 px-1.5 py-0.5">{preview.block.type}</span>
      </div>
      <p className="mt-1 text-[10px] leading-3 text-white/72 line-clamp-2 break-words">{preview.summary}</p>
    </div>
  );
}

export function ExecutionGraphPreviewPanel({
  node,
  fallbackSessionId,
}: {
  node: ExecutionGraphNode;
  fallbackSessionId?: string | null;
}) {
  const preview = extractGraphNodePreview(node);
  if (!preview) {
    return null;
  }

  return (
    <section data-testid="graph-live-preview" className="rounded-[22px] border border-base-300 bg-base-200/35 px-5 py-4 space-y-3">
      <h4 className="text-xl font-black tracking-tight">Live preview</h4>
      {preview.kind === 'raapp' ? (
        <RAAppRenderer block={preview.block} sessionId={preview.sessionId ?? fallbackSessionId ?? undefined} />
      ) : (
        <div className="overflow-hidden rounded-2xl border border-base-300 bg-base-100/70">
          <img src={preview.src} alt={preview.alt} className="max-h-[18rem] w-full object-contain bg-base-100" />
        </div>
      )}
    </section>
  );
}
