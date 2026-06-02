import { useEffect, useRef, useState, type MouseEvent, type PointerEvent } from 'react';
import {
  Bot, Boxes, BrainCircuit, CheckCircle2, FolderTree, MessageSquareText, Wrench,
} from 'lucide-react';
import {
  type ExecutionGraphModel,
  type ExecutionGraphNode,
  type ExecutionGraphNodeKind,
} from './executionGraphModel';
import { GraphNodePreviewThumbnail, extractGraphNodePreview } from './ExecutionGraphPreview';
import {
  type GraphNodeMetadataItem,
  getGraphNodeHeading,
  getGraphNodeMetadata,
  getGraphNodeMetadataColumnCount,
} from './executionGraphNodePresentation';

export type GraphCardDensity = 'compact' | 'detailed';

const NODE_TONES: Record<ExecutionGraphNodeKind, { card: string; accent: string; icon: string }> = {
  prompt: { card: 'border-sky-300/30 bg-[linear-gradient(135deg,rgba(14,165,233,0.14),rgba(15,23,42,0.95)_48%,rgba(6,10,18,0.98))] shadow-[0_16px_40px_-28px_rgba(14,165,233,0.8)]', accent: 'bg-sky-400', icon: 'text-sky-200' },
  turn: { card: 'border-violet-300/30 bg-[linear-gradient(135deg,rgba(139,92,246,0.15),rgba(15,23,42,0.95)_48%,rgba(6,10,18,0.98))] shadow-[0_16px_40px_-28px_rgba(139,92,246,0.82)]', accent: 'bg-violet-400', icon: 'text-violet-200' },
  'tool-group': { card: 'border-emerald-300/30 bg-[linear-gradient(135deg,rgba(16,185,129,0.14),rgba(15,23,42,0.95)_48%,rgba(6,10,18,0.98))] shadow-[0_16px_40px_-28px_rgba(16,185,129,0.78)]', accent: 'bg-emerald-400', icon: 'text-emerald-200' },
  tool: { card: 'border-amber-300/35 bg-[linear-gradient(135deg,rgba(251,191,36,0.16),rgba(15,23,42,0.95)_48%,rgba(6,10,18,0.98))] shadow-[0_16px_40px_-28px_rgba(251,191,36,0.86)]', accent: 'bg-amber-300', icon: 'text-amber-100' },
  subagent: { card: 'border-indigo-300/30 bg-[linear-gradient(135deg,rgba(99,102,241,0.16),rgba(15,23,42,0.95)_48%,rgba(6,10,18,0.98))] shadow-[0_16px_40px_-28px_rgba(99,102,241,0.82)]', accent: 'bg-indigo-300', icon: 'text-indigo-100' },
  'cli-agent': { card: 'border-cyan-300/30 bg-[linear-gradient(135deg,rgba(34,211,238,0.14),rgba(15,23,42,0.95)_48%,rgba(6,10,18,0.98))] shadow-[0_16px_40px_-28px_rgba(34,211,238,0.78)]', accent: 'bg-cyan-300', icon: 'text-cyan-100' },
  'agent-flow': { card: 'border-teal-300/30 bg-[linear-gradient(135deg,rgba(45,212,191,0.13),rgba(15,23,42,0.95)_48%,rgba(6,10,18,0.98))] shadow-[0_16px_40px_-28px_rgba(45,212,191,0.72)]', accent: 'bg-teal-300', icon: 'text-teal-100' },
  'tool-result': { card: 'border-rose-300/30 bg-[linear-gradient(135deg,rgba(251,113,133,0.14),rgba(15,23,42,0.95)_48%,rgba(6,10,18,0.98))] shadow-[0_16px_40px_-28px_rgba(251,113,133,0.75)]', accent: 'bg-rose-300', icon: 'text-rose-100' },
  'architecture-run': { card: 'border-blue-300/30 bg-[linear-gradient(135deg,rgba(59,130,246,0.14),rgba(15,23,42,0.95)_48%,rgba(6,10,18,0.98))] shadow-[0_16px_40px_-28px_rgba(59,130,246,0.78)]', accent: 'bg-blue-300', icon: 'text-blue-100' },
  artifact: { card: 'border-slate-300/30 bg-[linear-gradient(135deg,rgba(148,163,184,0.13),rgba(15,23,42,0.95)_48%,rgba(6,10,18,0.98))] shadow-[0_16px_40px_-28px_rgba(148,163,184,0.62)]', accent: 'bg-slate-300', icon: 'text-slate-100' },
  'final-answer': { card: 'border-emerald-300/35 bg-[linear-gradient(135deg,rgba(52,211,153,0.16),rgba(15,23,42,0.95)_48%,rgba(6,10,18,0.98))] shadow-[0_16px_40px_-28px_rgba(52,211,153,0.86)]', accent: 'bg-emerald-300', icon: 'text-emerald-100' },
};

