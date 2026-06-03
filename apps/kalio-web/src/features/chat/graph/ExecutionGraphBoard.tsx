import { useEffect, useRef, useState, type MouseEvent, type PointerEvent } from 'react';
import {
  type ExecutionGraphModel,
  type ExecutionGraphNode,
} from './executionGraphModel';
import type { GraphCardDensity } from './ExecutionGraphBoard.types';
import { GraphNodePreviewThumbnail, extractGraphNodePreview } from './ExecutionGraphPreview';
import {
  getGraphNodeHeading,
  getGraphNodeMetadataColumnCount,
} from './executionGraphNodePresentation';
import {
  NODE_TEXT_TONES,
  NODE_TONES,
  ROUTER_ROUTE_TONE,
  getMetadataForDensity,
  nodeIcon,
  statusLabel,
  statusTone,
} from './ExecutionGraphBoard.presentation';

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
