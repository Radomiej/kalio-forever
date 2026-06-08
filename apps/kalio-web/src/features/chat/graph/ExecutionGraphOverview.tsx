import type { PointerEvent } from 'react';
import type { ExecutionGraphNode } from './executionGraphModel';
import { graphInteractionBounds } from './ExecutionGraphBoard.geometry';

const OVERVIEW_WIDTH = 176;
const OVERVIEW_HEIGHT = 104;
const OVERVIEW_PADDING = 8;

type GraphOverviewModel = {
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
  height: number;
  nodeRects: Array<{ id: string; x: number; y: number; width: number; height: number }>;
  scale: number;
  viewportRect: { x: number; y: number; width: number; height: number };
  width: number;
};

export function buildExecutionGraphOverviewModel({
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
}): GraphOverviewModel | null {
  const bounds = graphInteractionBounds(nodes);
  if (!bounds || viewportWidth <= 0 || viewportHeight <= 0 || zoom <= 0) {
    return null;
  }

  const graphWidth = Math.max(bounds.maxX - bounds.minX, 1);
  const graphHeight = Math.max(bounds.maxY - bounds.minY, 1);
  const scale = Math.min(
    (OVERVIEW_WIDTH - OVERVIEW_PADDING * 2) / graphWidth,
    (OVERVIEW_HEIGHT - OVERVIEW_PADDING * 2) / graphHeight,
  );
  const originX = OVERVIEW_PADDING - bounds.minX * scale;
  const originY = OVERVIEW_PADDING - bounds.minY * scale;
  const viewWorldX = -pan.x / zoom;
  const viewWorldY = -pan.y / zoom;
  const viewWorldWidth = viewportWidth / zoom;
  const viewWorldHeight = viewportHeight / zoom;

  return {
    bounds,
    height: OVERVIEW_HEIGHT,
    nodeRects: nodes.map((node) => ({
      id: node.id,
      x: originX + node.x * scale,
      y: originY + node.y * scale,
      width: Math.max(node.width * scale, 2),
      height: Math.max(node.height * scale, 2),
    })),
    scale,
    viewportRect: {
      x: originX + viewWorldX * scale,
      y: originY + viewWorldY * scale,
      width: Math.max(viewWorldWidth * scale, 6),
      height: Math.max(viewWorldHeight * scale, 6),
    },
    width: OVERVIEW_WIDTH,
  };
}

export function ExecutionGraphOverview({
  nodes,
  onCenter,
  pan,
  viewportHeight,
  viewportWidth,
  zoom,
}: {
  nodes: ExecutionGraphNode[];
  onCenter: (worldPoint: { x: number; y: number }) => void;
  pan: { x: number; y: number };
  viewportHeight: number;
  viewportWidth: number;
  zoom: number;
}) {
  const model = buildExecutionGraphOverviewModel({ nodes, pan, viewportHeight, viewportWidth, zoom });
  if (!model) {
    return null;
  }

  const centerFromPointer = (event: PointerEvent<SVGSVGElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    onCenter({
      x: model.bounds.minX + (x - OVERVIEW_PADDING) / model.scale,
      y: model.bounds.minY + (y - OVERVIEW_PADDING) / model.scale,
    });
  };

  return (
    <div
      className="absolute bottom-3 right-3 z-30 rounded-lg border border-sky-300/20 bg-[#07111f]/88 p-2 shadow-[0_14px_34px_rgba(2,12,27,0.35)] backdrop-blur"
      data-testid="execution-graph-overview"
    >
      <svg
        aria-label="Graph overview"
        className="block cursor-crosshair"
        data-testid="execution-graph-overview-svg"
        height={model.height}
        onPointerDown={(event) => {
          event.preventDefault();
          event.stopPropagation();
          centerFromPointer(event);
        }}
        onPointerMove={(event) => {
          if (event.buttons !== 1) {
            return;
          }
          event.preventDefault();
          event.stopPropagation();
          centerFromPointer(event);
        }}
        role="img"
        width={model.width}
      >
        <rect width={model.width} height={model.height} rx={7} fill="rgba(8,17,31,0.88)" />
        {model.nodeRects.map((node) => (
          <rect
            key={node.id}
            x={node.x}
            y={node.y}
            width={node.width}
            height={node.height}
            rx={2}
            fill="rgba(125,211,252,0.34)"
          />
        ))}
        <rect
          data-testid="execution-graph-overview-viewport"
          x={model.viewportRect.x}
          y={model.viewportRect.y}
          width={model.viewportRect.width}
          height={model.viewportRect.height}
          rx={4}
          fill="rgba(14,165,233,0.16)"
          stroke="rgba(186,230,253,0.9)"
          strokeWidth={1.5}
        />
      </svg>
    </div>
  );
}