const ROUTER_ROUTE_TONE = {
  card: 'border-amber-300/35 bg-[linear-gradient(135deg,rgba(251,191,36,0.18),rgba(15,23,42,0.95)_46%,rgba(6,10,18,0.98))] shadow-[0_16px_40px_-28px_rgba(251,191,36,0.9)]',
  accent: 'bg-amber-300',
  icon: 'text-amber-100',
};

const NODE_TEXT_TONES: Record<ExecutionGraphNodeKind, {
  eyebrow: string;
  headline: string;
  supporting: string;
  accentLabel: string;
  accentValue: string;
}> = {
  prompt: {
    eyebrow: 'text-sky-50/90',
    headline: 'text-white',
    supporting: 'text-sky-50/78',
    accentLabel: 'text-sky-100/72',
    accentValue: 'text-sky-50',
  },
  turn: {
    eyebrow: 'text-violet-50/90',
    headline: 'text-fuchsia-50',
    supporting: 'text-violet-50/78',
    accentLabel: 'text-violet-100/72',
    accentValue: 'text-fuchsia-50',
  },
  'tool-group': {
    eyebrow: 'text-emerald-50/90',
    headline: 'text-emerald-50',
    supporting: 'text-emerald-50/76',
    accentLabel: 'text-emerald-100/72',
    accentValue: 'text-emerald-50',
  },
  tool: {
    eyebrow: 'text-amber-50/90',
    headline: 'text-amber-50',
    supporting: 'text-amber-50/76',
    accentLabel: 'text-amber-100/72',
    accentValue: 'text-amber-50',
  },
  subagent: {
    eyebrow: 'text-indigo-50/90',
    headline: 'text-indigo-50',
    supporting: 'text-indigo-50/78',
    accentLabel: 'text-indigo-100/72',
    accentValue: 'text-indigo-50',
  },
  'cli-agent': {
    eyebrow: 'text-cyan-50/90',
    headline: 'text-cyan-50',
    supporting: 'text-cyan-50/78',
    accentLabel: 'text-cyan-100/72',
    accentValue: 'text-cyan-50',
  },
  'agent-flow': {
    eyebrow: 'text-teal-50/90',
    headline: 'text-teal-50',
    supporting: 'text-teal-50/78',
    accentLabel: 'text-teal-100/72',
    accentValue: 'text-teal-50',
  },
  'tool-result': {
    eyebrow: 'text-rose-50/90',
    headline: 'text-rose-50',
    supporting: 'text-rose-50/78',
    accentLabel: 'text-rose-100/72',
    accentValue: 'text-rose-50',
  },
  'architecture-run': {
    eyebrow: 'text-blue-50/90',
    headline: 'text-cyan-50',
    supporting: 'text-blue-50/78',
    accentLabel: 'text-cyan-100/72',
    accentValue: 'text-cyan-50',
  },
  artifact: {
    eyebrow: 'text-slate-50/90',
    headline: 'text-slate-50',
    supporting: 'text-slate-50/76',
    accentLabel: 'text-slate-100/72',
    accentValue: 'text-slate-50',
  },
  'final-answer': {
    eyebrow: 'text-emerald-50/92',
    headline: 'text-emerald-50',
    supporting: 'text-emerald-50/78',
    accentLabel: 'text-emerald-100/74',
    accentValue: 'text-emerald-50',
  },
};

function nodeIcon(kind: ExecutionGraphNodeKind) {
  switch (kind) {
    case 'prompt':
      return <MessageSquareText size={16} />;
    case 'turn':
      return <Bot size={16} />;
    case 'tool-group':
      return <Boxes size={16} />;
    case 'tool':
      return <Wrench size={16} />;
    case 'subagent':
      return <BrainCircuit size={16} />;
    case 'cli-agent':
      return <BrainCircuit size={16} />;
    case 'agent-flow':
      return <FolderTree size={16} />;
    case 'tool-result':
      return <Wrench size={16} />;
    case 'architecture-run':
      return <FolderTree size={16} />;
    case 'artifact':
      return <FolderTree size={16} />;
    case 'final-answer':
      return <CheckCircle2 size={16} />;
  }
}

