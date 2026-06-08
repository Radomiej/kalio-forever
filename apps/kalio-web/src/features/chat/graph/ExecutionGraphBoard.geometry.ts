import type { ExecutionGraphNode } from './executionGraphModel';

export type GraphConnectorDirection = 'input' | 'output';

const FIT_PADDING = 32;
const CONNECTOR_BOUNDS_PADDING = 18;
const MIN_VISIBLE_GRAPH_EDGE = 96;

export function graphNodeBounds(nodes: ExecutionGraphNode[]) {
  if (nodes.length === 0) {
    return null;
  }

  return nodes.reduce(
    (bounds, node) => ({
      minX: Math.min(bounds.minX, node.x),
      minY: Math.min(bounds.minY, node.y),
      maxX: Math.max(bounds.maxX, node.x + node.width),
      maxY: Math.max(bounds.maxY, node.y + node.height),
    }),
    {
      minX: Number.POSITIVE_INFINITY,
      minY: Number.POSITIVE_INFINITY,
      maxX: Number.NEGATIVE_INFINITY,
      maxY: Number.NEGATIVE_INFINITY,
    },
  );
}

export function graphInteractionBounds(nodes: ExecutionGraphNode[]) {
  const bounds = graphNodeBounds(nodes);
  if (!bounds) {
    return null;
  }

  return {
    minX: bounds.minX - CONNECTOR_BOUNDS_PADDING,
    minY: bounds.minY - CONNECTOR_BOUNDS_PADDING,
    maxX: bounds.maxX + CONNECTOR_BOUNDS_PADDING,
    maxY: bounds.maxY + CONNECTOR_BOUNDS_PADDING,
  };
}

export function fitGraphPan({
  nodes,
  viewportHeight,
  viewportWidth,
  zoom,
}: {
  nodes: ExecutionGraphNode[];
  viewportHeight: number;
  viewportWidth: number;
  zoom: number;
}) {
  const bounds = graphInteractionBounds(nodes);
  if (!bounds || viewportWidth <= 0 || viewportHeight <= 0) {
    return { x: 0, y: 0 };
  }

  const graphWidth = (bounds.maxX - bounds.minX) * zoom;
  const graphHeight = (bounds.maxY - bounds.minY) * zoom;
  const freeX = viewportWidth - graphWidth;
  const freeY = viewportHeight - graphHeight;
  const offsetX = freeX > FIT_PADDING * 2 ? freeX / 2 : FIT_PADDING;
  const offsetY = freeY > FIT_PADDING * 2 ? freeY / 2 : FIT_PADDING;

  return {
    x: Math.round(offsetX - bounds.minX * zoom),
    y: Math.round(offsetY - bounds.minY * zoom),
  };
}

export function fitGraphZoom({
  minZoom,
  nodes,
  viewportHeight,
  viewportWidth,
  zoom,
}: {
  minZoom: number;
  nodes: ExecutionGraphNode[];
  viewportHeight: number;
  viewportWidth: number;
  zoom: number;
}) {
  const bounds = graphInteractionBounds(nodes);
  if (!bounds || viewportWidth <= FIT_PADDING * 2 || viewportHeight <= FIT_PADDING * 2) {
    return zoom;
  }

  const graphWidth = bounds.maxX - bounds.minX;
  const graphHeight = bounds.maxY - bounds.minY;
  if (graphWidth <= 0 || graphHeight <= 0) {
    return zoom;
  }

  const widthZoom = (viewportWidth - FIT_PADDING * 2) / graphWidth;
  const heightZoom = (viewportHeight - FIT_PADDING * 2) / graphHeight;
  return Number(Math.max(minZoom, Math.min(zoom, widthZoom, heightZoom)).toFixed(2));
}

export function clampGraphPan({
  nodes,
  pan,
  viewportHeight,
  viewportWidth,
  zoom,
}: {
  nodes: ExecutionGraphNode[];
  pan: { x: number; y: number };
  viewportHeight: number;
  viewportWidth: number;
  zoom: number;
}) {
  const bounds = graphInteractionBounds(nodes);
  if (!bounds || viewportWidth <= 0 || viewportHeight <= 0) {
    return pan;
  }

  const minX = MIN_VISIBLE_GRAPH_EDGE - bounds.maxX * zoom;
  const maxX = viewportWidth - MIN_VISIBLE_GRAPH_EDGE - bounds.minX * zoom;
  const minY = MIN_VISIBLE_GRAPH_EDGE - bounds.maxY * zoom;
  const maxY = viewportHeight - MIN_VISIBLE_GRAPH_EDGE - bounds.minY * zoom;

  return {
    x: Math.round(Math.min(maxX, Math.max(minX, pan.x))),
    y: Math.round(Math.min(maxY, Math.max(minY, pan.y))),
  };
}

export function buildEdgePath(source: ExecutionGraphNode, target: ExecutionGraphNode): string {
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

export function nodeInputPoint(node: ExecutionGraphNode) {
  return { x: node.x, y: node.y + node.height / 2 };
}

export function nodeOutputPoint(node: ExecutionGraphNode) {
  return { x: node.x + node.width, y: node.y + node.height / 2 };
}

export function buildConnectorPreviewPath(
  node: ExecutionGraphNode,
  point: { x: number; y: number },
  direction: GraphConnectorDirection,
): string {
  const start = direction === 'output' ? nodeOutputPoint(node) : point;
  const end = direction === 'output' ? point : nodeInputPoint(node);
  const delta = Math.max(Math.abs(end.x - start.x) / 2, 48);

  return `M ${start.x} ${start.y} C ${start.x + delta} ${start.y}, ${end.x - delta} ${end.y}, ${end.x} ${end.y}`;
}
