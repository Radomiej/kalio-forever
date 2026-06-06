import { useCallback, useEffect, useId, useMemo, useRef, useState, type MouseEvent, type PointerEvent } from 'react';
import type { ArchitectureGraphProjection, ArchitectureNodeKind } from '@kalio/types';
import { GRAPH_MOUSE_FALLBACK_POINTER_ID, graphViewportCenter, graphViewportPointFromClient, graphWorldDeltaFromClientDelta, hasGraphDragStarted, hasPointerEvents, nextGraphPan, nextGraphPanForAutoPan, releasePointerCaptureIfHeld, shouldStartGraphPan, useGraphViewport, useGraphWheelListener, useSpacePanning } from '../graph/useGraphInteraction';
import { GraphWorldLayer } from '../graph/GraphWorldLayer';
import { GraphSvgLayer } from '../graph/GraphSvgLayer';
import type { ArchitectNode, ArchitectSchema } from './architect.types';
import { ArchitectGraphCanvasToolbar, ArchitectGraphEmptyState, ArchitectRuntimeModeIndicator } from './ArchitectGraphCanvasChrome';
import { ArchitectGraphEdges } from './ArchitectGraphEdges';
import { ArchitectGraphNodeLayer } from './ArchitectGraphNodeLayer';
import { inputPin, outputPin } from './ArchitectGraphGeometry';
import { DEFAULT_PAN, DEFAULT_ZOOM, EMPTY_EDGES, EMPTY_NODES, FREE_SPACE_HEIGHT, FREE_SPACE_WIDTH, architectCanvasStyle, connectionPath, edgeKind, fitArchitectGraphViewport, nextArchitectZoom } from './ArchitectGraphCanvas.model';

interface ArchitectGraphCanvasProps {
  schema: ArchitectSchema | null;
  selectedNodeId: string | null;
  selectedSlotId: string | null;
  onSelectNode: (nodeId: string) => void;
  onSelectSlot: (nodeId: string, slotId: string) => void;
  onMoveNode: (nodeId: string, position: { x: number; y: number }) => void;
  onAddNode: (position: { x: number; y: number }, kind: ArchitectureNodeKind) => void;
  onToggleEdge: (fromNodeId: string, toNodeId: string) => void;
  onAutoLayout: () => void;
  routeHops?: ArchitectureGraphProjection['routeHops'];
  runtimeMode?: boolean;
}