function statusTone(status: ExecutionGraphNode['status']): string {
  if (status === 'error') return 'text-rose-200';
  if (status === 'running') return 'text-amber-100';
  if (status === 'success') return 'text-emerald-100';
  return 'text-slate-200';
}

function statusLabel(status: ExecutionGraphNode['status']): string {
  if (status === 'error') return 'error';
  if (status === 'running') return 'running';
  if (status === 'success') return 'ready';
  return 'idle';
}

function isRouterRouteNode(node: ExecutionGraphNode): boolean {
  return node.payload.kind === 'architecture-run' && node.payload.route?.source === 'router';
}

function buildEdgePath(source: ExecutionGraphNode, target: ExecutionGraphNode): string {
  const targetIsToolBranch = target.kind === 'tool' || target.kind === 'tool-group';

  if (targetIsToolBranch && target.y >= source.y) {
    const startX = source.x + source.width / 2;
    const startY = source.y + source.height;
    const endX = target.x + target.width / 2;
    const endY = target.y;
    const delta = Math.max((endY - startY) / 2, 40);

    return `M ${startX} ${startY} C ${startX} ${startY + delta}, ${endX} ${endY - delta}, ${endX} ${endY}`;
  }

  const startX = source.x + source.width;
  const startY = source.y + source.height / 2;
  const endX = target.x;
  const endY = target.y + target.height / 2;
  const delta = Math.max((endX - startX) / 2, 40);

  return `M ${startX} ${startY} C ${startX + delta} ${startY}, ${endX - delta} ${endY}, ${endX} ${endY}`;
}

function GraphNodeCard({
  cardDensity,
  node,
  selected,
  onSelect,
}: {
  cardDensity: GraphCardDensity;
  node: ExecutionGraphNode;
  selected: boolean;
  onSelect: () => void;
}) {
  const preview = extractGraphNodePreview(node);
  const { eyebrow, headline, supporting } = getGraphNodeHeading(node);
  const metadata = getMetadataForDensity(node, cardDensity);
  const metadataColumns = getGraphNodeMetadataColumnCount(node, metadata);
  const textTone = NODE_TEXT_TONES[node.kind];
  const nodeTone = isRouterRouteNode(node) ? ROUTER_ROUTE_TONE : NODE_TONES[node.kind];
  const metadataGridClass = metadataColumns === 1 ? 'grid-cols-1' : 'grid-cols-2';
  const isRouterRoute = isRouterRouteNode(node);
  const outputPinClass = isRouterRoute
    ? 'border-amber-100/80 shadow-[0_0_10px_rgba(251,191,36,0.46)]'
    : 'border-emerald-200/70 shadow-[0_0_10px_rgba(16,185,129,0.38)]';
  const outputPinDotClass = isRouterRoute ? 'bg-amber-200' : 'bg-emerald-200';

  return (
    <button
      type="button"
      data-testid={`graph-node-${node.id}`}
      data-graph-node-card="true"
      className={`absolute overflow-hidden text-left rounded-md border px-2.5 py-2 shadow-[0_8px_18px_rgba(2,12,27,0.22)] transition-colors ${nodeTone.card} ${selected ? 'ring-2 ring-sky-200/90 shadow-[0_0_0_1px_rgba(125,211,252,0.45),0_12px_24px_rgba(8,47,73,0.28)]' : 'hover:border-white/35 hover:bg-opacity-100'}`}
      style={{ left: node.x, top: node.y, width: node.width, height: node.height }}
      onClick={onSelect}
      title={`${eyebrow}: ${headline}`}
    >
      <span className={`absolute inset-y-0 left-0 w-1 ${nodeTone.accent}`} aria-hidden="true" />
      <span
        data-testid={isRouterRoute ? `graph-node-router-input-pin-${node.id}` : `graph-node-input-pin-${node.id}`}
        className="absolute left-0 top-1/2 z-10 flex h-4 w-4 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-sky-200/70 bg-[#08111f] shadow-[0_0_10px_rgba(56,189,248,0.4)]"
        title={`${headline} input`}
        aria-hidden="true"
      >
        <span className="h-1.5 w-1.5 rounded-full bg-sky-200" />
      </span>
      <span
        data-testid={isRouterRoute ? `graph-node-router-output-pin-${node.id}` : `graph-node-output-pin-${node.id}`}
        className={`absolute right-0 top-1/2 z-10 flex h-4 w-4 translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border bg-[#08111f] ${outputPinClass}`}
        title={`${headline} output`}
        aria-hidden="true"
      >
        <span className={`h-1.5 w-1.5 rounded-full ${outputPinDotClass}`} />
      </span>
      <div className="flex items-start justify-between gap-2 pl-1">
        <div className="min-w-0 flex-1">
          <div className={`inline-flex max-w-full items-center gap-1.5 rounded border border-white/10 bg-black/22 px-1.5 py-0.5 text-[8px] font-semibold uppercase tracking-[0.08em] ${statusTone(node.status)} ${textTone.eyebrow}`}>
            <span className={nodeTone.icon}>
            {nodeIcon(node.kind)}
            </span>
            <span className="truncate">{eyebrow}</span>
          </div>
          <p className={`mt-1.5 text-[12px] font-semibold leading-snug line-clamp-3 break-words ${textTone.headline}`}>{headline}</p>
        </div>
        <span className="shrink-0 rounded border border-white/12 bg-black/22 px-1.5 py-0.5 text-[8px] uppercase tracking-[0.08em] text-white/80">
          {statusLabel(node.status)}
        </span>
      </div>

      {supporting ? (
        <p className={`mt-1.5 pl-1 text-[10px] leading-4 line-clamp-3 break-words ${textTone.supporting}`}>{supporting}</p>
      ) : null}

      {metadata.length > 0 && (
        <dl className={`mt-1.5 border-t border-white/10 pt-1.5 pl-1 grid ${metadataGridClass} gap-1`}>
          {metadata.map((item) => {
            const toneClass = item.tone === 'warning'
              ? 'border-amber-200/22 bg-amber-500/10'
              : item.tone === 'accent'
                ? 'border-white/12 bg-white/10'
                : 'border-white/10 bg-black/18';
            const labelClass = item.tone === 'warning'
              ? 'text-amber-100/80'
              : item.tone === 'accent'
                ? textTone.accentLabel
                : 'text-white/52';
            const valueClass = item.tone === 'warning'
              ? 'text-amber-50'
              : item.tone === 'accent'
                ? textTone.accentValue
                : 'text-white/90';

            return (
              <div key={`${item.label}:${item.value}`} className={`rounded border px-1.5 py-1 ${toneClass}`}>
                <dt className={`text-[8px] uppercase tracking-[0.08em] ${labelClass}`}>{item.label}</dt>
                <dd className={`mt-0.5 text-[10px] font-medium leading-3 break-words line-clamp-2 ${valueClass}`}>{item.value}</dd>
              </div>
            );
          })}
        </dl>
      )}

      {preview ? (
        <GraphNodePreviewThumbnail node={node} />
      ) : null}
    </button>
  );
}

