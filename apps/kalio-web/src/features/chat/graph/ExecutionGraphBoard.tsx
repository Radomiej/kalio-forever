import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  type ExecutionGraphModel,
  type ExecutionGraphNode,
} from './executionGraphModel';
import { GraphSvgLayer } from '../../graph/GraphSvgLayer';
import { GraphWorldLayer } from '../../graph/GraphWorldLayer';
import { graphViewportCenter, graphViewportClassName, graphViewportPointFromClient, nextGraphPanForAutoPan, nextGraphPanForZoom, useGraphViewport, useGraphWheelListener, useSpacePanning } from '../../graph/useGraphInteraction';
import { useGraphConnectorDragController } from '../../graph/controllers/useGraphConnectorDragController';
import { useGraphNodeDragController } from '../../graph/controllers/useGraphNodeDragController';
import { useGraphPanController } from '../../graph/controllers/useGraphPanController';
import type { GraphCardDensity } from './ExecutionGraphBoard.types';
import { ExecutionGraphNodeCard } from './ExecutionGraphNodeCard';
import { ExecutionGraphOverview } from './ExecutionGraphOverview';
import {
  buildConnectorPreviewPath,
  buildEdgePath,
  clampGraphPan,
  fitGraphPan,
  fitGraphZoom,
  type GraphConnectorDirection,
} from './ExecutionGraphBoard.geometry';

interface ExecutionGraphBoardProps {
  cardDensity?: GraphCardDensity;
  model: ExecutionGraphModel;
  resetViewportToken?: number;
  selectedNodeId: string | null;
  onSelectNode: (nodeId: string) => void;
  zoom: number;
  onFitZoom?: (zoom: number) => void;
  onWheelZoom?: (deltaY: number) => number;
}

const READABLE_AUTO_FIT_MIN_ZOOM = 0.58;

type ExecutionConnectorDragState = {
  sourceNodeId: string;
  direction: GraphConnectorDirection;
  moved: boolean;
  pointerId: number;
  startX: number;
  startY: number;
};

