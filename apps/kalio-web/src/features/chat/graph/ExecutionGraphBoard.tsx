import { useEffect, useLayoutEffect, useMemo, useRef, useState, type MouseEvent, type PointerEvent } from 'react';
import {
  type ExecutionGraphModel,
  type ExecutionGraphNode,
} from './executionGraphModel';
import { GraphSvgLayer } from '../../graph/GraphSvgLayer';
import { GraphWorldLayer } from '../../graph/GraphWorldLayer';
import { graphViewportCenter, graphViewportClassName, graphViewportPointFromClient, graphWorldDeltaFromClientDelta, hasGraphDragStarted, nextGraphPan, nextGraphPanForAutoPan, nextGraphPanForZoom, releasePointerCaptureIfHeld, shouldStartGraphPan, useGraphViewport, useGraphWheelListener, useSpacePanning } from '../../graph/useGraphInteraction';
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
  const dragStateRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    panX: number;
    panY: number;
  } | null>(null);
  const nodeDragRef = useRef<{
    pointerId: number;
    nodeId: string;
    startClientX: number;
    startClientY: number;
    startNodeX: number;
    startNodeY: number;
    moved: boolean;
  } | null>(null);
  const connectorDragRef = useRef<{
    direction: GraphConnectorDirection;
    moved: boolean;
    nodeId: string;
    pointerId: number;
    startClientX: number;
    startClientY: number;
  } | null>(null);
  const suppressNodeClickRef = useRef(false);
  const fittedModelRef = useRef<string | null>(null);
  const previousZoomRef = useRef(zoom);
  const anchoredWheelZoomRef = useRef<number | null>(null);
  const [dragging, setDragging] = useState(false);
  const [draggingNodeId, setDraggingNodeId] = useState<string | null>(null);
  const [draggingConnector, setDraggingConnector] = useState<{
    direction: GraphConnectorDirection;
    nodeId: string;
    targetNodeId: string | null;
    x: number;
    y: number;
  } | null>(null);
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

  const clampPanToViewport = (nextPan: { x: number; y: number }, nextZoom = zoom) => {
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
  };

  const graphPointFromClient = (clientX: number, clientY: number) => {
    const viewport = viewportRef.current;
    if (!viewport) {
      return null;
    }
    const bounds = viewport.getBoundingClientRect();
    return clientToWorld(bounds, clientX, clientY);
  };

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

  const connectorTargetFromClient = (
    clientX: number,
    clientY: number,
    dragState: { direction: GraphConnectorDirection; nodeId: string },
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

    if (!targetNodeId || targetNodeId === dragState.nodeId || targetDirection !== requiredDirection) {
      return null;
    }

    return targetNodeId;
  };

  const updatePan = (clientX: number, clientY: number) => {
    const dragState = dragStateRef.current;
    if (!dragState) {
      return;
    }

    setPan(clampPanToViewport(nextGraphPan({
      pointerId: dragState.pointerId,
      startX: dragState.startX,
      startY: dragState.startY,
      originX: dragState.panX,
      originY: dragState.panY,
    }, clientX, clientY)));
  };

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 && event.button !== 1) {
      return;
    }

    if (!shouldStartGraphPan({
      blockedSelector: '[data-graph-node-card="true"], [data-graph-edge-hitbox="true"]',
      button: event.button,
      forcePan: spacePanning || event.altKey || event.button === 1,
      target: event.target,
    })) {
      return;
    }

    event.preventDefault();
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
    if (dragStateRef.current) {
      releasePointerCaptureIfHeld(event.currentTarget, dragStateRef.current.pointerId);
    }
    dragStateRef.current = null;
    setDragging(false);
  };

  const handleMouseDown = (event: MouseEvent<HTMLDivElement>) => {
    if (event.button !== 0 && event.button !== 1) {
      return;
    }

    if (!shouldStartGraphPan({
      blockedSelector: '[data-graph-node-card="true"], [data-graph-edge-hitbox="true"]',
      button: event.button,
      forcePan: spacePanning || event.altKey || event.button === 1,
      target: event.target,
    })) {
      return;
    }

    event.preventDefault();
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

  const handleNodePointerDown = (event: PointerEvent<HTMLElement>, node: ExecutionGraphNode) => {
    if (event.button !== 0 && event.button !== undefined) {
      return;
    }
    if (spacePanning || event.altKey) {
      return;
    }

    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    nodeDragRef.current = {
      pointerId: event.pointerId,
      nodeId: node.id,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startNodeX: node.x,
      startNodeY: node.y,
      moved: false,
    };
    setDraggingNodeId(node.id);
  };

  const handleNodePointerMove = (event: PointerEvent<HTMLElement>) => {
    const dragState = nodeDragRef.current;
    if (!dragState || dragState.pointerId !== event.pointerId) {
      return;
    }

    event.stopPropagation();
    if (!dragState.moved && !hasGraphDragStarted({
      startX: dragState.startClientX,
      startY: dragState.startClientY,
      clientX: event.clientX,
      clientY: event.clientY,
    })) {
      return;
    }

    const delta = graphWorldDeltaFromClientDelta({
      startX: dragState.startClientX,
      startY: dragState.startClientY,
      clientX: event.clientX,
      clientY: event.clientY,
      zoom,
    });
    dragState.moved = true;
    setNodePositionOverrides((current) => ({
      ...current,
      [dragState.nodeId]: {
        x: Math.round(dragState.startNodeX + delta.x),
        y: Math.round(dragState.startNodeY + delta.y),
      },
    }));
  };

  const stopNodeDragging = (event: PointerEvent<HTMLElement>) => {
    const dragState = nodeDragRef.current;
    if (dragState) {
      releasePointerCaptureIfHeld(event.currentTarget, dragState.pointerId);
    }
    if (dragState?.moved) {
      suppressNodeClickRef.current = true;
    }
    nodeDragRef.current = null;
    setDraggingNodeId(null);
  };

  const handleNodeClick = (nodeId: string) => {
    if (suppressNodeClickRef.current) {
      suppressNodeClickRef.current = false;
      return;
    }
    onSelectNode(nodeId);
  };

  const handleConnectorPointerDown = (
    event: PointerEvent<HTMLButtonElement>,
    node: ExecutionGraphNode,
    direction: GraphConnectorDirection,
  ) => {
    if (event.button !== 0 && event.button !== undefined) {
      return;
    }
    if (spacePanning || event.altKey) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    if (typeof event.currentTarget.setPointerCapture === 'function') {
      event.currentTarget.setPointerCapture(event.pointerId);
    }
    connectorDragRef.current = {
      direction,
      moved: false,
      nodeId: node.id,
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
    };
    onSelectNode(node.id);
  };

  const handleConnectorPointerMove = (event: PointerEvent<HTMLButtonElement>) => {
    const dragState = connectorDragRef.current;
    if (!dragState || dragState.pointerId !== event.pointerId) {
      return;
    }
    if (!dragState.moved && !hasGraphDragStarted({
      startX: dragState.startClientX,
      startY: dragState.startClientY,
      clientX: event.clientX,
      clientY: event.clientY,
    })) {
      return;
    }
    const point = graphPointFromClient(event.clientX, event.clientY);
    if (!point) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    dragState.moved = true;
    setDraggingConnector({
      direction: dragState.direction,
      nodeId: dragState.nodeId,
      targetNodeId: connectorTargetFromClient(event.clientX, event.clientY, dragState),
      x: point.x,
      y: point.y,
    });
    const bounds = viewportRef.current?.getBoundingClientRect();
    if (bounds) {
      setPan((currentPan) => clampPanToViewport(nextGraphPanForAutoPan({
        bounds,
        clientX: event.clientX,
        clientY: event.clientY,
        pan: currentPan,
      })));
    }
  };

  const stopConnectorDragging = (event: PointerEvent<HTMLButtonElement>) => {
    const dragState = connectorDragRef.current;
    const targetNodeId = dragState?.moved ? connectorTargetFromClient(event.clientX, event.clientY, dragState) : null;
    if (dragState) {
      releasePointerCaptureIfHeld(event.currentTarget, dragState.pointerId);
    }
    connectorDragRef.current = null;
    setDraggingConnector(null);
    if (targetNodeId) {
      onSelectNode(targetNodeId);
    }
  };

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
  }, [zoom]);

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
    dragStateRef.current = null;
    setDragging(false);
  }, [effectiveNodes, onFitZoom, resetViewportToken, zoom]);

  return (
    <div
      ref={viewportRef}
      data-testid="execution-graph-viewport"
      className={graphViewportClassName({ dragging, extraClassName: 'relative min-h-[320px] flex-1 xl:min-h-0' })}
      data-space-panning={spacePanning ? 'true' : 'false'}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={stopDragging}
      onPointerCancel={stopDragging}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={stopMouseDragging}
      onMouseLeave={stopMouseDragging}
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
              <defs>
                <marker id="graph-arrow" viewBox="0 0 8 8" refX="6.6" refY="4" markerWidth="4.5" markerHeight="4.5" orient="auto-start-reverse">
                  <path d="M 0 0 L 8 4 L 0 8 z" fill="rgba(125, 211, 252, 0.78)" />
                </marker>
              </defs>
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
                      markerEnd="url(#graph-arrow)"
                      stroke={related ? (edge.style === 'dashed' ? 'rgba(186,230,253,0.72)' : 'rgba(125,211,252,0.92)') : (edge.style === 'dashed' ? 'rgba(148,163,184,0.5)' : 'rgba(125,211,252,0.68)')}
                      strokeDasharray={edge.style === 'dashed' ? '7 8' : undefined}
                      strokeLinecap="round"
                      strokeWidth={related ? 4 : edge.style === 'dashed' ? 2 : 3}
                      className="pointer-events-none transition-[stroke-width,filter] group-hover:drop-shadow-[0_0_8px_rgba(125,211,252,0.42)]"
                    />
                  </g>
                );
              })}
              {draggingConnector && nodeById.has(draggingConnector.nodeId) ? (
                <path
                  d={buildConnectorPreviewPath(nodeById.get(draggingConnector.nodeId)!, draggingConnector, draggingConnector.direction)}
                  fill="none"
                  markerEnd={draggingConnector.direction === 'output' ? 'url(#graph-arrow)' : undefined}
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
                selected={node.id === selectedNodeId || node.id === draggingNodeId || node.id === draggingConnector?.targetNodeId}
                onSelect={() => handleNodeClick(node.id)}
                onPointerDown={handleNodePointerDown}
                onPointerMove={handleNodePointerMove}
                onPointerUp={stopNodeDragging}
                onPointerCancel={stopNodeDragging}
                onConnectorPointerDown={handleConnectorPointerDown}
                onConnectorPointerMove={handleConnectorPointerMove}
                onConnectorPointerUp={stopConnectorDragging}
                onConnectorPointerCancel={stopConnectorDragging}
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
