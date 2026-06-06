import type { ArchitectNode, ArchitectSchema } from './architect.types';
import { getNodeDimensions } from './ArchitectGraphGeometry';

export const MIN_ZOOM = 0.65;
export const MAX_ZOOM = 1.6;
export const ZOOM_STEP = 0.1;
export const ZOOM_FACTOR = 1.12;
export const DEFAULT_PAN = { x: 0, y: 0 };
export const DEFAULT_ZOOM = 0.82;
export const FIT_PADDING = 72;
export const FREE_SPACE_WIDTH = 2800;
export const FREE_SPACE_HEIGHT = 1800;
export const EMPTY_NODES: ArchitectSchema['nodes'] = [];
export const EMPTY_EDGES: ArchitectSchema['edges'] = [];

export type EdgeKind = 'parallel' | 'routing' | 'forced';

export function clampZoom(value: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Number(value.toFixed(2))));
}

export function nextArchitectZoom(currentZoom: number, direction: 'in' | 'out'): number {
  const nextZoom = direction === 'in'
    ? currentZoom * ZOOM_FACTOR
    : currentZoom / ZOOM_FACTOR;
  return clampZoom(nextZoom);
}

export function connectionPath(source: { x: number; y: number }, target: { x: number; y: number }): string {
  const dx = target.x - source.x;
  const tension = Math.max(48, Math.abs(dx) * 0.4);
  const controlDirection = dx >= 0 ? 1 : -1;
  const cx1 = source.x + tension * controlDirection;
  const cx2 = target.x - tension * controlDirection;
  return `M ${source.x} ${source.y} C ${cx1} ${source.y}, ${cx2} ${target.y}, ${target.x} ${target.y}`;
}

export function edgeKind(sourceNode: ArchitectNode): EdgeKind {
  if (sourceNode.kind === 'parallel' || sourceNode.behavior?.mode === 'fan_out_all') {
    return 'parallel';
  }
  if (sourceNode.kind === 'router' || sourceNode.behavior?.mode === 'choose_one' || sourceNode.behavior?.mode === 'rank_then_merge') {
    return 'routing';
  }
  return 'forced';
}

export function edgeClass(kind: EdgeKind, executed: boolean): string {
  if (executed) {
    return 'stroke-emerald-300/90 animate-pulse';
  }
  if (kind === 'parallel') {
    return 'stroke-violet-300/70';
  }
  if (kind === 'routing') {
    return 'stroke-amber-300/75';
  }
  return 'stroke-sky-500/55';
}

export function edgeHaloClass(kind: EdgeKind, executed: boolean): string {
  if (executed) {
    return 'stroke-emerald-400/20';
  }
  if (kind === 'parallel') {
    return 'stroke-violet-400/16';
  }
  if (kind === 'routing') {
    return 'stroke-amber-400/18';
  }
  return 'stroke-sky-500/15';
}

export function edgeDash(kind: EdgeKind): string | undefined {
  if (kind === 'routing') {
    return '7 5';
  }
  if (kind === 'parallel') {
    return '2 7';
  }
  return undefined;
}

export function edgeWidth(kind: EdgeKind, executed: boolean): string {
  if (executed) {
    return '2.8';
  }
  if (kind === 'parallel') {
    return '2.2';
  }
  if (kind === 'routing') {
    return '2';
  }
  return '1.6';
}

export function fitArchitectGraphViewport({
  nodes,
  viewportHeight,
  viewportWidth,
}: {
  nodes: ArchitectNode[];
  viewportHeight: number;
  viewportWidth: number;
}) {
  if (nodes.length === 0 || viewportWidth <= 0 || viewportHeight <= 0) {
    return {
      pan: DEFAULT_PAN,
      zoom: DEFAULT_ZOOM,
    };
  }

  const bounds = nodes.reduce((current, node) => {
    const dimensions = getNodeDimensions(node);
    return {
      minX: Math.min(current.minX, node.x),
      minY: Math.min(current.minY, node.y),
      maxX: Math.max(current.maxX, node.x + dimensions.width),
      maxY: Math.max(current.maxY, node.y + dimensions.height),
    };
  }, {
    minX: Number.POSITIVE_INFINITY,
    minY: Number.POSITIVE_INFINITY,
    maxX: Number.NEGATIVE_INFINITY,
    maxY: Number.NEGATIVE_INFINITY,
  });
  const graphWidth = Math.max(1, bounds.maxX - bounds.minX);
  const graphHeight = Math.max(1, bounds.maxY - bounds.minY);
  const widthZoom = (viewportWidth - FIT_PADDING * 2) / graphWidth;
  const heightZoom = (viewportHeight - FIT_PADDING * 2) / graphHeight;
  const zoom = clampZoom(Math.min(DEFAULT_ZOOM, widthZoom, heightZoom));

  return {
    pan: {
      x: Math.round((viewportWidth - graphWidth * zoom) / 2 - bounds.minX * zoom),
      y: Math.round((viewportHeight - graphHeight * zoom) / 2 - bounds.minY * zoom),
    },
    zoom,
  };
}

export function architectCanvasStyle({
  cursor,
  pan,
  zoom,
}: {
  cursor: string;
  pan: { x: number; y: number };
  zoom: number;
}) {
  return {
    backgroundImage: [
      'radial-gradient(circle at 72% 18%, rgba(34, 197, 94, 0.12), transparent 34%)',
      'radial-gradient(circle at 28% 70%, rgba(56, 189, 248, 0.10), transparent 32%)',
      'radial-gradient(circle, rgba(148, 163, 184, 0.20) 1px, transparent 1px)',
    ].join(', '),
    backgroundSize: `auto, auto, ${22 * zoom}px ${22 * zoom}px`,
    backgroundPosition: `center, center, ${pan.x}px ${pan.y}px`,
    cursor,
  };
}
