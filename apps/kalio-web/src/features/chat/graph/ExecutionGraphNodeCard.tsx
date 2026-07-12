import type { MouseEvent, PointerEvent } from 'react';
import type { ExecutionGraphNode } from './executionGraphModel';
import type { GraphCardDensity } from './ExecutionGraphBoard.types';
import { HelpCircle } from 'lucide-react';
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
} from './ExecutionGraphBoard.presentation';

function isRouterRouteNode(node: ExecutionGraphNode): boolean {
  return node.payload.kind === 'architecture-run' && node.payload.route?.source === 'router';
}

function statusDotClass(status: ExecutionGraphNode['status']): string {
  if (status === 'error') return 'bg-rose-300 shadow-[0_0_8px_rgba(251,113,133,0.55)]';
  if (status === 'waiting') return 'bg-amber-300 shadow-[0_0_8px_rgba(251,191,36,0.58)]';
  if (status === 'running') return 'bg-sky-300 shadow-[0_0_8px_rgba(56,189,248,0.55)]';
  if (status === 'success') return 'bg-emerald-300 shadow-[0_0_8px_rgba(16,185,129,0.45)]';
  return 'bg-base-content/35';
}

export function ExecutionGraphNodeCard({
  cardDensity,
  node,
  connectorDropTargetDirection,
  related,
  selected,
  onSelect,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onPointerCancel,
  onConnectorPointerDown,
  onConnectorPointerMove,
  onConnectorPointerUp,
  onConnectorPointerCancel,
  spacePanning,
  zoom,
}: {
  cardDensity: GraphCardDensity;
  node: ExecutionGraphNode;
  connectorDropTargetDirection?: 'input' | 'output' | null;
  related: boolean;
  selected: boolean;
  onSelect: () => void;
  onPointerDown: (event: PointerEvent<HTMLElement>, node: ExecutionGraphNode) => void;
  onPointerMove: (event: PointerEvent<HTMLElement>) => void;
  onPointerUp: (event: PointerEvent<HTMLElement>) => void;
  onPointerCancel: (event: PointerEvent<HTMLElement>) => void;
  onConnectorPointerDown: (event: PointerEvent<HTMLButtonElement>, node: ExecutionGraphNode, direction: 'input' | 'output') => void;
  onConnectorPointerMove: (event: PointerEvent<HTMLButtonElement>) => void;
  onConnectorPointerUp: (event: PointerEvent<HTMLButtonElement>) => void;
  onConnectorPointerCancel: (event: PointerEvent<HTMLButtonElement>) => void;
  spacePanning: boolean;
  zoom: number;
}) {
  const preview = extractGraphNodePreview(node);
  const { eyebrow, headline, supporting } = getGraphNodeHeading(node);
  const metadata = getMetadataForDensity(node, cardDensity);
  const visibleMetadata = cardDensity === 'compact' ? metadata.slice(0, 1) : metadata;
  const metadataColumns = getGraphNodeMetadataColumnCount(node, visibleMetadata);
  const textTone = NODE_TEXT_TONES[node.kind];
  const nodeTone = isRouterRouteNode(node) ? ROUTER_ROUTE_TONE : NODE_TONES[node.kind];
  const metadataGridClass = metadataColumns === 1 ? 'grid-cols-1' : 'grid-cols-2';
  const isRouterRoute = isRouterRouteNode(node);
  const outputPinClass = isRouterRoute
    ? 'border-amber-100/80 shadow-[0_0_10px_rgba(251,191,36,0.46)]'
    : 'border-emerald-200/70 shadow-[0_0_10px_rgba(16,185,129,0.38)]';
  const outputPinDotClass = isRouterRoute ? 'bg-amber-200' : 'bg-emerald-200';
  const inputDropTarget = connectorDropTargetDirection === 'input';
  const outputDropTarget = connectorDropTargetDirection === 'output';
  const connectorHitboxSize = Math.max(48, Math.round(60 / Math.max(zoom, 0.2)));

  const handleConnectorPointerDown = (event: PointerEvent<HTMLButtonElement>, direction: 'input' | 'output') => {
    onConnectorPointerDown(event, node, direction);
  };
  const handleConnectorClick = (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    onSelect();
  };
  const handleCardPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (spacePanning || event.altKey) {
      return;
    }

    const target = event.target;
    if (target instanceof HTMLElement && target.closest('[data-graph-connector-hitbox="true"], button, a, input, textarea, select')) {
      event.stopPropagation();
      return;
    }

    onPointerDown(event, node);
  };

  return (
    <div
      data-testid={`graph-node-${node.id}`}
      data-session-id={node.sessionId ?? undefined}
      data-graph-node-card="true"
      data-graph-connector-drop-target={connectorDropTargetDirection ?? undefined}
      className={`absolute cursor-grab overflow-visible text-left rounded-md border px-3 py-2.5 shadow-[0_8px_18px_rgba(2,12,27,0.22)] transition-[border-color,background-color,box-shadow,opacity,filter] active:cursor-grabbing ${nodeTone.card} ${selected ? 'ring-2 ring-sky-200/90 shadow-[0_0_0_1px_rgba(125,211,252,0.45),0_12px_24px_rgba(8,47,73,0.28)]' : 'hover:border-white/35 hover:bg-opacity-100'} ${related ? '' : 'opacity-70 saturate-75'}`}
      style={{ left: node.x, top: node.y, width: node.width, height: node.height }}
      onClick={onSelect}
      onPointerDown={handleCardPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      title={`${eyebrow}: ${headline}`}
      aria-label={`${eyebrow}: ${headline}`}
    >
      <span className={`absolute inset-y-0 left-0 w-1 ${nodeTone.accent}`} aria-hidden="true" />
      <span
        className="absolute right-2 top-2 z-10 inline-flex h-5 w-5 items-center justify-center rounded-full border border-white/12 bg-black/40"
        data-testid={`graph-node-status-${node.id}`}
        title={`Status: ${statusLabel(node.status)}`}
        aria-label={`Status: ${statusLabel(node.status)}`}
      >
        <span className={`h-2 w-2 rounded-full ${statusDotClass(node.status)}`} />
      </span>
      <button
        type="button"
        data-testid={isRouterRoute ? `graph-node-router-input-pin-${node.id}` : `graph-node-input-pin-${node.id}`}
        data-graph-connector-hitbox="true"
        data-graph-connector-node-id={node.id}
        data-graph-connector-direction="input"
        className={`group absolute left-0 top-1/2 z-10 flex h-14 w-14 -translate-x-1/2 -translate-y-1/2 cursor-crosshair items-center justify-center rounded-full bg-transparent transition-transform hover:scale-105 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-200 ${inputDropTarget ? 'scale-110 rounded-full ring-2 ring-sky-200/80 ring-offset-2 ring-offset-[#08111f]' : ''}`}
        style={{ height: connectorHitboxSize, width: connectorHitboxSize }}
        title={`${headline} input`}
        aria-label={`Select ${headline} input connector`}
        onClick={handleConnectorClick}
        onPointerDown={(event) => handleConnectorPointerDown(event, 'input')}
        onPointerMove={onConnectorPointerMove}
        onPointerUp={onConnectorPointerUp}
        onPointerCancel={onConnectorPointerCancel}
      >
        <span className={`h-2 w-2 rounded-full border border-sky-200/70 bg-[#08111f] shadow-[0_0_5px_rgba(56,189,248,0.32)] group-hover:h-2.5 group-hover:w-2.5 group-hover:bg-sky-950 ${inputDropTarget ? 'h-2.5 w-2.5 bg-sky-200 shadow-[0_0_12px_rgba(125,211,252,0.8)]' : ''}`} />
      </button>
      <button
        type="button"
        data-testid={isRouterRoute ? `graph-node-router-output-pin-${node.id}` : `graph-node-output-pin-${node.id}`}
        data-graph-connector-hitbox="true"
        data-graph-connector-node-id={node.id}
        data-graph-connector-direction="output"
        className={`group absolute right-0 top-1/2 z-10 flex h-14 w-14 translate-x-1/2 -translate-y-1/2 cursor-crosshair items-center justify-center rounded-full bg-transparent transition-transform hover:scale-105 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-200 ${outputDropTarget ? 'scale-110 rounded-full ring-2 ring-emerald-200/80 ring-offset-2 ring-offset-[#08111f]' : ''}`}
        style={{ height: connectorHitboxSize, width: connectorHitboxSize }}
        title={`${headline} output`}
        aria-label={`Select ${headline} output connector`}
        onClick={handleConnectorClick}
        onPointerDown={(event) => handleConnectorPointerDown(event, 'output')}
        onPointerMove={onConnectorPointerMove}
        onPointerUp={onConnectorPointerUp}
        onPointerCancel={onConnectorPointerCancel}
      >
        <span className={`h-2 w-2 rounded-full border bg-[#08111f] group-hover:h-2.5 group-hover:w-2.5 group-hover:bg-slate-950 ${outputPinClass} ${outputPinDotClass} ${outputDropTarget ? 'h-2.5 w-2.5 shadow-[0_0_12px_rgba(110,231,183,0.85)]' : ''}`} />
      </button>
      <div className="flex items-start gap-2 pl-1 pr-5">
        <div className="min-w-0 flex-1">
          <div
            className={`inline-flex min-h-7 max-w-full cursor-grab items-center gap-1.5 rounded border border-white/10 bg-black/22 px-2 py-1 text-[9px] font-semibold uppercase tracking-[0.08em] active:cursor-grabbing ${textTone.eyebrow}`}
            data-testid={`graph-node-drag-handle-${node.id}`}
            title="Drag node"
            aria-label={`Drag ${headline}`}
            onPointerDown={(event) => onPointerDown(event, node)}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerCancel}
          >
            <span className={nodeTone.icon}>{nodeIcon(node.kind)}</span>
            <span className="min-w-0 whitespace-normal break-words leading-3 line-clamp-2">{eyebrow}</span>
          </div>
          <div className="mt-1.5 flex items-start gap-1.5">
            <p className={`min-w-0 flex-1 text-[13px] font-semibold leading-snug line-clamp-3 break-words ${textTone.headline}`}>{headline}</p>
            {supporting ? (
              <span
                className="tooltip tooltip-left inline-flex h-5 w-5 shrink-0 items-center justify-center rounded border border-white/10 bg-black/28 text-white/45"
                data-tip={supporting}
                aria-label={`Node detail: ${supporting}`}
              >
                <HelpCircle size={11} />
              </span>
            ) : null}
          </div>
        </div>
      </div>

      {cardDensity === 'detailed' && supporting ? (
        <p className={`mt-1.5 pl-1 text-[11px] leading-4 line-clamp-2 break-words ${textTone.supporting}`}>{supporting}</p>
      ) : null}

      {visibleMetadata.length > 0 && (
        <dl className={`mt-1.5 border-t border-white/10 pt-1.5 pl-1 grid ${metadataGridClass} gap-1`}>
          {visibleMetadata.map((item) => {
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
          {cardDensity === 'compact' && metadata.length > visibleMetadata.length ? (
            <div
              className="tooltip tooltip-left rounded border border-white/10 bg-black/18 px-1.5 py-1 text-[10px] font-medium text-white/60"
              data-tip={metadata.slice(visibleMetadata.length).map((item) => `${item.label}: ${item.value}`).join(' | ')}
              aria-label={`More node metadata: ${metadata.slice(visibleMetadata.length).map((item) => `${item.label}: ${item.value}`).join(', ')}`}
            >
              +{metadata.length - visibleMetadata.length}
            </div>
          ) : null}
        </dl>
      )}

      {preview ? (
        <GraphNodePreviewThumbnail node={node} />
      ) : null}
    </div>
  );
}