export function ExecutionGraphBoard({
  cardDensity = 'compact',
  model,
  resetViewportToken = 0,
  selectedNodeId,
  onSelectNode,
  zoom,
  onFitZoom,
  onWheelZoom,
}: ExecutionGraphBoardProps) {
  const fittedModelRef = useRef<string | null>(null);
  const previousZoomRef = useRef(zoom);
  const anchoredWheelZoomRef = useRef<number | null>(null);
  const spacePanning = useSpacePanning();
  const {
    clientToWorld,
    pan,
    setPan,
    setZoom,
  } = useGraphViewport({ initialPan: { x: 0, y: 0 }, initialZoom: zoom });
  const [nodePositionOverrides, setNodePositionOverrides] = useState<Record<string, { x: number; y: number }>>({});
  const [viewportSize, setViewportSize] = useState({ height: 0, width: 0 });
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const effectiveNodes = useMemo(
    () => model.nodes.map((node) => {
      const override = nodePositionOverrides[node.id];
      return override ? { ...node, x: override.x, y: override.y } : node;
    }),
    [model.nodes, nodePositionOverrides],
  );
  const nodeById = useMemo(
    () => new Map(effectiveNodes.map((node) => [node.id, node])),
    [effectiveNodes],
  );
  const relatedNodeIds = useMemo(() => {
    if (!selectedNodeId) {
      return null;
    }
    const ids = new Set([selectedNodeId]);
    model.edges.forEach((edge) => {
      if (edge.sourceId === selectedNodeId) ids.add(edge.targetId);
      if (edge.targetId === selectedNodeId) ids.add(edge.sourceId);
    });
    return ids;
  }, [model.edges, selectedNodeId]);
  const relatedEdgeIds = useMemo(() => {
    if (!selectedNodeId) {
      return null;
    }
    return new Set(model.edges
      .filter((edge) => edge.sourceId === selectedNodeId || edge.targetId === selectedNodeId)
      .map((edge) => edge.id));
  }, [model.edges, selectedNodeId]);
  const scaledBoardWidth = model.board.width * zoom;
  const scaledBoardHeight = model.board.height * zoom;

  const clampPanToViewport = useCallback((nextPan: { x: number; y: number }, nextZoom = zoom) => {
    const viewport = viewportRef.current;
    if (!viewport) {
      return nextPan;
    }
    const bounds = viewport.getBoundingClientRect();
    return clampGraphPan({
      nodes: effectiveNodes,
      pan: nextPan,
      viewportHeight: bounds.height,
      viewportWidth: bounds.width,
      zoom: nextZoom,
    });
  }, [effectiveNodes, zoom]);

  const panController = useGraphPanController({
    pan,
    setPan: (next) => {
      if (typeof next === 'function') {
        setPan((current) => clampPanToViewport(next(current)));
        return;
      }
      setPan(clampPanToViewport(next));
    },
    spacePanning,
    blockedSelector: '[data-graph-node-card="true"], [data-graph-edge-hitbox="true"]',
    useMouseFallback: true,
  });

  const graphPointFromClient = useCallback((clientX: number, clientY: number) => {
    const viewport = viewportRef.current;
    if (!viewport) {
      return null;
    }
    const bounds = viewport.getBoundingClientRect();
    return clientToWorld(bounds, clientX, clientY);
  }, [clientToWorld]);

  const nodeDrag = useGraphNodeDragController<ExecutionGraphNode>({
    zoom,
    spacePanning,
    adapter: {
      getNodeOrigin: (node) => ({ x: node.x, y: node.y }),
      commitPosition: (nodeId, position) => {
        setNodePositionOverrides((current) => ({
          ...current,
          [nodeId]: {
            x: Math.round(position.x),
            y: Math.round(position.y),
          },
        }));
      },
    },
  });

  const connectorTargetFromClient = useCallback((
    clientX: number,
    clientY: number,
    dragState: { direction: GraphConnectorDirection; sourceNodeId: string },
  ) => {
    if (typeof document.elementFromPoint !== 'function') {
      return null;
    }

    const element = document.elementFromPoint(clientX, clientY);
    const pin = element instanceof HTMLElement
      ? element.closest<HTMLElement>('[data-graph-connector-hitbox="true"]')
      : null;
    const targetNodeId = pin?.dataset.graphConnectorNodeId ?? null;
    const targetDirection = pin?.dataset.graphConnectorDirection;
    const requiredDirection = dragState.direction === 'output' ? 'input' : 'output';

    if (!targetNodeId || targetNodeId === dragState.sourceNodeId || targetDirection !== requiredDirection) {
      return null;
    }

    return targetNodeId;
  }, []);

  const connectorDrag = useGraphConnectorDragController<ExecutionConnectorDragState>({
    createDragState: (event, meta) => ({
      ...meta,
      moved: false,
      pointerId: event.pointerId ?? 0,
      startX: event.clientX,
      startY: event.clientY,
    }),
    adapter: {
      resolveDropTarget: (clientX, clientY, state) => connectorTargetFromClient(clientX, clientY, state),
      onCommit: (_sourceNodeId, targetNodeId, moved) => {
        if (moved && targetNodeId) {
          onSelectNode(targetNodeId);
        }
      },
      applyAutoPan: (clientX, clientY) => {
        const bounds = viewportRef.current?.getBoundingClientRect();
        if (bounds) {
          setPan((currentPan) => clampPanToViewport(nextGraphPanForAutoPan({
            bounds,
            clientX,
            clientY,
            pan: currentPan,
          })));
        }
      },
      clientToPreviewPoint: graphPointFromClient,
      getAutoPanBounds: () => viewportRef.current?.getBoundingClientRect() ?? null,
      canStart: (event) => !spacePanning && !event.altKey,
    },
  });

  const { resetPan, resetDrag, resetConnector } = {
    resetPan: panController.resetPan,
    resetDrag: nodeDrag.resetDrag,
    resetConnector: connectorDrag.resetConnector,
  };
  const resetInteraction = useCallback(() => {
    resetPan();
    resetDrag();
    resetConnector();
  }, [resetConnector, resetDrag, resetPan]);

  const centerViewportOnWorldPoint = (worldPoint: { x: number; y: number }) => {
    const viewport = viewportRef.current;
    if (!viewport) {
      return;
    }
    const bounds = viewport.getBoundingClientRect();
    setPan(clampPanToViewport({
      x: Math.round(bounds.width / 2 - worldPoint.x * zoom),
      y: Math.round(bounds.height / 2 - worldPoint.y * zoom),
    }));
  };

  const handleNodeClick = (nodeId: string) => {
    if (nodeDrag.consumeSuppressNextClick()) {
      return;
    }
    onSelectNode(nodeId);
  };

  const handleConnectorPointerDown = (
    event: Parameters<typeof connectorDrag.handlers.onPointerDown>[0],
    node: ExecutionGraphNode,
    direction: GraphConnectorDirection,
  ) => {
    if (event.button !== 0 && event.button !== undefined) {
      return;
    }
    if (spacePanning || event.altKey) {
      return;
    }
    onSelectNode(node.id);
    connectorDrag.handlers.onPointerDown(event, {
      sourceNodeId: node.id,
      direction,
    });
  };

  const draggingConnector = connectorDrag.draggingConnector;

  useGraphWheelListener(viewportRef, (event, viewport) => {
    if (!onWheelZoom) {
      return;
    }

    event.preventDefault();
    const nextZoom = onWheelZoom(event.deltaY);
    if (typeof nextZoom !== 'number' || nextZoom === zoom) {
      return;
    }

    const bounds = viewport.getBoundingClientRect();
    anchoredWheelZoomRef.current = nextZoom;
    setPan(clampPanToViewport(nextGraphPanForZoom({
      focalPoint: graphViewportPointFromClient(bounds, event.clientX, event.clientY),
      camera: { pan, zoom },
      nextZoom,
    }), nextZoom));
  });

  useLayoutEffect(() => {
    const previousZoom = previousZoomRef.current;
    if (previousZoom === zoom) {
      return;
    }

    previousZoomRef.current = zoom;
    if (anchoredWheelZoomRef.current === zoom) {
      anchoredWheelZoomRef.current = null;
      return;
    }

    const viewport = viewportRef.current;
    if (!viewport) {
      return;
    }

    const bounds = viewport.getBoundingClientRect();
    setPan((currentPan) => clampPanToViewport(nextGraphPanForZoom({
      focalPoint: graphViewportCenter(bounds),
      camera: { pan: currentPan, zoom: previousZoom },
      nextZoom: zoom,
    }), zoom));
  }, [clampPanToViewport, zoom]);

  useEffect(() => {
    setZoom(zoom);
  }, [setZoom, zoom]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) {
      return;
    }

    const updateViewportSize = () => {
      const bounds = viewport.getBoundingClientRect();
      setViewportSize({
        height: Math.round(bounds.height),
        width: Math.round(bounds.width),
      });
    };

    updateViewportSize();

    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', updateViewportSize);
      return () => window.removeEventListener('resize', updateViewportSize);
    }

    const observer = new ResizeObserver(updateViewportSize);
    observer.observe(viewport);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport || model.nodes.length === 0) {
      return;
    }

    const fitKey = `${viewportSize.width}:${viewportSize.height}:${model.board.width}:${model.board.height}:${model.nodes.map((node) => `${node.id}:${node.x}:${node.y}:${node.width}:${node.height}`).join('|')}`;
    if (fittedModelRef.current === fitKey) {
      return;
    }

    const bounds = viewport.getBoundingClientRect();
    if (bounds.width <= 0 || bounds.height <= 0) {
      return;
    }

    fittedModelRef.current = fitKey;
    const nextZoom = fitGraphZoom({
      minZoom: Math.min(zoom, READABLE_AUTO_FIT_MIN_ZOOM),
      nodes: model.nodes,
      viewportHeight: bounds.height,
      viewportWidth: bounds.width,
      zoom,
    });
    if (onFitZoom && nextZoom < zoom) {
      onFitZoom(nextZoom);
      return;
    }

    setPan(fitGraphPan({
      nodes: model.nodes,
      viewportHeight: bounds.height,
      viewportWidth: bounds.width,
      zoom: nextZoom,
    }));
  }, [model.board.height, model.board.width, model.nodes, onFitZoom, viewportSize.height, viewportSize.width, zoom]);

  useEffect(() => {
    if (resetViewportToken === 0) {
      return;
    }

    const viewport = viewportRef.current;
    if (viewport) {
      const bounds = viewport.getBoundingClientRect();
      const nextZoom = fitGraphZoom({
        minZoom: Math.min(zoom, READABLE_AUTO_FIT_MIN_ZOOM),
        nodes: effectiveNodes,
        viewportHeight: bounds.height,
        viewportWidth: bounds.width,
        zoom,
      });
      if (onFitZoom && nextZoom < zoom) {
        onFitZoom(nextZoom);
      }
      setPan(fitGraphPan({
        nodes: effectiveNodes,
        viewportHeight: bounds.height,
        viewportWidth: bounds.width,
        zoom: nextZoom,
      }));
    } else {
      setPan({ x: 0, y: 0 });
    }
    resetInteraction();
  }, [effectiveNodes, onFitZoom, resetInteraction, resetViewportToken, zoom]);

  return (
    <div
      ref={viewportRef}
      data-testid="execution-graph-viewport"
      className={graphViewportClassName({ dragging: panController.dragging, extraClassName: 'relative min-h-[320px] flex-1 xl:min-h-0' })}
      data-space-panning={spacePanning ? 'true' : 'false'}
      onPointerDown={panController.handlers.onPointerDown}
      onPointerMove={panController.handlers.onPointerMove}
      onPointerUp={panController.handlers.onPointerUp}
      onPointerCancel={panController.handlers.onPointerCancel}
      onMouseDown={panController.handlers.onMouseDown}
      onMouseMove={panController.handlers.onMouseMove}
      onMouseUp={panController.handlers.onMouseUp}
      onMouseLeave={panController.handlers.onMouseLeave}
    >
      <GraphWorldLayer
        camera={{ pan, zoom }}
        scaleMode="nested"
        scaledHeight={Math.max(scaledBoardHeight, 1)}
        scaledWidth={Math.max(scaledBoardWidth, 1)}
        testId="execution-graph-world-space"
        worldHeight={model.board.height}
        worldWidth={model.board.width}
        worldTestId="execution-graph-stage"
      >
            <GraphSvgLayer
              ariaHidden={false}
              height={model.board.height}
              pointerEvents="auto"
              width={model.board.width}
            >
              {model.edges.map((edge) => {
                const source = nodeById.get(edge.sourceId);
                const target = nodeById.get(edge.targetId);
                if (!source || !target) return null;
                const path = buildEdgePath(source, target);
                const related = relatedEdgeIds?.has(edge.id) ?? true;

                return (
                  <g key={edge.id} className={`group ${related ? '' : 'opacity-48 saturate-75'}`}>
                    <path
                      data-graph-edge-hitbox="true"
                      data-testid={`graph-edge-hitbox-${edge.id}`}
                      d={path}
                      fill="none"
                      role="button"
                      stroke="transparent"
                      strokeLinecap="round"
                      strokeWidth={18}
                      tabIndex={0}
                      className="cursor-pointer"
                      aria-label={`Select connection from ${source.title} to ${target.title}`}
                      onClick={(event) => {
                        event.stopPropagation();
                        onSelectNode(edge.targetId);
                      }}
                      onKeyDown={(event) => {
                        if (event.key !== 'Enter' && event.key !== ' ') {
                          return;
                        }
                        event.preventDefault();
                        event.stopPropagation();
                        onSelectNode(edge.targetId);
                      }}
                    />
                    <path
                    data-testid={`graph-edge-${edge.id}`}
                    data-related={related ? 'true' : 'false'}
                    d={path}
                    fill="none"
                    stroke={related ? (edge.style === 'dashed' ? 'rgba(186,230,253,0.72)' : 'rgba(125,211,252,0.92)') : (edge.style === 'dashed' ? 'rgba(148,163,184,0.5)' : 'rgba(125,211,252,0.68)')}
                    strokeDasharray={edge.style === 'dashed' ? '7 8' : undefined}
                    strokeLinecap="round"
                    strokeWidth={related ? 4 : edge.style === 'dashed' ? 2 : 3}
                    className="pointer-events-none transition-[stroke-width,filter] group-hover:drop-shadow-[0_0_8px_rgba(125,211,252,0.42)]"
                    />
                  </g>
                );
              })}
              {draggingConnector && nodeById.has(draggingConnector.sourceNodeId) ? (
                <path
                  d={buildConnectorPreviewPath(
                    nodeById.get(draggingConnector.sourceNodeId)!,
                    draggingConnector.previewPoint,
                    draggingConnector.direction as GraphConnectorDirection,
                  )}
                  fill="none"
                  stroke="rgba(14,165,233,0.92)"
                  strokeDasharray="6 7"
                  strokeLinecap="round"
                  strokeWidth={3}
                  className="drop-shadow-[0_0_10px_rgba(14,165,233,0.5)]"
                  data-testid="graph-connector-preview"
                />
              ) : null}
            </GraphSvgLayer>

            {draggingConnector ? (
              <div
                className="pointer-events-none absolute left-4 top-4 z-20 rounded-md border border-sky-300/25 bg-[#07111f]/92 px-3 py-2 text-xs text-sky-100 shadow-[0_12px_28px_rgba(2,12,27,0.24)]"
                data-testid="graph-connector-drag-hint"
              >
                {draggingConnector.targetNodeId
                  ? 'Release on target pin to inspect route'
                  : `Drag to a ${draggingConnector.direction === 'output' ? 'target input' : 'source output'} pin`}
              </div>
            ) : null}

            {effectiveNodes.map((node) => (
              <ExecutionGraphNodeCard
                cardDensity={cardDensity}
                connectorDropTargetDirection={node.id === draggingConnector?.targetNodeId
                  ? draggingConnector.direction === 'output' ? 'input' : 'output'
                  : null}
                key={node.id}
                node={node}
                related={(relatedNodeIds?.has(node.id) ?? true) || node.id === draggingConnector?.targetNodeId}
                selected={node.id === selectedNodeId || node.id === nodeDrag.draggingNodeId || node.id === draggingConnector?.targetNodeId}
                onSelect={() => handleNodeClick(node.id)}
                onPointerDown={nodeDrag.handlers.onPointerDown}
                onPointerMove={nodeDrag.handlers.onPointerMove}
                onPointerUp={nodeDrag.handlers.onPointerUp}
                onPointerCancel={nodeDrag.handlers.onPointerCancel}
                onConnectorPointerDown={handleConnectorPointerDown}
                onConnectorPointerMove={connectorDrag.handlers.onPointerMove}
                onConnectorPointerUp={connectorDrag.handlers.onPointerUp}
                onConnectorPointerCancel={connectorDrag.handlers.onPointerCancel}
                spacePanning={spacePanning}
                zoom={zoom}
              />
            ))}
      </GraphWorldLayer>
      <ExecutionGraphOverview
        nodes={effectiveNodes}
        onCenter={centerViewportOnWorldPoint}
        pan={pan}
        viewportHeight={viewportSize.height}
        viewportWidth={viewportSize.width}
        zoom={zoom}
      />
    </div>
  );
}
