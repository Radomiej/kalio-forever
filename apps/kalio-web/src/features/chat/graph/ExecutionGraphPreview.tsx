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
      <div data-testid={`graph-node-preview-${node.id}`} className="mt-3 overflow-hidden rounded-2xl border border-white/10 bg-black/15">
        <img src={preview.src} alt={preview.alt} className="h-14 w-full object-cover" />
      </div>
    );
  }

  return (
    <div data-testid={`graph-node-preview-${node.id}`} className="mt-3 rounded-2xl border border-white/10 bg-black/15 px-3 py-2">
      <div className="flex items-center justify-between text-[9px] uppercase tracking-[0.18em] text-white/55">
        <span>Preview</span>
        <span>{preview.block.type}</span>
      </div>
      <div className="mt-2 rounded-xl border border-white/10 bg-white/8 px-2 py-2">
        <div className="flex gap-1">
          <span className="h-1.5 w-1.5 rounded-full bg-rose-200/70" />
          <span className="h-1.5 w-1.5 rounded-full bg-amber-200/70" />
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-200/70" />
        </div>
        <div className="mt-2 space-y-1">
          <div className="h-1.5 w-full rounded-full bg-white/18" />
          <div className="h-1.5 w-4/5 rounded-full bg-white/14" />
          <div className="h-1.5 w-3/5 rounded-full bg-white/12" />
        </div>
      </div>
      <p className="mt-2 text-[10px] leading-4 text-white/70 break-words">{preview.summary}</p>
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