function getMetadataForDensity(node: ExecutionGraphNode, cardDensity: GraphCardDensity): GraphNodeMetadataItem[] {
  const metadata = getGraphNodeMetadata(node);
  if (cardDensity === 'detailed') {
    return metadata;
  }

  if (node.kind === 'tool' || node.kind === 'tool-group' || node.kind === 'tool-result') {
    return [];
  }

  if (node.kind === 'turn') {
    return metadata.filter((item) => item.label === 'Agent' || item.label === 'Tools').slice(0, 2);
  }

  if (node.kind === 'subagent' || node.kind === 'cli-agent') {
    return metadata.filter((item) => item.label === 'Level' || item.label === 'Persona' || item.label === 'Agent').slice(0, 2);
  }

  if (node.kind === 'architecture-run') {
    return metadata.filter((item) => item.label === 'Schema').slice(0, 1);
  }

  return metadata.slice(0, 1);
}

interface ExecutionGraphBoardProps {
  cardDensity?: GraphCardDensity;
  model: ExecutionGraphModel;
  selectedNodeId: string | null;
  onSelectNode: (nodeId: string) => void;
  zoom: number;
  onWheelZoom?: (deltaY: number) => void;
}

export function ExecutionGraphBoard({
  cardDensity = 'compact',
  model,
  selectedNodeId,
  onSelectNode,
  zoom,
  onWheelZoom,
}: ExecutionGraphBoardProps) {
  const dragStateRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    panX: number;
    panY: number;
  } | null>(null);
  const [dragging, setDragging] = useState(false);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const scaledBoardWidth = model.board.width * zoom;
  const scaledBoardHeight = model.board.height * zoom;

  const updatePan = (clientX: number, clientY: number) => {
    const dragState = dragStateRef.current;
    if (!dragState) {
      return;
    }

    setPan({
      x: dragState.panX + (clientX - dragState.startX),
      y: dragState.panY + (clientY - dragState.startY),
    });
  };

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) {
      return;
    }

    const target = event.target;
    if (target instanceof HTMLElement && target.closest('[data-graph-node-card="true"]')) {
      return;
    }

    event.currentTarget.setPointerCapture(event.pointerId);
    dragStateRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      panX: pan.x,
      panY: pan.y,
    };
    setDragging(true);
  };

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    updatePan(event.clientX, event.clientY);
  };

  const stopDragging = (event: PointerEvent<HTMLDivElement>) => {
    if (dragStateRef.current && event.currentTarget.hasPointerCapture(dragStateRef.current.pointerId)) {
      event.currentTarget.releasePointerCapture(dragStateRef.current.pointerId);
    }
    dragStateRef.current = null;
    setDragging(false);
  };

  const handleMouseDown = (event: MouseEvent<HTMLDivElement>) => {
    if (event.button !== 0) {
      return;
    }

    const target = event.target;
    if (target instanceof HTMLElement && target.closest('[data-graph-node-card="true"]')) {
      return;
    }

    dragStateRef.current = {
      pointerId: -1,
      startX: event.clientX,
      startY: event.clientY,
      panX: pan.x,
      panY: pan.y,
    };
    setDragging(true);
  };

  const handleMouseMove = (event: MouseEvent<HTMLDivElement>) => {
    updatePan(event.clientX, event.clientY);
  };

  const stopMouseDragging = () => {
    dragStateRef.current = null;
    setDragging(false);
  };

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport || !onWheelZoom) {
      return undefined;
    }

    const handleWheel = (event: WheelEvent) => {
      event.preventDefault();
      onWheelZoom(event.deltaY);
    };

    viewport.addEventListener('wheel', handleWheel, { passive: false });
    return () => viewport.removeEventListener('wheel', handleWheel);
  }, [onWheelZoom]);

  return (
    <div
      ref={viewportRef}
      data-testid="execution-graph-viewport"
      className={`min-h-[320px] flex-1 overflow-hidden overscroll-none select-none touch-none bg-[linear-gradient(rgba(56,189,248,0.055)_1px,_transparent_1px),linear-gradient(90deg,_rgba(56,189,248,0.055)_1px,_transparent_1px)] bg-[length:40px_40px] bg-[#08111f] xl:min-h-0 ${dragging ? 'cursor-grabbing' : 'cursor-grab'}`}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={stopDragging}
      onPointerCancel={stopDragging}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={stopMouseDragging}
      onMouseLeave={stopMouseDragging}
    >
      <div
        className="relative min-w-full min-h-full"
        style={{
          width: Math.max(scaledBoardWidth, 1),
          height: Math.max(scaledBoardHeight, 1),
        }}
      >
        <div
          data-testid="execution-graph-stage"
          className="relative origin-top-left will-change-transform"
          style={{
            width: scaledBoardWidth,
            height: scaledBoardHeight,
            transform: `translate(${pan.x}px, ${pan.y}px)`,
          }}
        >
          <div
            className="relative origin-top-left"
            style={{ width: model.board.width, height: model.board.height, transform: `scale(${zoom})` }}
          >
            <svg className="absolute inset-0 overflow-visible" width={model.board.width} height={model.board.height} aria-hidden="true">
              <defs>
                <marker id="graph-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                  <path d="M 0 0 L 10 5 L 0 10 z" fill="rgba(125, 211, 252, 0.78)" />
                </marker>
              </defs>
              {model.edges.map((edge) => {
                const source = model.nodes.find((node) => node.id === edge.sourceId);
                const target = model.nodes.find((node) => node.id === edge.targetId);
                if (!source || !target) return null;
                const path = buildEdgePath(source, target);

                return (
                  <path
                    key={edge.id}
                    data-testid={`graph-edge-${edge.id}`}
                    d={path}
                    fill="none"
                    markerEnd="url(#graph-arrow)"
                    stroke={edge.style === 'dashed' ? 'rgba(148,163,184,0.45)' : 'rgba(125,211,252,0.72)'}
                    strokeDasharray={edge.style === 'dashed' ? '7 8' : undefined}
                    strokeWidth={edge.style === 'dashed' ? 2 : 3}
                  />
                );
              })}
            </svg>

            {model.nodes.map((node) => (
            <GraphNodeCard
              cardDensity={cardDensity}
              key={node.id}
                node={node}
                selected={node.id === selectedNodeId}
                onSelect={() => onSelectNode(node.id)}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