export function ArchitectGraphCanvas({
  schema,
  selectedNodeId,
  selectedSlotId,
  onSelectNode,
  onSelectSlot,
  onMoveNode,
  onAddNode,
  onToggleEdge,
  onAutoLayout,
  routeHops,
  runtimeMode = false,
}: ArchitectGraphCanvasProps) {
  const [editMode, setEditMode] = useState<'select' | 'add' | 'connect'>('select');
  const [addNodeKind, setAddNodeKind] = useState<ArchitectureNodeKind>('role');
  const [connectSourceId, setConnectSourceId] = useState<string | null>(null);
  const {
    clientToWorld,
    pan,
    setCamera,
    setPan,
    zoom,
    zoomTo: setViewportZoom,
  } = useGraphViewport({ initialPan: DEFAULT_PAN, initialZoom: DEFAULT_ZOOM });
  const [panning, setPanning] = useState<{
    pointerId: number;
    startX: number;
    startY: number;
    originX: number;
    originY: number;
  } | null>(null);
  const [draggingNode, setDraggingNode] = useState<{
    nodeId: string;
    pointerId: number;
    startX: number;
    startY: number;
    originX: number;
    originY: number;
    moved: boolean;
  } | null>(null);
  const [draggingConnection, setDraggingConnection] = useState<{
    moved: boolean;
    sourceNodeId: string;
    pointerId: number;
    startX: number;
    startY: number;
    targetNodeId: string | null;
    x: number;
    y: number;
  } | null>(null);
  const spacePanning = useSpacePanning();
  const canvasRef = useRef<HTMLElement | null>(null);
  const markerId = `architect-edge-arrow-${useId().replaceAll(':', '')}`;

  const fitViewport = useCallback((nodes: ArchitectNode[] = schema?.nodes ?? []) => {
    const canvas = canvasRef.current;
    if (!canvas) {
      setCamera({ pan: DEFAULT_PAN, zoom: DEFAULT_ZOOM });
      return;
    }
    const bounds = canvas.getBoundingClientRect();
    const nextViewport = fitArchitectGraphViewport({
      nodes,
      viewportHeight: bounds.height,
      viewportWidth: bounds.width,
    });
    setCamera(nextViewport);
  }, [schema?.nodes, setCamera]);

  useEffect(() => {
    fitViewport(schema?.nodes ?? []);
    setPanning(null);
    setDraggingNode(null);
    setDraggingConnection(null);
    setEditMode('select');
    setConnectSourceId(null);
  }, [fitViewport, schema?.id, schema?.nodes]);

  const zoomTo = useCallback((nextZoom: number, focalPoint?: { x: number; y: number }) => {
    if (nextZoom === zoom) {
      return;
    }

    const canvas = canvasRef.current;
    const bounds = canvas?.getBoundingClientRect();
    const focal = focalPoint ?? (bounds ? graphViewportCenter(bounds) : { x: 0, y: 0 });

    setViewportZoom(nextZoom, focal);
  }, [setViewportZoom, zoom]);

  const zoomIn = useCallback(() => zoomTo(nextArchitectZoom(zoom, 'in')), [zoom, zoomTo]);
  const zoomOut = useCallback(() => zoomTo(nextArchitectZoom(zoom, 'out')), [zoom, zoomTo]);
  const resetViewport = useCallback(() => {
    fitViewport();
    setPanning(null);
    setDraggingNode(null);
    setDraggingConnection(null);
    setConnectSourceId(null);
  }, [fitViewport]);

  const setMode = useCallback((mode: 'select' | 'add' | 'connect', kind?: ArchitectureNodeKind) => {
    setEditMode(mode);
    if (kind) {
      setAddNodeKind(kind);
    }
    setConnectSourceId(null);
  }, []);

  const startPan = useCallback((event: PointerEvent<HTMLElement>) => {
    if (!shouldStartGraphPan({
      blockedSelector: '[data-architect-control="true"]',
      button: event.button,
      forcePan: spacePanning || event.altKey || event.button === 1,
      target: event.target,
    })) {
      return;
    }
    event.preventDefault();
    const pointerId = event.pointerId ?? 0;
    if (typeof event.currentTarget.setPointerCapture === 'function') {
      event.currentTarget.setPointerCapture(pointerId);
    }
    setPanning({
      pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: pan.x,
      originY: pan.y,
    });
  }, [pan, spacePanning]);

  const movePan = useCallback((event: PointerEvent<HTMLElement>) => {
    const pointerId = event.pointerId ?? 0;
    if (!panning || pointerId !== panning.pointerId) {
      return;
    }
    setPan(nextGraphPan(panning, event.clientX, event.clientY));
  }, [panning]);

  const endPan = useCallback((event: PointerEvent<HTMLElement>) => {
    const pointerId = event.pointerId ?? 0;
    if (!panning || pointerId !== panning.pointerId) {
      return;
    }
    releasePointerCaptureIfHeld(event.currentTarget, pointerId);
    setPanning(null);
  }, [panning]);

  const handleWheel = useCallback((event: WheelEvent, canvas: HTMLElement) => {
    const nextZoom = nextArchitectZoom(zoom, event.deltaY > 0 ? 'out' : 'in');
    if (nextZoom === zoom) {
      return;
    }

    event.preventDefault();
    const rect = canvas.getBoundingClientRect();
    zoomTo(nextZoom, graphViewportPointFromClient(rect, event.clientX, event.clientY));
  }, [zoom, zoomTo]);

  useGraphWheelListener(canvasRef, handleWheel);

  const startMousePan = useCallback((event: MouseEvent<HTMLElement>) => {
    if (hasPointerEvents() || !shouldStartGraphPan({
      blockedSelector: '[data-architect-control="true"]',
      button: event.button,
      forcePan: spacePanning || event.altKey || event.button === 1,
      target: event.target,
    })) {
      return;
    }
    event.preventDefault();
    setPanning({
      pointerId: GRAPH_MOUSE_FALLBACK_POINTER_ID,
      startX: event.clientX,
      startY: event.clientY,
      originX: pan.x,
      originY: pan.y,
    });
  }, [pan, spacePanning]);

  const moveMousePan = useCallback((event: MouseEvent<HTMLElement>) => {
    if (!panning || panning.pointerId !== GRAPH_MOUSE_FALLBACK_POINTER_ID) {
      return;
    }
    setPan(nextGraphPan(panning, event.clientX, event.clientY));
  }, [panning]);

  const endMousePan = useCallback(() => {
    if (panning?.pointerId === GRAPH_MOUSE_FALLBACK_POINTER_ID) {
      setPanning(null);
    }
  }, [panning]);

  const canvasPosition = useCallback((event: { clientX: number; clientY: number }, element: HTMLElement) => {
    const rect = element.getBoundingClientRect();
    return clientToWorld(rect, event.clientX, event.clientY);
  }, [clientToWorld]);

  const canvasPositionFromClient = useCallback((event: { clientX: number; clientY: number }) => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return null;
    }
    return canvasPosition(event, canvas);
  }, [canvasPosition]);

  const handleCanvasClick = useCallback((event: MouseEvent<HTMLElement>) => {
    if (runtimeMode || editMode !== 'add') {
      return;
    }
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest('[data-architect-control="true"]')) {
      return;
    }
    onAddNode(canvasPosition(event, event.currentTarget), addNodeKind);
    setMode('select');
  }, [addNodeKind, canvasPosition, editMode, onAddNode, runtimeMode, setMode]);

  const handleNodeClick = useCallback((nodeId: string) => {
    if (runtimeMode) {
      onSelectNode(nodeId);
      return;
    }
    if (editMode !== 'connect') {
      onSelectNode(nodeId);
      return;
    }
    if (!connectSourceId) {
      setConnectSourceId(nodeId);
      onSelectNode(nodeId);
      return;
    }
    onToggleEdge(connectSourceId, nodeId);
    setMode('select');
  }, [connectSourceId, editMode, onSelectNode, onToggleEdge, runtimeMode, setMode]);

  const startConnectionFromNode = useCallback((nodeId: string) => {
    if (runtimeMode) {
      onSelectNode(nodeId);
      return;
    }
    setEditMode('connect');
    setConnectSourceId(nodeId);
    onSelectNode(nodeId);
  }, [onSelectNode, runtimeMode]);

  const startConnectionDrag = useCallback((event: PointerEvent<HTMLElement>, nodeId: string) => {
    if (event.altKey) {
      return;
    }
    if (runtimeMode || event.button !== 0) {
      startConnectionFromNode(nodeId);
      return;
    }
    const position = canvasPositionFromClient(event);
    if (!position) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    const pointerId = event.pointerId ?? 0;
    if (typeof event.currentTarget.setPointerCapture === 'function') {
      event.currentTarget.setPointerCapture(pointerId);
    }
    setEditMode('connect');
    setConnectSourceId(nodeId);
    setDraggingConnection({
      moved: false,
      sourceNodeId: nodeId,
      pointerId,
      startX: event.clientX,
      startY: event.clientY,
      targetNodeId: null,
      x: position.x,
      y: position.y,
    });
    onSelectNode(nodeId);
  }, [canvasPositionFromClient, onSelectNode, runtimeMode, startConnectionFromNode]);

  const connectionTargetFromClient = useCallback((clientX: number, clientY: number, sourceNodeId: string) => {
    if (typeof document.elementFromPoint !== 'function') {
      return null;
    }
    const pointTarget = document.elementFromPoint(clientX, clientY);
    const target = pointTarget?.closest('[data-architect-input-node-id]');
    const targetNodeId = target?.getAttribute('data-architect-input-node-id') ?? null;
    return targetNodeId && targetNodeId !== sourceNodeId ? targetNodeId : null;
  }, []);

  const completeConnectionToNode = useCallback((nodeId: string) => {
    if (runtimeMode) {
      onSelectNode(nodeId);
      return;
    }
    if (!connectSourceId || connectSourceId === nodeId) {
      setEditMode('connect');
      setConnectSourceId(nodeId);
      onSelectNode(nodeId);
      return;
    }
    onToggleEdge(connectSourceId, nodeId);
    setMode('select');
  }, [connectSourceId, onSelectNode, onToggleEdge, runtimeMode, setMode]);

  const moveConnectionDrag = useCallback((event: PointerEvent<HTMLElement>) => {
    const pointerId = event.pointerId ?? 0;
    if (!draggingConnection || draggingConnection.pointerId !== pointerId) {
      return;
    }
    if (!draggingConnection.moved && !hasGraphDragStarted({
      startX: draggingConnection.startX,
      startY: draggingConnection.startY,
      clientX: event.clientX,
      clientY: event.clientY,
    })) {
      return;
    }
    const position = canvasPositionFromClient(event);
    if (!position) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    setDraggingConnection((current) => current && current.pointerId === pointerId
      ? {
        ...current,
        moved: true,
        targetNodeId: connectionTargetFromClient(event.clientX, event.clientY, current.sourceNodeId),
        x: position.x,
        y: position.y,
      }
      : current);
    const bounds = canvasRef.current?.getBoundingClientRect();
    if (bounds) {
      setPan((currentPan) => nextGraphPanForAutoPan({
        bounds,
        clientX: event.clientX,
        clientY: event.clientY,
        pan: currentPan,
      }));
    }
  }, [canvasPositionFromClient, connectionTargetFromClient, draggingConnection, setPan]);

  const endConnectionDrag = useCallback((event: PointerEvent<HTMLElement>) => {
    const pointerId = event.pointerId ?? 0;
    if (!draggingConnection || draggingConnection.pointerId !== pointerId) {
      return;
    }
    releasePointerCaptureIfHeld(event.currentTarget, pointerId);
    const targetNodeId = draggingConnection.moved
      ? connectionTargetFromClient(event.clientX, event.clientY, draggingConnection.sourceNodeId)
      : null;
    if (targetNodeId && targetNodeId !== draggingConnection.sourceNodeId) {
      onToggleEdge(draggingConnection.sourceNodeId, targetNodeId);
      setMode('select');
    }
    setDraggingConnection(null);
  }, [connectionTargetFromClient, draggingConnection, onToggleEdge, setMode]);

  const startNodeDrag = useCallback((event: PointerEvent<HTMLElement>, node: ArchitectNode) => {
    if (runtimeMode) {
      onSelectNode(node.id);
      return;
    }
    if (event.button !== 0 && event.button !== undefined) {
      return;
    }
    if (spacePanning || event.altKey) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    const pointerId = event.pointerId ?? 0;
    if (typeof event.currentTarget.setPointerCapture === 'function') {
      event.currentTarget.setPointerCapture(pointerId);
    }
    onSelectNode(node.id);
    setDraggingNode({
      nodeId: node.id,
      pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: node.x,
      originY: node.y,
      moved: false,
    });
  }, [onSelectNode, runtimeMode, spacePanning]);

  const moveNodeDrag = useCallback((event: PointerEvent<HTMLElement>) => {
    const pointerId = event.pointerId ?? 0;
    if (!draggingNode || pointerId !== draggingNode.pointerId) {
      return;
    }
    event.preventDefault();
    const moved = draggingNode.moved || hasGraphDragStarted({
      startX: draggingNode.startX,
      startY: draggingNode.startY,
      clientX: event.clientX,
      clientY: event.clientY,
    });
    if (!moved) {
      return;
    }
    if (!draggingNode.moved) {
      setDraggingNode((current) => current && current.pointerId === pointerId ? { ...current, moved: true } : current);
    }
    const delta = graphWorldDeltaFromClientDelta({
      startX: draggingNode.startX,
      startY: draggingNode.startY,
      clientX: event.clientX,
      clientY: event.clientY,
      zoom,
    });
    onMoveNode(draggingNode.nodeId, {
      x: draggingNode.originX + delta.x,
      y: draggingNode.originY + delta.y,
    });
  }, [draggingNode, onMoveNode, zoom]);

  const endNodeDrag = useCallback((event: PointerEvent<HTMLElement>) => {
    const pointerId = event.pointerId ?? 0;
    if (!draggingNode || pointerId !== draggingNode.pointerId) {
      return;
    }
    releasePointerCaptureIfHeld(event.currentTarget, pointerId);
    setDraggingNode(null);
  }, [draggingNode]);

  const nodes = schema?.nodes ?? EMPTY_NODES;
  const schemaEdges = schema?.edges ?? EMPTY_EDGES;
  const executedEdgeIds = useMemo(() => new Set((routeHops ?? []).map((hop) => `${hop.fromNodeId}->${hop.toNodeId}`)), [routeHops]);
  const nodeById = useMemo(() => new Map(nodes.map((node) => [node.id, node])), [nodes]);
  const edges = useMemo(() => {
    const pairs = schemaEdges.length > 0
      ? schemaEdges.map((edge) => ({ id: edge.id, sourceId: edge.fromNodeId, targetId: edge.toNodeId }))
      : nodes.flatMap((node) => node.connections.map((targetId) => ({
        id: `${node.id}-${targetId}`,
        sourceId: node.id,
        targetId,
      })));

    return pairs.flatMap((pair) => {
      const sourceNode = nodeById.get(pair.sourceId);
      const targetNode = nodeById.get(pair.targetId);
      if (!sourceNode || !targetNode) {
        return [];
      }
      const source = outputPin(sourceNode);
      const target = inputPin(targetNode);
      const kind = edgeKind(sourceNode);
      return {
        id: pair.id,
        path: connectionPath(source, target),
        kind,
        executed: executedEdgeIds.has(`${pair.sourceId}->${pair.targetId}`),
      };
    });
  }, [executedEdgeIds, nodeById, nodes, schemaEdges]);
  const connectionPreviewPath = useMemo(() => {
    if (!draggingConnection?.moved) {
      return null;
    }
    const sourceNode = nodeById.get(draggingConnection.sourceNodeId);
    if (!sourceNode) {
      return null;
    }
    return connectionPath(outputPin(sourceNode), { x: draggingConnection.x, y: draggingConnection.y });
  }, [draggingConnection, nodeById]);

  if (!schema) {
    return <ArchitectGraphEmptyState />;
  }

  return (
    <section
      ref={canvasRef}
      className="relative flex-1 overflow-hidden bg-[#080b12]"
      data-testid="architect-graph-canvas"
      data-space-panning={spacePanning ? 'true' : 'false'}
      onPointerDown={startPan}
      onPointerMove={movePan}
      onPointerUp={endPan}
      onPointerCancel={endPan}
      onMouseDown={startMousePan}
      onMouseMove={moveMousePan}
      onMouseUp={endMousePan}
      onMouseLeave={endMousePan}
      onClick={handleCanvasClick}
      style={architectCanvasStyle({ cursor: panning ? 'grabbing' : spacePanning ? 'grab' : editMode === 'add' ? 'crosshair' : 'default', pan, zoom })}
    >
      <GraphWorldLayer
        camera={{ pan, zoom }}
        className="absolute inset-0"
        minHeight={FREE_SPACE_HEIGHT}
        minWidth={FREE_SPACE_WIDTH}
        testId="architect-canvas-transform"
      >
        <div
          className="relative"
          data-testid="architect-canvas-free-space"
          style={{ minHeight: FREE_SPACE_HEIGHT, minWidth: FREE_SPACE_WIDTH }}
        >
        <ArchitectGraphEdges edges={edges} markerId={markerId} />
        {connectionPreviewPath ? (
          <GraphSvgLayer>
            <path
              d={connectionPreviewPath}
              fill="none"
              className="stroke-sky-200/85"
              strokeDasharray="6 6"
              strokeLinecap="round"
              strokeWidth={2.4}
              data-testid="architect-connection-preview"
            />
          </GraphSvgLayer>
        ) : null}

        <ArchitectGraphNodeLayer
          nodes={schema.nodes}
          selectedNodeId={selectedNodeId}
          selectedSlotId={selectedSlotId}
          connectSourceId={connectSourceId}
          connectionDropTargetId={draggingConnection?.moved ? draggingConnection.targetNodeId : null}
          onNodeClick={handleNodeClick}
          onSlotClick={onSelectSlot}
          onStartConnection={startConnectionFromNode}
          onCompleteConnection={completeConnectionToNode}
          onStartConnectionDrag={startConnectionDrag}
          onMoveConnectionDrag={moveConnectionDrag}
          onEndConnectionDrag={endConnectionDrag}
          onDragStart={startNodeDrag}
          onDragMove={moveNodeDrag}
          onDragEnd={endNodeDrag}
          zoom={zoom}
        />
        </div>
      </GraphWorldLayer>

      <ArchitectGraphCanvasToolbar
        editMode={editMode}
        addNodeKind={addNodeKind}
        zoom={zoom}
        onModeChange={setMode}
        onZoomIn={zoomIn}
        onZoomOut={zoomOut}
        onResetViewport={resetViewport}
        onAutoLayout={onAutoLayout}
        runtimeMode={runtimeMode}
      />
      <ArchitectRuntimeModeIndicator runtimeMode={runtimeMode} />
    </section>
  );
}
