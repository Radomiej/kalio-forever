import { useCallback, useEffect, useId, useMemo, useRef, useState, type MouseEvent, type PointerEvent } from 'react';
import type { ArchitectureGraphProjection, ArchitectureNodeKind } from '@kalio/types';
import type { ArchitectNode, ArchitectSchema } from './architect.types';
import { ArchitectGraphCanvasToolbar, ArchitectGraphEmptyState, ArchitectRuntimeModeIndicator } from './ArchitectGraphCanvasChrome';
import { ArchitectGraphEdges } from './ArchitectGraphEdges';
import { ArchitectGraphNodeLayer } from './ArchitectGraphNodeLayer';
import { inputPin, outputPin } from './ArchitectGraphGeometry';
import {
  DEFAULT_PAN,
  DEFAULT_ZOOM,
  EMPTY_EDGES,
  EMPTY_NODES,
  FREE_SPACE_HEIGHT,
  FREE_SPACE_WIDTH,
  MOUSE_FALLBACK_POINTER_ID,
  ZOOM_STEP,
  architectCanvasStyle,
  canStartPan,
  clampZoom,
  connectionPath,
  edgeKind,
  hasPointerEvents,
} from './ArchitectGraphCanvas.model';

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
  const [zoom, setZoom] = useState(DEFAULT_ZOOM);
  const [pan, setPan] = useState(DEFAULT_PAN);
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
  } | null>(null);
  const canvasRef = useRef<HTMLElement | null>(null);
  const markerId = `architect-edge-arrow-${useId().replaceAll(':', '')}`;

  useEffect(() => {
    setZoom(DEFAULT_ZOOM);
    setPan(DEFAULT_PAN);
    setPanning(null);
    setDraggingNode(null);
    setEditMode('select');
    setConnectSourceId(null);
  }, [schema?.id]);

  const zoomIn = useCallback(() => setZoom((current) => clampZoom(current + ZOOM_STEP)), []);
  const zoomOut = useCallback(() => setZoom((current) => clampZoom(current - ZOOM_STEP)), []);
  const resetViewport = useCallback(() => {
    setZoom(DEFAULT_ZOOM);
    setPan(DEFAULT_PAN);
  }, []);

  const setMode = useCallback((mode: 'select' | 'add' | 'connect', kind?: ArchitectureNodeKind) => {
    setEditMode(mode);
    if (kind) {
      setAddNodeKind(kind);
    }
    setConnectSourceId(null);
  }, []);

  const startPan = useCallback((event: PointerEvent<HTMLElement>) => {
    if (!canStartPan(event.target, event.altKey, event.button)) {
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
  }, [pan]);

  const movePan = useCallback((event: PointerEvent<HTMLElement>) => {
    const pointerId = event.pointerId ?? 0;
    if (!panning || pointerId !== panning.pointerId) {
      return;
    }
    setPan({
      x: panning.originX + (event.clientX - panning.startX),
      y: panning.originY + (event.clientY - panning.startY),
    });
  }, [panning]);

  const endPan = useCallback((event: PointerEvent<HTMLElement>) => {
    const pointerId = event.pointerId ?? 0;
    if (!panning || pointerId !== panning.pointerId) {
      return;
    }
    if (
      typeof event.currentTarget.hasPointerCapture === 'function'
      && typeof event.currentTarget.releasePointerCapture === 'function'
      && event.currentTarget.hasPointerCapture(pointerId)
    ) {
      event.currentTarget.releasePointerCapture(pointerId);
    }
    setPanning(null);
  }, [panning]);

  const handleWheel = useCallback((event: WheelEvent) => {
    if (!event.ctrlKey && !event.metaKey) {
      return;
    }
    event.preventDefault();
    setZoom((current) => clampZoom(current + (event.deltaY > 0 ? -ZOOM_STEP : ZOOM_STEP)));
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return undefined;
    }
    canvas.addEventListener('wheel', handleWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', handleWheel);
  }, [handleWheel]);

  const startMousePan = useCallback((event: MouseEvent<HTMLElement>) => {
    if (hasPointerEvents() || !canStartPan(event.target, event.altKey, event.button)) {
      return;
    }
    event.preventDefault();
    setPanning({
      pointerId: MOUSE_FALLBACK_POINTER_ID,
      startX: event.clientX,
      startY: event.clientY,
      originX: pan.x,
      originY: pan.y,
    });
  }, [pan]);

  const moveMousePan = useCallback((event: MouseEvent<HTMLElement>) => {
    if (!panning || panning.pointerId !== MOUSE_FALLBACK_POINTER_ID) {
      return;
    }
    setPan({
      x: panning.originX + (event.clientX - panning.startX),
      y: panning.originY + (event.clientY - panning.startY),
    });
  }, [panning]);

  const endMousePan = useCallback(() => {
    if (panning?.pointerId === MOUSE_FALLBACK_POINTER_ID) {
      setPanning(null);
    }
  }, [panning]);

  const canvasPosition = useCallback((event: { clientX: number; clientY: number }, element: HTMLElement) => {
    const rect = element.getBoundingClientRect();
    return {
      x: (event.clientX - rect.left - pan.x) / zoom,
      y: (event.clientY - rect.top - pan.y) / zoom,
    };
  }, [pan, zoom]);

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

  const startNodeDrag = useCallback((event: PointerEvent<HTMLElement>, node: ArchitectNode) => {
    if (runtimeMode) {
      onSelectNode(node.id);
      return;
    }
    if (event.button !== 0 && event.button !== undefined) {
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
    });
  }, [onSelectNode, runtimeMode]);

  const moveNodeDrag = useCallback((event: PointerEvent<HTMLElement>) => {
    const pointerId = event.pointerId ?? 0;
    if (!draggingNode || pointerId !== draggingNode.pointerId) {
      return;
    }
    event.preventDefault();
    onMoveNode(draggingNode.nodeId, {
      x: draggingNode.originX + (event.clientX - draggingNode.startX) / zoom,
      y: draggingNode.originY + (event.clientY - draggingNode.startY) / zoom,
    });
  }, [draggingNode, onMoveNode, zoom]);

  const endNodeDrag = useCallback((event: PointerEvent<HTMLElement>) => {
    const pointerId = event.pointerId ?? 0;
    if (!draggingNode || pointerId !== draggingNode.pointerId) {
      return;
    }
    if (
      typeof event.currentTarget.hasPointerCapture === 'function'
      && typeof event.currentTarget.releasePointerCapture === 'function'
      && event.currentTarget.hasPointerCapture(pointerId)
    ) {
      event.currentTarget.releasePointerCapture(pointerId);
    }
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

  if (!schema) {
    return <ArchitectGraphEmptyState />;
  }

  return (
    <section
      ref={canvasRef}
      className="relative flex-1 overflow-hidden bg-[#080b12]"
      data-testid="architect-graph-canvas"
      onPointerDown={startPan}
      onPointerMove={movePan}
      onPointerUp={endPan}
      onPointerCancel={endPan}
      onMouseDown={startMousePan}
      onMouseMove={moveMousePan}
      onMouseUp={endMousePan}
      onMouseLeave={endMousePan}
      onClick={handleCanvasClick}
      style={architectCanvasStyle({ cursor: panning ? 'grabbing' : editMode === 'add' ? 'crosshair' : 'default', pan, zoom })}
    >
      <div
        className="absolute inset-0"
        data-testid="architect-canvas-transform"
        style={{
          transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
          transformOrigin: '0 0',
        }}
      >
        <div
          className="relative"
          style={{ minHeight: FREE_SPACE_HEIGHT, minWidth: FREE_SPACE_WIDTH }}
          data-testid="architect-canvas-free-space"
        >
          <ArchitectGraphEdges edges={edges} markerId={markerId} />

          <ArchitectGraphNodeLayer
            nodes={schema.nodes}
            selectedNodeId={selectedNodeId}
            selectedSlotId={selectedSlotId}
            connectSourceId={connectSourceId}
            onNodeClick={handleNodeClick}
            onSlotClick={onSelectSlot}
            onDragStart={startNodeDrag}
            onDragMove={moveNodeDrag}
            onDragEnd={endNodeDrag}
          />
        </div>
      </div>

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
