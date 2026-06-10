import { useCallback, useEffect, useId, useMemo, useRef, useState, type MouseEvent, type PointerEvent } from 'react';
import type { ArchitectureGraphProjection, ArchitectureNodeKind } from '@kalio/types';
import { graphViewportCenter, graphViewportPointFromClient, hasPointerEvents, nextGraphPanForAutoPan, useGraphViewport, useGraphWheelListener, useSpacePanning } from '../graph/useGraphInteraction';
import { useGraphConnectorDragController } from '../graph/controllers/useGraphConnectorDragController';
import { useGraphNodeDragController } from '../graph/controllers/useGraphNodeDragController';
import { useGraphPanController } from '../graph/controllers/useGraphPanController';
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
  resetViewportToken?: number;
}

type ArchitectConnectorDragState = {
  sourceNodeId: string;
  moved: boolean;
  pointerId: number;
  startX: number;
  startY: number;
};

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
  resetViewportToken = 0,
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
  const spacePanning = useSpacePanning();
  const canvasRef = useRef<HTMLElement | null>(null);
  const markerId = `architect-edge-arrow-${useId().replaceAll(':', '')}`;

  const panController = useGraphPanController({
    pan,
    setPan,
    spacePanning,
    blockedSelector: '[data-architect-control="true"]',
    useMouseFallback: !hasPointerEvents(),
  });

  const nodeDrag = useGraphNodeDragController<ArchitectNode>({
    zoom,
    spacePanning,
    adapter: {
      getNodeOrigin: (node) => ({ x: node.x, y: node.y }),
      commitPosition: onMoveNode,
      canStartDrag: (_event, node) => {
        if (runtimeMode) {
          onSelectNode(node.id);
          return false;
        }
        return true;
      },
      onSelectOnStart: onSelectNode,
    },
  });

  const connectionTargetFromClient = useCallback((clientX: number, clientY: number, sourceNodeId: string) => {
    if (typeof document.elementFromPoint !== 'function') {
      return null;
    }
    const pointTarget = document.elementFromPoint(clientX, clientY);
    const target = pointTarget?.closest('[data-architect-input-node-id]');
    const targetNodeId = target?.getAttribute('data-architect-input-node-id') ?? null;
    return targetNodeId && targetNodeId !== sourceNodeId ? targetNodeId : null;
  }, []);

  const canvasPositionFromClient = useCallback((clientX: number, clientY: number) => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return null;
    }
    const rect = canvas.getBoundingClientRect();
    return clientToWorld(rect, clientX, clientY);
  }, [clientToWorld]);

  const connectorDrag = useGraphConnectorDragController<ArchitectConnectorDragState>({
    createDragState: (event, meta) => ({
      ...meta,
      moved: false,
      pointerId: event.pointerId ?? 0,
      startX: event.clientX,
      startY: event.clientY,
    }),
    adapter: {
      resolveDropTarget: (clientX, clientY, state) => connectionTargetFromClient(clientX, clientY, state.sourceNodeId),
      onCommit: (sourceNodeId, targetNodeId, moved) => {
        if (moved && targetNodeId && targetNodeId !== sourceNodeId) {
          onToggleEdge(sourceNodeId, targetNodeId);
          setEditMode('select');
          setConnectSourceId(null);
        }
      },
      applyAutoPan: (clientX, clientY) => {
        const bounds = canvasRef.current?.getBoundingClientRect();
        if (bounds) {
          setPan((currentPan) => nextGraphPanForAutoPan({
            bounds,
            clientX,
            clientY,
            pan: currentPan,
          }));
        }
      },
      clientToPreviewPoint: canvasPositionFromClient,
      getAutoPanBounds: () => canvasRef.current?.getBoundingClientRect() ?? null,
    },
  });

  const fitViewport = useCallback((nodes: ArchitectNode[]) => {
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
  }, [setCamera]);

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

  useEffect(() => {
    if (!schema) {
      return;
    }
    fitViewport(schema.nodes);
    resetInteraction();
    setEditMode('select');
    setConnectSourceId(null);
  }, [fitViewport, resetInteraction, schema?.id]);

  useEffect(() => {
    if (resetViewportToken === 0 || !schema) {
      return;
    }
    fitViewport(schema.nodes);
    resetInteraction();
    setConnectSourceId(null);
  }, [fitViewport, resetInteraction, resetViewportToken, schema]);

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
    if (schema) {
      fitViewport(schema.nodes);
    }
    resetInteraction();
    setConnectSourceId(null);
  }, [fitViewport, resetInteraction, schema]);

  const setMode = useCallback((mode: 'select' | 'add' | 'connect', kind?: ArchitectureNodeKind) => {
    setEditMode(mode);
    if (kind) {
      setAddNodeKind(kind);
    }
    setConnectSourceId(null);
  }, []);

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

  const canvasPosition = useCallback((event: { clientX: number; clientY: number }, element: HTMLElement) => {
    const rect = element.getBoundingClientRect();
    return clientToWorld(rect, event.clientX, event.clientY);
  }, [clientToWorld]);

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
    const position = canvasPositionFromClient(event.clientX, event.clientY);
    if (!position) {
      return;
    }
    setEditMode('connect');
    setConnectSourceId(nodeId);
    onSelectNode(nodeId);
    connectorDrag.handlers.onPointerDown(event, { sourceNodeId: nodeId });
  }, [canvasPositionFromClient, connectorDrag.handlers, onSelectNode, runtimeMode, startConnectionFromNode]);

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
      const source = outputPin(sourceNode, zoom);
      const target = inputPin(targetNode, zoom);
      const kind = edgeKind(sourceNode);
      return {
        id: pair.id,
        path: connectionPath(source, target),
        kind,
        executed: executedEdgeIds.has(`${pair.sourceId}->${pair.targetId}`),
      };
    });
  }, [executedEdgeIds, nodeById, nodes, schemaEdges, zoom]);

  const draggingConnector = connectorDrag.draggingConnector;
  const connectionPreviewPath = useMemo(() => {
    if (!draggingConnector) {
      return null;
    }
    const sourceNode = nodeById.get(draggingConnector.sourceNodeId);
    if (!sourceNode) {
      return null;
    }
    return connectionPath(outputPin(sourceNode, zoom), draggingConnector.previewPoint);
  }, [draggingConnector, nodeById, zoom]);

  if (!schema) {
    return <ArchitectGraphEmptyState />;
  }

  return (
    <section
      ref={canvasRef}
      className="relative flex-1 overflow-hidden bg-[#080b12]"
      data-testid="architect-graph-canvas"
      data-space-panning={spacePanning ? 'true' : 'false'}
      onPointerDown={panController.handlers.onPointerDown}
      onPointerMove={panController.handlers.onPointerMove}
      onPointerUp={panController.handlers.onPointerUp}
      onPointerCancel={panController.handlers.onPointerCancel}
      onMouseDown={panController.handlers.onMouseDown}
      onMouseMove={panController.handlers.onMouseMove}
      onMouseUp={panController.handlers.onMouseUp}
      onMouseLeave={panController.handlers.onMouseLeave}
      onClick={handleCanvasClick}
      style={architectCanvasStyle({ cursor: panController.dragging ? 'grabbing' : spacePanning ? 'grab' : editMode === 'add' ? 'crosshair' : 'default', pan, zoom })}
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
          connectionDropTargetId={draggingConnector?.targetNodeId ?? null}
          onNodeClick={handleNodeClick}
          onSlotClick={onSelectSlot}
          onStartConnection={startConnectionFromNode}
          onCompleteConnection={completeConnectionToNode}
          onStartConnectionDrag={startConnectionDrag}
          onMoveConnectionDrag={connectorDrag.handlers.onPointerMove}
          onEndConnectionDrag={connectorDrag.handlers.onPointerUp}
          onDragStart={nodeDrag.handlers.onPointerDown}
          onDragMove={nodeDrag.handlers.onPointerMove}
          onDragEnd={nodeDrag.handlers.onPointerUp}
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
